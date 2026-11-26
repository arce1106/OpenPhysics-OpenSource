"""Collecting paper homework: upload, page grouping, identification and choice reading.

Pages are read locally (scan_layout_service). A copy starts at a page that has
the student-number boxes; the pages after it belong to the same copy until the
next such page. The number boxes alone are sent to AI to identify the student.
Choice answers are sent to AI only for students with a teacher-AI authorization;
everyone else is entered by the teacher. Answer areas are cropped and kept for
grading. Files of an identified student live in that student's answer folder, so
account erasure removes them.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import time

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.teacher import TeacherAssignment
from app.models.teacher_scan import TeacherScanBatch, TeacherScanPage, TeacherSubmission, TeacherSubmissionItem
from app.services import scan_layout_service as layout_service
from app.services.answer_media_service import AnswerMediaService
from app.services.paper_items import is_choice
from app.services.personalized_service import paper_for, question_map
from app.services.choice_scoring import PARTIAL_CREDIT, multiple_choice_credit
from app.services.teacher_ai_service import TeacherAiQuotaExceeded, TeacherAiService
from app.services.teacher_service import TeacherService, TeacherServiceError, mask_phone

logger = logging.getLogger(__name__)

LOW_CONFIDENCE = 0.8
IMAGE_URL_TTL_SECONDS = 15 * 60
# Below this a read number only suggests a student; the teacher confirms who it is.
NUMBER_CONFIDENCE = 0.8
# A batch or grading run still "working" after this long was cut off (a restart, a deploy).
INTERRUPTED_AFTER_MINUTES = 30
LOCKED_DETAIL = "结果已发布，收卷已锁定"
ISSUE_LABELS = {
    "number_unread": "学号未能识别",
    "number_unsure": "学号看不太清，请确认是谁",
    "unknown_number": "学号不在本班名单中",
    "duplicate_copy": "该学生已有一份卷子",
    "orphan_page": "无法归属的续页",
    "ai_quota": "AI 识别次数已达上限，请人工指定学生",
    "ai_unavailable": "AI 识别暂不可用，请人工指定学生",
}


def uploads_root() -> Path:
    return AnswerMediaService().static_dir / "uploads"


def _letters(value: str | None) -> str:
    return "".join(sorted({ch for ch in (value or "").upper() if "A" <= ch <= "H"}))


def sign_image(relative_path: str, teacher_id: str, *, ttl: int = IMAGE_URL_TTL_SECONDS) -> str:
    payload = base64.urlsafe_b64encode(json.dumps(
        {"p": relative_path, "t": teacher_id, "e": int(time()) + ttl}, separators=(",", ":"),
    ).encode()).decode().rstrip("=")
    signature = hmac.new(settings.teacher_auth_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"/api/teacher/scan-images/{payload}.{signature}"


def resolve_signed_image(token: str) -> Path | None:
    payload, _, signature = token.partition(".")
    expected = hmac.new(settings.teacher_auth_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not signature or not hmac.compare_digest(expected, signature):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (ValueError, json.JSONDecodeError):
        return None
    if int(data.get("e", 0)) < int(time()):
        return None
    root = uploads_root().resolve()
    path = (root / str(data.get("p", ""))).resolve()
    if root not in path.parents or not path.is_file():
        return None
    return path


def _check_open(assignment: TeacherAssignment) -> None:
    """Released results are final: nothing that changes what was collected may happen after."""
    if assignment.removed_at is not None:
        raise TeacherServiceError(409, "作业已删除，不能再收卷或修改")
    if assignment.results_released_at is not None:
        raise TeacherServiceError(409, LOCKED_DETAIL)


async def collection_numbers(teachers: TeacherService, assignment: TeacherAssignment) -> dict[str, str | None]:
    """Each current member's number on this homework: the one it went out with, so renumbering
    the class later never sends a paper to someone else. Students who joined afterwards use
    their number now, unless a classmate already had it on this homework."""
    live = await teachers.member_numbers(assignment.class_id)
    members = [student.id for student in await teachers.assignment_members(assignment)]
    frozen = assignment.roster or {}
    numbers = {student_id: frozen.get(student_id) for student_id in members if student_id in frozen}
    taken = {number for number in frozen.values() if number}
    for student_id in members:
        if student_id not in frozen:
            number = live.get(student_id)
            numbers[student_id] = number if number and number not in taken else None
    return numbers


class TeacherScanService:
    def __init__(self, db: AsyncSession, ai: TeacherAiService | None = None, root: Path | None = None):
        self.db = db
        self.ai = ai or TeacherAiService(db)
        self.root = root or uploads_root()
        self.teachers = TeacherService(db)

    # --- Paths ---

    def _write(self, relative: str, data: bytes) -> str:
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return relative

    def _scan_dir(self, assignment_id: str, batch_id: str) -> str:
        return f"teacher_scans/{assignment_id}/{batch_id}"

    def _student_dir(self, student_id: str, assignment_id: str) -> str:
        return f"answers/{student_id}/teacher/{assignment_id}"

    def _move(self, relative: str, target_dir: str, prefix: str = "") -> str:
        source = self.root / relative
        destination = f"{target_dir}/{prefix}{Path(relative).name}"
        (self.root / destination).parent.mkdir(parents=True, exist_ok=True)
        if source.exists():
            shutil.move(str(source), str(self.root / destination))
        return destination

    def _image(self, relative: str) -> np.ndarray:
        return layout_service.decode_image((self.root / relative).read_bytes())

    # --- Upload ---

    async def _owned_published(self, teacher_id: str, assignment_id: str, *, changing: bool = False) -> TeacherAssignment:
        assignment = await self.db.get(TeacherAssignment, assignment_id)
        if not assignment or assignment.teacher_id != teacher_id:
            raise TeacherServiceError(404, "测验不存在")
        if assignment.status != "published":
            raise TeacherServiceError(409, "测验发布后才能收卷")
        if changing:
            _check_open(assignment)
        return assignment

    async def upload(self, teacher_id: str, assignment_id: str, filename: str, data: bytes) -> tuple[TeacherScanBatch, bool]:
        assignment = await self._owned_published(teacher_id, assignment_id, changing=True)
        from app.services.teacher_homework_service import has_paper_students

        if not await has_paper_students(self.db, assignment):
            raise TeacherServiceError(409, "本次作业的学生都在 App 作答，无需扫描收卷")
        if not data:
            raise TeacherServiceError(400, "文件是空的")
        if len(data) > settings.teacher_scan_max_upload_mb * 1024 * 1024:
            raise TeacherServiceError(413, f"单个文件不能超过 {settings.teacher_scan_max_upload_mb} MB")
        digest = hashlib.sha256(data).hexdigest()
        existing = (await self.db.execute(select(TeacherScanBatch).where(
            TeacherScanBatch.assignment_id == assignment.id, TeacherScanBatch.sha256 == digest,
        ))).scalar_one_or_none()
        if existing:
            return existing, False
        batch = TeacherScanBatch(
            id=f"b_{uuid.uuid4().hex}", assignment_id=assignment.id, teacher_id=teacher_id,
            filename=Path(filename or "scan").name[:120], sha256=digest,
        )
        suffix = ".pdf" if data[:5] == b"%PDF-" else Path(filename or "").suffix.lower()[:8] or ".img"
        self._write(f"{self._scan_dir(assignment.id, batch.id)}/original{suffix}", data)
        self.db.add(batch)
        await self.db.commit()
        await self.db.refresh(batch)
        return batch, True

    # --- Processing ---

    async def process(self, batch_id: str) -> None:
        batch = await self.db.get(TeacherScanBatch, batch_id)
        if not batch or batch.status != "queued":
            return
        batch.status, batch.error = "processing", None
        await self.db.commit()
        try:
            await self._process(batch)
            batch.status = "done"
        except layout_service.UnreadableScan as exc:
            batch.status, batch.error = "failed", str(exc)
        except Exception:
            logger.exception("scan batch %s failed", batch_id)
            await self.db.rollback()
            batch = await self.db.get(TeacherScanBatch, batch_id)
            batch.status, batch.error = "failed", "处理失败，请删除后重新上传"
        batch.finished_at = datetime.now(timezone.utc)
        await self.db.commit()

    async def _process(self, batch: TeacherScanBatch) -> None:
        assignment = await self.db.get(TeacherAssignment, batch.assignment_id)
        scan_dir = self._scan_dir(assignment.id, batch.id)
        original = next((self.root / scan_dir).glob("original*"))
        images = layout_service.load_pages(original.read_bytes(), original.name)
        batch.page_count = len(images)
        await self.db.commit()

        copies: list[list[tuple[TeacherScanPage, np.ndarray, layout_service.PageLayout]]] = []
        for index, gray in enumerate(images, start=1):
            gray = layout_service.deskew(gray)
            layout = layout_service.analyse_page(gray)
            kind = "blank" if layout.blank else ("first" if layout.is_first_page else "continuation")
            page = TeacherScanPage(
                id=f"p_{uuid.uuid4().hex}", batch_id=batch.id, assignment_id=assignment.id, page_index=index,
                kind=kind, layout=layout.as_dict(),
                image_path=self._write(f"{scan_dir}/page_{index:03d}.jpg", layout_service.encode_jpeg(gray)),
            )
            if kind == "first":
                copies.append([(page, gray, layout)])
                page.copy_seq = len(copies)
            elif kind == "continuation":
                if copies:
                    copies[-1].append((page, gray, layout))
                    page.copy_seq = len(copies)
                else:
                    page.status, page.issue = "exception", "orphan_page"
            self.db.add(page)
            batch.processed_pages = index
            await self.db.commit()

        members = await self.teachers.assignment_members(assignment)
        numbers = await collection_numbers(self.teachers, assignment)
        by_number = {number: student_id for student_id, number in numbers.items() if number}
        for copy in copies:
            first, gray, layout = copy[0]
            number_crop = layout_service.encode_jpeg(layout_service.crop(
                gray, layout_service.union(layout.number_boxes, pad=int(layout.px_per_mm)),
            ))
            self._write(f"{scan_dir}/number_{first.page_index:03d}.jpg", number_crop)
            try:
                number, confidence = await self.ai.read_student_number(
                    number_crop, assignment_id=assignment.id, teacher_id=assignment.teacher_id,
                    student_count=len(members),
                )
            except TeacherAiQuotaExceeded:
                first.status, first.issue = "exception", "ai_quota"
                await self.db.commit()
                continue
            except Exception:
                logger.exception("student number reading failed for page %s", first.id)
                first.status, first.issue = "exception", "ai_unavailable"
                await self.db.commit()
                continue
            first.recognized_number, first.number_confidence = number or None, confidence
            student_id = by_number.get(number)
            if not number:
                first.status, first.issue = "exception", "number_unread"
            elif not student_id:
                first.status, first.issue = "exception", "unknown_number"
            elif confidence < NUMBER_CONFIDENCE:
                first.status, first.issue = "exception", "number_unsure"
            elif await self._has_submission(assignment.id, student_id):
                first.status, first.issue = "exception", "duplicate_copy"
            else:
                await self._collect(assignment, student_id, [(page, image, page_layout) for page, image, page_layout in copy])
            await self.db.commit()

    async def _has_submission(self, assignment_id: str, student_id: str) -> bool:
        return (await self.db.execute(select(TeacherSubmission.id).where(
            TeacherSubmission.assignment_id == assignment_id, TeacherSubmission.student_id == student_id,
        ))).first() is not None

    async def _collect(self, assignment: TeacherAssignment, student_id: str, copy) -> TeacherSubmission:
        """Turn one identified copy into a submission with an item per question."""
        authorized = student_id in await self.ai.authorized_students([student_id])
        target_dir = self._student_dir(student_id, assignment.id)
        paper_items, snapshot = await paper_for(self.db, assignment, student_id)
        numbered = list(enumerate(paper_items, start=1))
        choices = [(n, item) for n, item in numbered if is_choice(snapshot[item["question_id"]]["question_type"])]
        others = [(n, item) for n, item in numbered if (n, item) not in choices]

        first_page, first_image, first_layout = copy[0]
        cells = first_layout.answer_cells[:len(choices)]
        areas = [(image, rect) for _, image, layout in copy for rect in layout.areas][:len(others)]
        inset = int(first_layout.px_per_mm)

        submission = TeacherSubmission(
            id=f"sub_{uuid.uuid4().hex}", assignment_id=assignment.id, student_id=student_id,
            status="recognized", ai_authorized=authorized,
        )
        self.db.add(submission)
        # Files carry the submission's id: a replacement copy never overwrites, or is removed with, another.
        tag = f"{submission.id[-8:]}_"
        for page, _, _ in copy:
            page.student_id = student_id
            page.status, page.issue = "ok", None
            if page.image_path:
                page.image_path = self._move(page.image_path, target_dir, tag)
        await self.db.flush()

        cell_images = []
        for position, (number, item) in enumerate(choices):
            crop_path = None
            if position < len(cells):
                # A margin around the cell, so letters written over its lines are seen rather than
                # cut off: the real-paper trial read a clipped "ABCD" as a confident "AB".
                image = layout_service.crop(first_image, cells[position], inset=-int(1.5 * first_layout.px_per_mm))
                cell_images.append(image)
                crop_path = self._write(f"{target_dir}/{tag}q{number:02d}.jpg", layout_service.encode_jpeg(image))
            self.db.add(TeacherSubmissionItem(
                submission_id=submission.id, number=number, question_id=item["question_id"], kind="choice",
                crop_path=crop_path, status="manual" if not authorized else ("pending" if crop_path else "missing"),
            ))
        for position, (number, item) in enumerate(others):
            crop_path = None
            if position < len(areas):
                image, rect = areas[position]
                crop_path = self._write(
                    f"{target_dir}/{tag}q{number:02d}.jpg",
                    layout_service.encode_jpeg(layout_service.crop(image, rect, inset=inset)),
                )
            self.db.add(TeacherSubmissionItem(
                submission_id=submission.id, number=number, question_id=item["question_id"], kind="area",
                crop_path=crop_path, status="collected" if crop_path else "missing",
            ))
        await self.db.flush()

        if authorized and cell_images:
            await self._read_choices(assignment, submission, choices[:len(cell_images)], cell_images)
        await self._refresh_status(submission)
        return submission

    async def _read_choices(self, assignment, submission, choices, cell_images) -> None:
        snapshot = await question_map(self.db, assignment)
        options = {
            number: [option["label"] for option in snapshot[item["question_id"]]["options"]] or list("ABCD")
            for number, item in choices
        }
        strip = layout_service.encode_jpeg(layout_service.choice_strip(cell_images, [n for n, _ in choices]))
        members = await self.teachers.assignment_members(assignment)
        try:
            readings = await self.ai.read_choices(
                strip, options, assignment_id=assignment.id, teacher_id=assignment.teacher_id,
                student_count=len(members),
            )
        except Exception as exc:
            if not isinstance(exc, TeacherAiQuotaExceeded):
                logger.exception("choice reading failed for submission %s", submission.id)
            readings = {}
        items = await self._items(submission.id)
        for item in items:
            if item.kind != "choice" or item.status != "pending":
                continue
            if item.number not in readings:
                item.status = "needs_review"
                continue
            answer, confidence = readings[item.number]
            item.recognized_answer, item.confidence, item.answer = answer, confidence, answer
            item.is_correct = self._is_correct(snapshot.get(item.question_id), answer)
            item.status = "recognized" if confidence >= LOW_CONFIDENCE else "needs_review"

    @staticmethod
    def _is_partial(question: dict | None, answer: str | None) -> bool:
        """A multiple choice with some correct options and none wrong: half marks (高考 rule)."""
        if (question or {}).get("question_type") != "multiple_choice":
            return False
        return multiple_choice_credit(_letters(question.get("answer")), _letters(answer)) == PARTIAL_CREDIT

    @staticmethod
    def _is_correct(question: dict | None, answer: str | None) -> bool | None:
        key = _letters((question or {}).get("answer"))
        if not key:
            return None
        return _letters(answer) == key

    async def _items(self, submission_id: str) -> list[TeacherSubmissionItem]:
        result = await self.db.execute(
            select(TeacherSubmissionItem).where(TeacherSubmissionItem.submission_id == submission_id)
            .order_by(TeacherSubmissionItem.number)
        )
        return list(result.scalars().all())

    async def _refresh_status(self, submission: TeacherSubmission) -> None:
        statuses = {item.status for item in await self._items(submission.id)}
        if not submission.ai_authorized and "manual" in statuses:
            submission.status = "manual"
        elif statuses & {"needs_review", "missing", "pending"}:
            submission.status = "needs_review"
        else:
            submission.status = "recognized"

    # --- Teacher actions ---

    async def _owned_page(self, teacher_id: str, page_id: str) -> tuple[TeacherScanPage, TeacherAssignment]:
        page = await self.db.get(TeacherScanPage, page_id)
        assignment = await self.db.get(TeacherAssignment, page.assignment_id) if page else None
        if not page or not assignment or assignment.teacher_id != teacher_id:
            raise TeacherServiceError(404, "扫描页不存在")
        _check_open(assignment)
        return page, assignment

    async def _analysed(self, page: TeacherScanPage):
        gray = self._image(page.image_path)
        # The stored image is already straightened; analysing again recovers its regions.
        return gray, layout_service.analyse_page(gray)

    async def assign_page(self, teacher_id: str, page_id: str, student_id: str, *, replace: bool = False) -> None:
        page, assignment = await self._owned_page(teacher_id, page_id)
        if page.kind != "first" or page.status != "exception":
            raise TeacherServiceError(409, "只有待处理的卷首页可以指定学生")
        members = {student.id for student in await self.teachers.assignment_members(assignment)}
        if student_id not in members:
            raise TeacherServiceError(400, "该学生不在本班")
        existing = (await self.db.execute(select(TeacherSubmission).where(
            TeacherSubmission.assignment_id == assignment.id, TeacherSubmission.student_id == student_id,
        ))).scalar_one_or_none()
        if existing is not None:
            if existing.source == "app":
                raise TeacherServiceError(409, "该学生已在 App 中交了这份作业")
            if not replace:
                raise TeacherServiceError(409, "该学生已有一份卷子；如要用这一份替换原来的，请选择“替换”")
            await self._drop_submission(existing, mark_pages="replaced")
        pages = (await self.db.execute(
            select(TeacherScanPage).where(TeacherScanPage.batch_id == page.batch_id,
                                          TeacherScanPage.copy_seq == page.copy_seq)
            .order_by(TeacherScanPage.page_index)
        )).scalars().all()
        copy = []
        for each in pages:
            gray, layout = await self._analysed(each)
            copy.append((each, gray, layout))
        await self._collect(assignment, student_id, copy)
        await self.db.commit()

    async def attach_page(self, teacher_id: str, page_id: str, student_id: str) -> int:
        """A continuation page that lost its first page: its answer areas fill, in order, the
        areas missing from that student's copy."""
        page, assignment = await self._owned_page(teacher_id, page_id)
        if page.kind != "continuation" or page.status != "exception":
            raise TeacherServiceError(409, "只有无法归属的续页可以补到学生卷子里")
        submission = (await self.db.execute(select(TeacherSubmission).where(
            TeacherSubmission.assignment_id == assignment.id, TeacherSubmission.student_id == student_id,
            TeacherSubmission.source == "scan",
        ))).scalar_one_or_none()
        if submission is None:
            raise TeacherServiceError(409, "这个学生还没有收到卷首页，请先处理卷首页")
        missing = [item for item in await self._items(submission.id) if item.kind == "area" and not item.crop_path]
        if not missing:
            raise TeacherServiceError(409, "这个学生的作答区已经齐全")
        gray, layout = await self._analysed(page)
        if not layout.areas:
            raise TeacherServiceError(400, "这一页没有找到作答区")
        target_dir = self._student_dir(student_id, assignment.id)
        tag = f"{submission.id[-8:]}_"
        inset = int(layout.px_per_mm)
        filled = 0
        for item, rect in zip(missing, layout.areas):
            item.crop_path = self._write(f"{target_dir}/{tag}q{item.number:02d}.jpg",
                                         layout_service.encode_jpeg(layout_service.crop(gray, rect, inset=inset)))
            item.status = "collected"
            if item.grade_status is None and not submission.ai_authorized:
                item.grade_status = "manual"
            filled += 1
        page.student_id, page.status, page.issue = student_id, "ok", None
        page.image_path = self._move(page.image_path, target_dir, tag)
        await self._refresh_status(submission)
        await self.db.commit()
        return filled

    async def ignore_page(self, teacher_id: str, page_id: str) -> None:
        page, _ = await self._owned_page(teacher_id, page_id)
        if page.status != "exception":
            raise TeacherServiceError(409, "这一页不需要处理")
        page.status = "ignored"
        await self.db.commit()

    async def _owned_submission(self, teacher_id: str, submission_id: str) -> tuple[TeacherSubmission, TeacherAssignment]:
        submission = await self.db.get(TeacherSubmission, submission_id)
        assignment = await self.db.get(TeacherAssignment, submission.assignment_id) if submission else None
        if not submission or not assignment or assignment.teacher_id != teacher_id:
            raise TeacherServiceError(404, "卷子不存在")
        _check_open(assignment)
        return submission, assignment

    async def set_choice(self, teacher_id: str, submission_id: str, number: int, answer: str) -> None:
        submission, assignment = await self._owned_submission(teacher_id, submission_id)
        item = next((each for each in await self._items(submission.id) if each.number == number), None)
        if not item or item.kind != "choice":
            raise TeacherServiceError(404, "没有这道选择题")
        snapshot = await question_map(self.db, assignment)
        allowed = {option["label"] for option in snapshot[item.question_id]["options"]} or set("ABCD")
        written = [ch for ch in (answer or "").upper() if not ch.isspace() and ch not in ",，、"]
        letters = "".join(sorted(set(written)))
        if any(letter not in allowed for letter in letters):
            raise TeacherServiceError(400, f"选项只能是 {''.join(sorted(allowed))}")
        item.answer = letters
        item.is_correct = self._is_correct(snapshot.get(item.question_id), letters)
        item.status = "confirmed"
        await self._refresh_status(submission)
        await self.db.commit()

    def _unlink(self, relative: str | None) -> None:
        if relative:
            (self.root / relative).unlink(missing_ok=True)

    def _prune(self, relative_dir: str) -> None:
        """Remove a student's folder for this homework once nothing is left in it."""
        folder = self.root / relative_dir
        try:
            folder.rmdir()
        except OSError:
            pass

    async def _drop_submission(self, submission: TeacherSubmission, *, mark_pages: str | None) -> None:
        """Delete a scanned copy and its files; its pages stay as ``mark_pages`` or go with their batch."""
        for item in await self._items(submission.id):
            self._unlink(item.crop_path)
        pages = (await self.db.execute(select(TeacherScanPage).where(
            TeacherScanPage.assignment_id == submission.assignment_id,
            TeacherScanPage.student_id == submission.student_id, TeacherScanPage.status == "ok",
        ))).scalars().all()
        for page in pages:
            if mark_pages:
                page.status = mark_pages
        await self.db.delete(submission)
        await self.db.flush()

    async def _clear_batch(self, batch: TeacherScanBatch, assignment: TeacherAssignment) -> None:
        """Undo what one upload collected: the copies whose first page it held, and its page images."""
        pages = (await self.db.execute(select(TeacherScanPage).where(TeacherScanPage.batch_id == batch.id))).scalars().all()
        students = {page.student_id for page in pages if page.student_id and page.status == "ok" and page.kind == "first"}
        for student_id in students:
            submission = (await self.db.execute(select(TeacherSubmission).where(
                TeacherSubmission.assignment_id == assignment.id, TeacherSubmission.student_id == student_id,
                TeacherSubmission.source == "scan",
            ))).scalar_one_or_none()
            if submission is not None:
                await self._drop_submission(submission, mark_pages=None)
        # Continuation pages from other uploads that had been added to those copies wait again.
        if students:
            strays = (await self.db.execute(select(TeacherScanPage).where(
                TeacherScanPage.assignment_id == assignment.id, TeacherScanPage.student_id.in_(students),
                TeacherScanPage.batch_id != batch.id, TeacherScanPage.status == "ok",
            ))).scalars().all()
            for page in strays:
                page.student_id, page.status, page.issue = None, "exception", "orphan_page"
        for page in pages:
            self._unlink(page.image_path)
            await self.db.delete(page)
        for student_id in {page.student_id for page in pages if page.student_id}:
            self._prune(self._student_dir(student_id, assignment.id))
        await self.db.flush()

    async def _owned_batch(self, teacher_id: str, batch_id: str) -> tuple[TeacherScanBatch, TeacherAssignment]:
        batch = await self.db.get(TeacherScanBatch, batch_id)
        assignment = await self.db.get(TeacherAssignment, batch.assignment_id) if batch else None
        if not batch or not assignment or assignment.teacher_id != teacher_id:
            raise TeacherServiceError(404, "上传记录不存在")
        _check_open(assignment)
        return batch, assignment

    async def batch_pages(self, teacher_id: str, batch_id: str) -> dict:
        """Inspect a batch without changing it, including after results have been released."""
        batch = await self.db.get(TeacherScanBatch, batch_id)
        if batch is None:
            raise TeacherServiceError(404, "扫描记录不存在")
        assignment = await self._owned_published(teacher_id, batch.assignment_id)
        members = {s.id: s for s in await self.teachers.assignment_members(assignment)}
        numbers = await collection_numbers(self.teachers, assignment)
        pages = (await self.db.scalars(select(TeacherScanPage).where(
            TeacherScanPage.batch_id == batch.id, TeacherScanPage.assignment_id == assignment.id,
        ).order_by(TeacherScanPage.page_index))).all()
        return {
            "batch_id": batch.id, "filename": batch.filename,
            "pages": [{
                "id": page.id, "page_index": page.page_index, "status": page.status,
                "issue_label": ISSUE_LABELS.get(page.issue or "", page.issue),
                "student_name": mask_phone(members[page.student_id].display_name) if page.student_id in members else None,
                "student_number": numbers.get(page.student_id),
                "image_url": sign_image(page.image_path, teacher_id) if page.image_path else None,
            } for page in pages],
        }

    async def delete_batch(self, teacher_id: str, batch_id: str) -> None:
        batch, assignment = await self._owned_batch(teacher_id, batch_id)
        if batch.status in {"queued", "processing"}:
            raise TeacherServiceError(409, "正在处理，请稍后再删除")
        await self._clear_batch(batch, assignment)
        shutil.rmtree(self.root / self._scan_dir(assignment.id, batch.id), ignore_errors=True)
        await self.db.delete(batch)
        await self.db.commit()

    async def retry_batch(self, teacher_id: str, batch_id: str) -> TeacherScanBatch:
        """Read a failed or interrupted upload again from its original file."""
        batch, assignment = await self._owned_batch(teacher_id, batch_id)
        if batch.status != "failed":
            raise TeacherServiceError(409, "只有失败或中断的上传可以重新处理")
        if not any((self.root / self._scan_dir(assignment.id, batch.id)).glob("original*")):
            raise TeacherServiceError(409, "原文件已不在，请删除后重新上传")
        await self._clear_batch(batch, assignment)
        batch.status, batch.error, batch.page_count, batch.processed_pages = "queued", None, 0, 0
        batch.finished_at = None
        await self.db.commit()
        return batch

    # --- Overview ---

    async def overview(self, teacher_id: str, assignment_id: str) -> dict:
        assignment = await self._owned_published(teacher_id, assignment_id)
        from app.services.teacher_homework_service import sync_app_submissions

        await recover_interrupted_work(self.db)
        await sync_app_submissions(self.db, assignment)
        members = await self.teachers.assignment_members(assignment)
        names = {student.id: mask_phone(student.display_name) for student in members}
        numbers = await collection_numbers(self.teachers, assignment)
        by_number = {number: student_id for student_id, number in numbers.items() if number}
        authorized = await self.ai.authorized_students([student.id for student in members])
        snapshot = await question_map(self.db, assignment)
        batches = (await self.db.execute(
            select(TeacherScanBatch).where(TeacherScanBatch.assignment_id == assignment.id)
            .order_by(TeacherScanBatch.created_at)
        )).scalars().all()
        submissions = {
            submission.student_id: submission for submission in (await self.db.execute(
                select(TeacherSubmission).where(TeacherSubmission.assignment_id == assignment.id)
            )).scalars().all()
        }
        items_by_submission: dict[str, list[TeacherSubmissionItem]] = {}
        if submissions:
            for item in (await self.db.execute(
                select(TeacherSubmissionItem)
                .where(TeacherSubmissionItem.submission_id.in_([s.id for s in submissions.values()]))
                .order_by(TeacherSubmissionItem.number)
            )).scalars().all():
                items_by_submission.setdefault(item.submission_id, []).append(item)
        pages = (await self.db.execute(
            select(TeacherScanPage).where(TeacherScanPage.assignment_id == assignment.id)
            .order_by(TeacherScanPage.batch_id, TeacherScanPage.page_index)
        )).scalars().all()
        exceptions = [page for page in pages if page.status == "exception"]
        # How many copies each upload holds, so deleting one says what it takes with it.
        copies_in_batch: dict[str, int] = {}
        page_urls: dict[str, list[str]] = {}
        for page in pages:
            if page.status == "ok" and page.student_id:
                if page.kind == "first":
                    copies_in_batch[page.batch_id] = copies_in_batch.get(page.batch_id, 0) + 1
                if page.image_path:
                    page_urls.setdefault(page.student_id, []).append(page.image_path)

        def url(path: str | None) -> str | None:
            return sign_image(path, teacher_id) if path else None

        def student_row(student):
            submission = submissions.get(student.id)
            return {
                "student_id": student.id,
                "display_name": mask_phone(student.display_name),
                "student_number": numbers.get(student.id),
                "ai_authorized": student.id in authorized,
                "page_urls": [url(path) for path in page_urls.get(student.id, [])],
                "submission": None if not submission else {
                    "id": submission.id,
                    "status": submission.status,
                    "source": submission.source,
                    "items": [{
                        "number": item.number,
                        "kind": item.kind,
                        "answer": item.answer,
                        "recognized_answer": item.recognized_answer,
                        "confidence": item.confidence,
                        "is_correct": item.is_correct,
                        "partial": self._is_partial(snapshot.get(item.question_id), item.answer),
                        "status": item.status,
                        "image_url": url(item.crop_path),
                    } for item in items_by_submission.get(submission.id, [])],
                },
            }

        def suggestion(page: TeacherScanPage) -> dict | None:
            student_id = by_number.get(page.recognized_number or "")
            if page.kind != "first" or not student_id:
                return None
            return {"student_id": student_id, "display_name": names.get(student_id, "")}

        rows = sorted((student_row(student) for student in members),
                      key=lambda row: (row["student_number"] is None, int(row["student_number"] or 0)))
        return {
            "assignment_id": assignment.id,
            "released": assignment.results_released_at is not None,
            "collected": sum(1 for row in rows if row["submission"]),
            "total": len(rows),
            "batches": [{
                "id": batch.id, "filename": batch.filename, "status": batch.status, "error": batch.error,
                "page_count": batch.page_count, "processed_pages": batch.processed_pages,
                "created_at": batch.created_at, "copies": copies_in_batch.get(batch.id, 0),
            } for batch in batches],
            "students": rows,
            "exceptions": [{
                "page_id": page.id,
                "page_index": page.page_index,
                "batch_id": page.batch_id,
                "kind": page.kind,
                "issue": page.issue,
                "issue_label": ISSUE_LABELS.get(page.issue or "", page.issue),
                "recognized_number": page.recognized_number,
                "number_confidence": page.number_confidence,
                "suggested": suggestion(page),
                "page_url": url(page.image_path),
                "number_url": url(f"{self._scan_dir(assignment.id, page.batch_id)}/number_{page.page_index:03d}.jpg")
                if page.kind == "first" else None,
            } for page in exceptions],
            "ai_usage": await self.ai.usage(assignment_id=assignment.id),
        }


