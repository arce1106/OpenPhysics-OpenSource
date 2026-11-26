"""The teacher's homework library: papers and personalized settings, assigned to classes.

A row without a class is the teacher's own paper (a class test) or settings (a
personalized homework). Assigning it gives each chosen class a row of its own that
points back through ``source_id``; that row then goes through the usual per-class
flow: print, collect, review, release. A class test is frozen as it is assigned; a
personalized homework is drafted per student and published after review.
"""
from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from statistics import mean

from sqlalchemy import func, or_, select

from app.models.teacher import TeacherAssignment, TeacherClass, TeacherStudentPaper
from app.models.teacher_scan import TeacherSubmission
from app.services.teacher_service import TeacherServiceError, mask_phone

MAX_CLASSES = 20


class TeacherLibraryService:
    def __init__(self, assignments):
        self.assignments = assignments  # TeacherAssignmentService
        self.db = assignments.db
        self.teachers = assignments.teachers

    # --- Listing ---

    async def _rows(self, teacher_id: str) -> list[TeacherAssignment]:
        result = await self.db.execute(
            select(TeacherAssignment).where(TeacherAssignment.teacher_id == teacher_id, TeacherAssignment.removed_at.is_(None))
            .order_by(TeacherAssignment.created_at.desc())
        )
        return list(result.scalars().all())

    async def _collected(self, ids: list[str]) -> dict[str, int]:
        if not ids:
            return {}
        result = await self.db.execute(
            select(TeacherSubmission.assignment_id, func.count())
            .where(TeacherSubmission.assignment_id.in_(ids)).group_by(TeacherSubmission.assignment_id)
        )
        return {assignment_id: int(count) for assignment_id, count in result.all()}

    async def _paper_students(self, ids: list[str]) -> dict[str, int]:
        """App-first homework still printed for some students: how many answer on paper."""
        if not ids:
            return {}
        result = await self.db.execute(
            select(TeacherStudentPaper.assignment_id, func.count())
            .where(TeacherStudentPaper.assignment_id.in_(ids), TeacherStudentPaper.delivery == "paper")
            .group_by(TeacherStudentPaper.assignment_id)
        )
        return {assignment_id: int(count) for assignment_id, count in result.all()}

    def _class_row(self, assignment: TeacherAssignment, classes: dict[str, TeacherClass],
                   counts: dict[str, int], collected: dict[str, int], on_paper: dict[str, int] | None = None) -> dict:
        teacher_class = classes.get(assignment.class_id)
        return {
            "id": assignment.id,
            "class_id": assignment.class_id,
            "class_name": teacher_class.name if teacher_class else "",
            "archived": bool(teacher_class and teacher_class.archived_at),
            "status": assignment.status,
            "created_at": assignment.created_at,
            "published_at": assignment.published_at,
            "results_released_at": assignment.results_released_at,
            "collected": collected.get(assignment.id, 0),
            "member_count": self.teachers.recipient_count(assignment, counts.get(assignment.class_id, 0)),
            "delivery": (assignment.settings or {}).get("delivery"),
            "paper_students": (on_paper or {}).get(assignment.id, 0),
        }

    async def library(self, teacher_id: str) -> list[dict]:
        """Every paper and set of settings with the classes it went to, newest activity first.
        A class row whose paper is gone (or that predates the library) stands on its own."""
        from app.services.teacher_homework_service import sync_open_homework

        rows = await self._rows(teacher_id)
        await sync_open_homework(self.db, rows)
        classes = {c.id: c for c in await self.teachers.list_classes([teacher_id], include_archived=True)}
        counts = await self.teachers.member_counts(list(classes))
        collected = await self._collected([row.id for row in rows if row.class_id])
        on_paper = await self._paper_students([row.id for row in rows if row.class_id])
        papers = {row.id: row for row in rows if not row.class_id}
        children: dict[str, list[TeacherAssignment]] = {paper_id: [] for paper_id in papers}
        groups = []
        for row in rows:
            if row.class_id and row.source_id in papers:
                children[row.source_id].append(row)
            elif row.class_id:
                groups.append((row, [row], False))
        groups.extend((paper, children[paper.id], True) for paper in papers.values())

        def latest(group) -> datetime:
            head, assigned, _ = group
            return max([head.created_at, *(child.created_at for child in assigned)])

        groups.sort(key=latest, reverse=True)
        return [{
            **self.assignments.summary(head),
            "is_paper": is_paper,
            "classes": [self._class_row(child, classes, counts, collected, on_paper)
                        for child in sorted(assigned, key=lambda child: child.created_at)],
        } for head, assigned, is_paper in groups]

    async def assigned(self, paper: TeacherAssignment) -> list[dict]:
        rows = (await self.db.execute(
            select(TeacherAssignment).where(TeacherAssignment.source_id == paper.id, TeacherAssignment.removed_at.is_(None))
            .order_by(TeacherAssignment.created_at)
        )).scalars().all()
        classes = {c.id: c for c in await self.teachers.list_classes([paper.teacher_id], include_archived=True)}
        counts = await self.teachers.member_counts(list(classes))
        collected = await self._collected([row.id for row in rows])
        on_paper = await self._paper_students([row.id for row in rows])
        return [self._class_row(row, classes, counts, collected, on_paper) for row in rows]

    # --- Creating, assigning and copying ---

    async def remove_task(self, teacher_id: str, assignment_id: str) -> None:
        """Remove the whole visible card, including its class executions, retaining evidence.

        Keeping the rows also protects partial App answers, unidentified scans, queued work,
        and released mastery from cascades. Old DELETE calls retain their source-only meaning.
        """
        assignment = await self.assignments.get_owned(teacher_id, assignment_id)
        condition = TeacherAssignment.id == assignment.id
        if not assignment.class_id:
            condition = or_(condition, TeacherAssignment.source_id == assignment.id)
        rows = (await self.db.scalars(select(TeacherAssignment).where(
            TeacherAssignment.teacher_id == teacher_id, condition,
        ).order_by(TeacherAssignment.id).with_for_update().execution_options(populate_existing=True))).all()
        now = datetime.now(timezone.utc)
        for row in rows:
            if row.removed_at is None:
                row.removed_at = now
        await self.db.commit()

    async def create_paper(self, teacher_id: str, title: str) -> TeacherAssignment:
        return await self.assignments.create(teacher_id, None, title)

    async def _classes(self, teacher_id: str, class_ids: list[str]) -> list[TeacherClass]:
        unique = list(dict.fromkeys(class_ids))
        if not unique:
            raise TeacherServiceError(400, "请至少选择一个班级")
        if len(unique) > MAX_CLASSES:
            raise TeacherServiceError(400, f"一次最多布置 {MAX_CLASSES} 个班级")
        chosen = []
        for class_id in unique:
            teacher_class = await self.teachers.get_owned_class(teacher_id, class_id)
            if teacher_class.archived_at is not None:
                raise TeacherServiceError(400, f"{teacher_class.name}已归档，不能布置作业")
            members = await self.teachers.list_members(class_id)
            if not [student for student in members if student.status == "active"]:
                raise TeacherServiceError(400, f"{teacher_class.name}还没有学生，无法布置")
            chosen.append(teacher_class)
        return chosen

    async def _paper_of(self, teacher_id: str, assignment_id: str) -> TeacherAssignment:
        """The library row behind an assignment; a class row without one gets one first."""
        assignment = await self.assignments.get_owned(teacher_id, assignment_id)
        if assignment.removed_at:
            raise TeacherServiceError(409, "作业已删除，不能再次布置")
        if not assignment.class_id:
            return assignment
        if assignment.source_id:
            source = await self.db.get(TeacherAssignment, assignment.source_id)
            if source and source.teacher_id == teacher_id and not source.class_id:
                return source
        paper = self._library_copy(assignment, title=assignment.title)
        self.db.add(paper)
        await self.db.flush()
        assignment.source_id = paper.id
        await self.db.commit()
        return paper

    @staticmethod
    def _library_copy(assignment: TeacherAssignment, *, title: str) -> TeacherAssignment:
        personalized = assignment.kind == "personalized"
        return TeacherAssignment(
            id=f"a_{uuid.uuid4().hex}", teacher_id=assignment.teacher_id, class_id=None,
            kind=assignment.kind, title=title, status="draft",
            items=[] if personalized else [dict(item) for item in assignment.items],
            settings={key: copy.deepcopy(value) for key, value in (assignment.settings or {}).items()
                      if key != "student_ids"} if personalized else None,
        )

    async def assign(self, teacher_id: str, assignment_id: str, class_ids: list[str], *,
                     student_ids_by_class: dict[str, list[str]] | None = None, delivery: str | None = None) -> list[TeacherAssignment]:
        """A class test is frozen for each class at once; a personalized homework is drafted
        for each class and waits for review."""
        paper = await self._paper_of(teacher_id, assignment_id)
        chosen = await self._classes(teacher_id, class_ids)
        if delivery is not None and delivery not in {"app", "paper"}:
            raise TeacherServiceError(400, "布置方式只能选择 App 或打印")
        if paper.kind != "personalized" and student_ids_by_class:
            raise TeacherServiceError(400, "测验按班级布置，不单独选择学生")
        recipients = await self._recipients(chosen, student_ids_by_class)
        if paper.kind == "personalized":
            return await self._assign_personalized(paper, chosen, recipients, delivery)
        if not paper.items:
            raise TeacherServiceError(400, "试卷里还没有题目")
        given = set((await self.db.scalars(select(TeacherAssignment.class_id).where(
            TeacherAssignment.source_id == paper.id))).all())
        repeated = [c.name for c in chosen if c.id in given]
        if repeated:
            raise TeacherServiceError(409, f"{'、'.join(repeated)}已经发布过这份试卷；要再考一次，请先复制成新卷")
        # Publishing a paper saves it first; a saved paper goes out exactly as it was printed.
        await self.assignments.freeze_paper(paper)
        items, snapshot = paper.items, paper.question_snapshot
        now = datetime.now(timezone.utc)
        created = []
        for teacher_class in chosen:
            members = [student for student in await self.teachers.list_members(teacher_class.id)
                       if student.status == "active"]
            numbers = await self.teachers.member_numbers(teacher_class.id)
            mode = delivery or "paper"
            row = TeacherAssignment(
                id=f"a_{uuid.uuid4().hex}", teacher_id=paper.teacher_id, class_id=teacher_class.id,
                source_id=paper.id, kind="test", title=paper.title, status="published",
                items=[dict(item) for item in items], question_snapshot=copy.deepcopy(snapshot), published_at=now,
                roster={student.id: numbers.get(student.id) for student in members},
                settings={"delivery": mode},
            )
            self.db.add(row)
            await self.db.flush()
            if mode == "app":
                from app.services.personalized_service import PersonalizedHomeworkService
                from app.services.teacher_homework_service import open_app_attempts

                # App first: a student who has never signed in would never see it, so they get it on paper.
                student_papers = [TeacherStudentPaper(id=f"sp_{uuid.uuid4().hex}", assignment_id=row.id,
                    student_id=student.id, items=copy.deepcopy(items), question_snapshot=copy.deepcopy(snapshot),
                    delivery=PersonalizedHomeworkService.default_delivery(student)) for student in members]
                self.db.add_all(student_papers)
                await open_app_attempts(self.db, row, student_papers)
            created.append(row)
        await self.db.commit()
        return created

    async def _recipients(self, chosen: list[TeacherClass], requested: dict[str, list[str]] | None) -> dict[str, list[str]]:
        requested = requested or {}
        if set(requested) - {teacher_class.id for teacher_class in chosen}:
            raise TeacherServiceError(400, "指定学生的班级必须是本次选择的班级")
        result = {}
        for teacher_class in chosen:
            if teacher_class.id not in requested:
                continue
            selected = list(dict.fromkeys(requested[teacher_class.id]))
            if not selected or len(selected) > 500:
                raise TeacherServiceError(400, f"{teacher_class.name}请至少选择一名学生，最多 500 名")
            members = {s.id for s in await self.teachers.list_members(teacher_class.id) if s.status == "active"}
            if set(selected) - members:
                raise TeacherServiceError(400, f"{teacher_class.name}所选学生不在本班或已停用，请刷新名单")
            result[teacher_class.id] = selected
        return result

    async def _assign_personalized(self, paper: TeacherAssignment, chosen: list[TeacherClass],
                                   recipients: dict[str, list[str]], delivery: str | None = None) -> list[TeacherAssignment]:
        personalized = self.assignments.personalized()
        await personalized._context(paper)  # the scope must hold usable questions before any class is drafted
        created = []
        for teacher_class in chosen:
            row = TeacherAssignment(
                id=f"a_{uuid.uuid4().hex}", teacher_id=paper.teacher_id, class_id=teacher_class.id,
                source_id=paper.id, kind="personalized", title=paper.title, status="draft", items=[],
                settings=copy.deepcopy(paper.settings),
            )
            # Reusable settings never retain another class's student IDs.
            row.settings.pop("student_ids", None)
            if delivery is not None:
                row.settings["delivery"] = delivery
            if teacher_class.id in recipients:
                row.settings["student_ids"] = recipients[teacher_class.id]
            self.db.add(row)
            await self.db.flush()
            await personalized.redraft_all(row)
            created.append(row)
        return created

    async def create_personalized(self, teacher_id: str, *, title: str, scope: list[dict], choice_count: int,
                                  area_count: int, class_ids: list[str],
                                  student_ids_by_class: dict[str, list[str]] | None = None,
                                  experiment_count: int | None = None, calculation_count: int | None = None,
                                  delivery: str | None = None) -> tuple[TeacherAssignment, list]:
        """Settings in the library, then one draft per chosen class."""
        settings = self.assignments.personalized().make_settings(scope, choice_count, area_count, experiment_count, calculation_count)
        if delivery is not None:
            if delivery not in {"app", "paper"}:
                raise TeacherServiceError(400, "布置方式只能选择 App 或打印")
            settings["delivery"] = delivery
        chosen = await self._classes(teacher_id, class_ids)
        await self._recipients(chosen, student_ids_by_class)
        paper = TeacherAssignment(
            id=f"a_{uuid.uuid4().hex}", teacher_id=teacher_id, class_id=None, kind="personalized",
            title=self.assignments._clean_title(title), status="draft", items=[],
            settings=settings,
        )
        self.db.add(paper)
        try:
            await self.assignments.personalized()._context(paper)
        except TeacherServiceError:
            await self.db.rollback()
            raise
        await self.db.commit()
        return paper, await self.assign(teacher_id, paper.id, class_ids, student_ids_by_class=student_ids_by_class, delivery=delivery)

    async def copy(self, teacher_id: str, assignment_id: str) -> TeacherAssignment:
        assignment = await self.assignments.get_owned(teacher_id, assignment_id)
        title = f"{assignment.title}（副本）"[:60]
        paper = self._library_copy(assignment, title=title)
        self.db.add(paper)
        await self.db.commit()
        return paper

    # --- One class's homework ---

    async def class_homework(self, teacher_id: str, class_id: str) -> dict:
        """Each homework given to the class with turn-in and score rates, and every student's
        scores in the homework whose results are released."""
        from app.services.teacher_homework_service import sync_open_homework

        await self.teachers.get_owned_class(teacher_id, class_id)
        rows = (await self.db.execute(
            select(TeacherAssignment).where(TeacherAssignment.class_id == class_id,
                or_(TeacherAssignment.removed_at.is_(None), TeacherAssignment.results_released_at.is_not(None)))
            .order_by(func.coalesce(TeacherAssignment.published_at, TeacherAssignment.created_at).desc())
        )).scalars().all()
        await sync_open_homework(self.db, list(rows))
        members = await self.teachers.list_members(class_id)
        numbers = await self.teachers.member_numbers(class_id)
        submissions = (await self.db.execute(
            select(TeacherSubmission).where(TeacherSubmission.assignment_id.in_([row.id for row in rows]))
        )).scalars().all() if rows else []
        by_assignment: dict[str, list[TeacherSubmission]] = {}
        for submission in submissions:
            by_assignment.setdefault(submission.assignment_id, []).append(submission)
        paper_points = await self._paper_points([row.id for row in rows if row.kind == "personalized"])

        def full_points(row: TeacherAssignment, student_id: str) -> float | None:
            if row.kind == "personalized":
                return paper_points.get((row.id, student_id))
            return sum(float(item["points"]) for item in row.items) or None

        assignments, scores, missing = [], {}, {}
        for row in rows:
            mine = by_assignment.get(row.id, [])
            released = bool(row.results_released_at)
            if released:
                # Expected from everyone the homework went out to (older rows: today's class).
                expected = set(row.roster) if row.roster is not None else {student.id for student in members}
                handed_in = {s.student_id for s in mine if s.total_score is not None}
                for student_id in expected - handed_in:
                    missing.setdefault(student_id, []).append(row.id)
            rates, totals = [], []
            for submission in mine:
                if not released or submission.total_score is None:
                    continue
                full = full_points(row, submission.student_id)
                totals.append(submission.total_score)
                if full:
                    rates.append(submission.total_score / full)
                scores.setdefault(submission.student_id, {})[row.id] = {
                    "score": submission.total_score, "full": full,
                }
            assignments.append({
                **self.assignments.summary(row),
                "collected": sum(1 for s in mine if s.total_score is not None) if released else len(mine),
                "member_count": self.teachers.recipient_count(row, len(members)),
                "average": round(mean(totals), 2) if totals else None,
                "rate": round(mean(rates), 4) if rates else None,
            })
        students = [{
            "student_id": student.id,
            "display_name": mask_phone(student.display_name),
            "student_number": numbers.get(student.id),
            "scores": scores.get(student.id, {}),
            # Released homework this student was given but did not hand in.
            "missing": missing.get(student.id, []),
        } for student in members]
        students.sort(key=lambda row: (row["student_number"] is None, int(row["student_number"] or 0), row["display_name"]))
        return {"assignments": assignments, "students": students}

    async def _paper_points(self, assignment_ids: list[str]) -> dict[tuple[str, str], float]:
        if not assignment_ids:
            return {}
        papers = (await self.db.execute(
            select(TeacherStudentPaper).where(TeacherStudentPaper.assignment_id.in_(assignment_ids))
        )).scalars().all()
        return {(paper.assignment_id, paper.student_id): sum(float(item["points"]) for item in paper.items)
                for paper in papers}