async def recover_interrupted_work(db: AsyncSession, older_than_minutes: int = INTERRUPTED_AFTER_MINUTES) -> dict:
    """Uploads, AI pre-grading runs and rubric drafts still marked as working long after they
    started were cut off by a restart: mark them failed so they can be started again."""
    from app.models.teacher_scan import QuestionRubric, TeacherGradingRun

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)
    batches = (await db.execute(select(TeacherScanBatch).where(
        TeacherScanBatch.status.in_(["queued", "processing"]), TeacherScanBatch.created_at < cutoff,
    ))).scalars().all()
    for batch in batches:
        batch.status, batch.error = "failed", "处理中断，请点“重新处理”"
    runs = (await db.execute(select(TeacherGradingRun).where(
        TeacherGradingRun.status.in_(["queued", "running"]), TeacherGradingRun.created_at < cutoff,
    ))).scalars().all()
    for run in runs:
        run.status, run.error = "failed", "预批中断；已批好的结果保留，可以重新开始预批其余作答"
        run.finished_at = datetime.now(timezone.utc)
    rubrics = (await db.execute(select(QuestionRubric).where(
        QuestionRubric.status == "drafting", QuestionRubric.updated_at < cutoff,
    ))).scalars().all()
    for rubric in rubrics:
        rubric.status, rubric.note = "failed", "起草中断，可以重试或手动填写"
    if batches or runs or rubrics:
        await db.commit()
    return {"batches": len(batches), "runs": len(runs), "rubrics": len(rubrics)}


async def purge_expired_scans(db: AsyncSession, root: Path | None = None, now: datetime | None = None) -> int:
    """Delete scan pages and the answer crops cut from them past the retention period; the records
    and scores stay, without images."""
    root = root or uploads_root()
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=settings.teacher_scan_retention_days)
    batches = (await db.execute(select(TeacherScanBatch).where(TeacherScanBatch.created_at < cutoff))).scalars().all()
    purged = 0
    for batch in batches:
        pages = (await db.execute(select(TeacherScanPage).where(TeacherScanPage.batch_id == batch.id))).scalars().all()
        for page in pages:
            if page.image_path:
                (root / page.image_path).unlink(missing_ok=True)
                page.image_path = None
                purged += 1
        # The answer crops cut from those pages go too.
        students = {page.student_id for page in pages if page.student_id and page.kind == "first"}
        if students:
            items = (await db.execute(
                select(TeacherSubmissionItem).join(TeacherSubmission, TeacherSubmission.id == TeacherSubmissionItem.submission_id)
                .where(TeacherSubmission.assignment_id == batch.assignment_id, TeacherSubmission.student_id.in_(students),
                       TeacherSubmission.source == "scan", TeacherSubmissionItem.crop_path.is_not(None))
            )).scalars().all()
            for item in items:
                (root / item.crop_path).unlink(missing_ok=True)
                item.crop_path = None
                purged += 1
        shutil.rmtree(root / f"teacher_scans/{batch.assignment_id}/{batch.id}", ignore_errors=True)
    await db.commit()
    return purged
