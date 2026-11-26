import base64
import hashlib
import hmac
import io
import json
import math
import re
import secrets
import shutil
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import time

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from PIL import Image, ImageDraw, ImageFont

from app.core.config import settings
from app.models.learning import LearningProgress
from app.models.improvement import (
    StudentImprovementPlan,
    StudentImprovementRetestAttempt,
    StudentImprovementTask,
    StudentScopeDiagnosticAttempt,
    StudentScopeDiagnosticKpResult,
)
from app.models.question import Question, QuestionLabel
from app.models.teacher_paper import TeacherPaperAttempt
from app.models.reward import (
    GrowthReport,
    LearningEvent,
    RewardRecord,
    StudentBadge,
    StudentQuestProgress,
    StudentXp,
)
from app.models.student import (
    ItemStats,
    Student,
    StudentAnswer,
    StudentAiExecution,
    StudentCaptchaChallenge,
    StudentMastery,
    StudentWebLoginTicket,
)
from app.services.knowledge_tracing import KnowledgeTracingEngine
from app.services.learning_evidence import (
    MasteryEvidence, answer_mastery_evidence, answer_observed_at, mastery_values_after_evidence,
)
from app.services.physics_error_types import PHYSICS_ERROR_TYPES, effective_process_grading
from app.services.mastery_scope import includes_basic_mastery, topic_answer_score
from app.services.grading_reliability import (
    CHOICE_QUESTION_TYPES,
    PENDING_FLAG,
    is_deterministic_grading,
    is_pending_confirmation,
)
from app.models.learning_catalog import LearningCatalogNodeEvidence
from app.services.answer_media_service import AnswerMediaService

FORGETTING_LAMBDA = 0.05  # half-life ~14 days
PASSWORD_ITERATIONS = 260_000
REGISTRATION_CODE_TTL_MINUTES = 10
REGISTRATION_CODE_MAX_ATTEMPTS = 5
CAPTCHA_TTL_MINUTES = 5
CAPTCHA_MAX_ATTEMPTS = 5
CAPTCHA_HASH_PREFIX = "hmac_sha256$"
CAPTCHA_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
PHONE_RE = re.compile(r"^1[3-9]\d{9}$")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


class CorrectionNotAllowed(ValueError):
    """A grading result that students cannot override."""


class StudentService:
    def __init__(self, db: AsyncSession, answer_upload_root: Path | None = None):
        self.db = db
        self.answer_upload_root = answer_upload_root or (
            AnswerMediaService().static_dir / "uploads" / "answers"
        )

    @staticmethod
    def hash_password(password: str) -> str:
        salt = secrets.token_urlsafe(16)
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            PASSWORD_ITERATIONS,
        )
        return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt}${_b64url(digest)}"

    @staticmethod
    def verify_password(password: str, password_hash: str) -> bool:
        try:
            algorithm, iterations_raw, salt, expected = password_hash.split("$", 3)
            if algorithm != "pbkdf2_sha256":
                return False
            digest = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                salt.encode("utf-8"),
                int(iterations_raw),
            )
            return hmac.compare_digest(_b64url(digest), expected)
        except Exception:
            return False

    @staticmethod
    def create_access_token(student_id: str, auth_version: int = 0) -> str:
        header = {"alg": "HS256", "typ": "JWT"}
        payload = {
            "sub": student_id,
            "ver": auth_version,
            "exp": int(time()) + settings.student_access_token_minutes * 60,
        }
        header_part = _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
        payload_part = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        signing_input = f"{header_part}.{payload_part}".encode("ascii")
        signature = hmac.new(
            settings.student_auth_secret.encode("utf-8"),
            signing_input,
            hashlib.sha256,
        ).digest()
        return f"{header_part}.{payload_part}.{_b64url(signature)}"

    @staticmethod
    def decode_access_token(token: str) -> str | None:
        try:
            header_part, payload_part, signature_part = token.split(".", 2)
            signing_input = f"{header_part}.{payload_part}".encode("ascii")
            expected_sig = hmac.new(
                settings.student_auth_secret.encode("utf-8"),
                signing_input,
                hashlib.sha256,
            ).digest()
            if not hmac.compare_digest(_b64url(expected_sig), signature_part):
                return None
            payload = json.loads(_b64url_decode(payload_part))
            if int(payload.get("exp", 0)) < int(time()):
                return None
            sub = payload.get("sub")
            return sub if isinstance(sub, str) and sub else None
        except Exception:
            return None

    @staticmethod
    def token_matches_auth_version(token: str, student: Student) -> bool:
        # The caller verifies signature/expiry first. Missing ver denotes a
        # pre-migration token and is valid only until that student's first reset.
        try:
            payload = json.loads(_b64url_decode(token.split(".", 2)[1]))
            version = payload.get("ver", 0)
            return type(version) is int and version == student.auth_version
        except (ValueError, TypeError, IndexError):
            return False

    @staticmethod
    def hash_web_login_ticket(ticket: str) -> str:
        return hashlib.sha256(ticket.encode("utf-8")).hexdigest()

    async def create_web_login_ticket(
        self, student_id: str, *, source_access_token: str | None = None,
    ) -> tuple[str, datetime] | None:
        student = await self.get_student(student_id)
        if not student or student.status != "active":
            return None
        if source_access_token is not None and (
            self.decode_access_token(source_access_token) != student_id
            or not self.token_matches_auth_version(source_access_token, student)
        ):
            return None
        # Bind the ticket to this proof's version. A reset after this point can
        # invalidate the ticket, but can never upgrade it to the reset version.
        verified_version = student.auth_version
        ticket = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(minutes=settings.student_web_login_ticket_minutes)
        self.db.add(
            StudentWebLoginTicket(
                ticket_hash=self.hash_web_login_ticket(ticket),
                student_id=student.id,
                auth_version=verified_version,
                expires_at=expires_at,
            )
        )
        await self.db.commit()
        return ticket, expires_at

    async def consume_web_login_ticket(self, ticket: str) -> Student | None:
        if not ticket or len(ticket) > 256:
            return None
        ticket_hash = self.hash_web_login_ticket(ticket)
        now = datetime.now(timezone.utc)
        candidate = (await self.db.execute(
            select(StudentWebLoginTicket.student_id, StudentWebLoginTicket.auth_version).where(
                StudentWebLoginTicket.ticket_hash == ticket_hash,
                StudentWebLoginTicket.consumed_at.is_(None),
                StudentWebLoginTicket.expires_at > now,
            )
        )).one_or_none()
        if not candidate:
            return None
        verified_version = candidate.auth_version
        # Rotation also locks student before deleting tickets. Keep the same
        # order, and never exchange a ticket against a newer credential version.
        current = await self.db.execute(
            update(Student).where(
                Student.id == candidate.student_id,
                Student.auth_version == verified_version,
                Student.status == "active",
            ).values(last_login_at=now).returning(Student.id)
            .execution_options(synchronize_session=False)
        )
        if current.scalar_one_or_none() is None:
            await self.db.rollback()
            return None
        result = await self.db.execute(
            update(StudentWebLoginTicket)
            .where(
                StudentWebLoginTicket.ticket_hash == ticket_hash,
                StudentWebLoginTicket.auth_version == verified_version,
                StudentWebLoginTicket.consumed_at.is_(None),
                StudentWebLoginTicket.expires_at > now,
            )
            .values(consumed_at=now)
            .returning(StudentWebLoginTicket.student_id, StudentWebLoginTicket.auth_version)
        )
        ticket_row = result.one_or_none()
        if not ticket_row:
            await self.db.rollback()
            return None
        student = await self.get_student(ticket_row.student_id)
        if not student:
            await self.db.rollback()
            return None
        await self.db.commit()
        await self.db.refresh(student)
        if student.status != "active" or student.auth_version != verified_version:
            return None
        return student

    @staticmethod
    def _as_aware(value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


    @staticmethod
    def serialize_student(student: Student) -> dict:
        return {
            "id": student.id,
            "username": student.username,
            "phone": student.phone,
            "display_name": student.display_name,
            "class_name": student.class_name,
            "grade": student.grade,
            "account_source": student.account_source,
            "status": student.status,
            "last_login_at": student.last_login_at.isoformat() if student.last_login_at else None,
            "created_at": student.created_at.isoformat() if student.created_at else None,
        }

    async def create_student(
        self,
        username: str,
        password: str,
        display_name: str,
        class_name: str | None = None,
        status: str = "active",
        phone: str | None = None,
        grade: str | None = None,
        account_source: str = "admin",
    ) -> Student:
        student = Student(
            id=uuid.uuid4().hex,
            username=username.strip(),
            phone=self.normalize_phone(phone) if phone else None,
            password_hash=self.hash_password(password),
            display_name=display_name.strip(),
            class_name=class_name.strip() if class_name else None,
            grade=grade.strip() if grade else None,
            account_source=account_source,
            status=status,
        )
        self.db.add(student)
        await self.db.commit()
        await self.db.refresh(student)
        return student

    @staticmethod
    def normalize_phone(phone: str) -> str | None:
        compact = (phone or "").strip()
        return compact if PHONE_RE.fullmatch(compact) else None


    @staticmethod
    def generate_captcha_answer(length: int = 4) -> str:
        return "".join(secrets.choice(CAPTCHA_CHARS) for _ in range(length))

    @staticmethod
    def render_captcha_image(answer: str) -> str:
        image = Image.new("RGB", (128, 48), color=(247, 250, 252))
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default(size=28)
        for _ in range(24):
            x = secrets.randbelow(128)
            y = secrets.randbelow(48)
            color = (
                120 + secrets.randbelow(80),
                120 + secrets.randbelow(80),
                120 + secrets.randbelow(80),
            )
            draw.point((x, y), fill=color)
        for index, char in enumerate(answer):
            x = 10 + index * 27 + secrets.randbelow(3)
            y = 4 + secrets.randbelow(5)
            draw.text((x, y), char, fill=(28, 45, 56), font=font)
        for _ in range(3):
            y = 8 + secrets.randbelow(32)
            draw.line((8, y, 120, y + secrets.randbelow(9) - 4), fill=(170, 185, 195), width=1)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/png;base64,{encoded}"

    @staticmethod
    def hash_captcha_answer(challenge_id: str, answer: str) -> str:
        # A short-lived, attempt-limited challenge needs no slow password hash; the
        # keyed digest keeps answers private without blocking the event loop.
        digest = hmac.new(
            settings.student_auth_secret.encode("utf-8"),
            f"captcha:{challenge_id}:{answer.strip().upper()}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"{CAPTCHA_HASH_PREFIX}{digest}"

    @classmethod
    def verify_captcha_answer(cls, challenge_id: str, answer: str, answer_hash: str) -> bool:
        normalized = answer.strip().upper()
        if answer_hash.startswith(CAPTCHA_HASH_PREFIX):
            return hmac.compare_digest(cls.hash_captcha_answer(challenge_id, normalized), answer_hash)
        # Challenges issued before the switch (valid for a few minutes) used PBKDF2.
        return cls.verify_password(normalized, answer_hash)

    async def request_captcha(self, *, return_debug_answer: bool = False) -> dict:
        answer = self.generate_captcha_answer()
        challenge_id = uuid.uuid4().hex
        record = StudentCaptchaChallenge(
            id=challenge_id,
            answer_hash=self.hash_captcha_answer(challenge_id, answer),
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=CAPTCHA_TTL_MINUTES),
        )
        self.db.add(record)
        await self.db.commit()
        result = {
            "challenge_id": challenge_id,
            "image_base64": self.render_captcha_image(answer),
            "expires_in_seconds": CAPTCHA_TTL_MINUTES * 60,
        }
        if return_debug_answer and settings.app_env.lower() != "production":
            result["debug_answer"] = answer
        return result

    async def verify_captcha(self, challenge_id: str | None, answer: str | None) -> bool:
        if not challenge_id or not answer:
            return False
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            select(StudentCaptchaChallenge).where(
                StudentCaptchaChallenge.id == challenge_id.strip(),
                StudentCaptchaChallenge.consumed_at.is_(None),
                StudentCaptchaChallenge.expires_at >= now,
            ).with_for_update()
        )
        challenge = result.scalar_one_or_none()
        if not challenge or challenge.attempts >= CAPTCHA_MAX_ATTEMPTS:
            await self.db.rollback()
            return False
        challenge.attempts += 1
        if not self.verify_captcha_answer(challenge.id, answer, challenge.answer_hash):
            await self.db.commit()
            return False
        challenge.consumed_at = now
        await self.db.commit()
        return True


    @staticmethod
    def generate_username() -> str:
        # Fixed letters plus random hexadecimal and a digit: always alphanumeric,
        # never derived from a phone number or other personal information.
        return "yz" + secrets.token_hex(5) + str(secrets.randbelow(10))

    async def generate_available_username(self) -> str | None:
        for _ in range(5):
            username = self.generate_username()
            if not await self.get_student_by_username(username):
                return username
        return None


    async def get_student(self, student_id: str) -> Student | None:
        result = await self.db.execute(
            select(Student).where(Student.id == student_id)
        )
        return result.scalar_one_or_none()

    async def get_student_by_username(self, username: str) -> Student | None:
        result = await self.db.execute(
            select(Student).where(Student.username == username.strip())
        )
        return result.scalar_one_or_none()


    async def list_students(self) -> list[Student]:
        result = await self.db.execute(select(Student).where(Student.status != "deleted").order_by(Student.created_at.desc()))
        return list(result.scalars().all())

    async def update_student(
        self,
        student_id: str,
        display_name: str | None = None,
        class_name: str | None = None,
        status: str | None = None,
    ) -> Student | None:
        student = await self.db.scalar(select(Student).where(Student.id == student_id)
            .with_for_update().execution_options(populate_existing=True))
        if not student or student.status == "deleted":
            return None
        if display_name is not None:
            student.display_name = display_name.strip()
        if class_name is not None:
            student.class_name = class_name.strip() or None
        if status is not None:
            student.status = status
        await self.db.commit()
        await self.db.refresh(student)
        return student

    async def reset_student_password(self, student_id: str, password: str) -> Student | None:
        student = await self.get_student(student_id)
        if not student or student.status == "deleted":
            return None
        if not await self._rotate_student_credentials(student, password):
            await self.db.rollback()
            return None
        await self.db.commit()
        await self.db.refresh(student)
        return student

    async def change_student_password(
        self,
        username: str,
        current_password: str,
        new_password: str,
    ) -> Student | None:
        student = await self.get_student_by_username(username)
        if not student or student.status != "active":
            return None
        if student.phone:
            return None
        verified_version = student.auth_version
        if not self.verify_password(current_password, student.password_hash):
            return None
        if not await self._rotate_student_credentials(
            student, new_password, expected_auth_version=verified_version,
        ):
            await self.db.rollback()
            return None
        await self.db.commit()
        await self.db.refresh(student)
        return student

    async def _rotate_student_credentials(
        self, student: Student, password: str, *, expected_auth_version: int | None = None,
    ) -> bool:
        statement = update(Student).where(Student.id == student.id, Student.status != "deleted")
        if expected_auth_version is not None:
            statement = statement.where(
                Student.auth_version == expected_auth_version, Student.status == "active",
            )
        result = await self.db.execute(
            statement.values(
                password_hash=self.hash_password(password),
                auth_version=Student.auth_version + 1,
            ).returning(Student.auth_version)
        )
        if result.scalar_one_or_none() is None:
            return False
        await self.db.execute(delete(StudentWebLoginTicket).where(StudentWebLoginTicket.student_id == student.id))
        return True

    async def reset_student_account(self, student_id: str) -> dict | None:
        student = await self.get_student(student_id)
        if not student:
            return None

        deleted = {
            "student_ai_executions": await self._delete_student_rows(StudentAiExecution, student_id),
            "student_answers": await self._delete_student_rows(StudentAnswer, student_id),
            "teacher_paper_attempts": await self._delete_student_rows(TeacherPaperAttempt, student_id),
            "student_mastery": await self._delete_student_rows(StudentMastery, student_id),
            "learning_progress": await self._delete_student_rows(LearningProgress, student_id),
            "learning_events": await self._delete_student_rows(LearningEvent, student_id),
            "student_xp": await self._delete_student_rows(StudentXp, student_id),
            "reward_records": await self._delete_student_rows(RewardRecord, student_id),
            "student_badges": await self._delete_student_rows(StudentBadge, student_id),
            "student_quest_progress": await self._delete_student_rows(StudentQuestProgress, student_id),
            "growth_reports": await self._delete_student_rows(GrowthReport, student_id),
            "student_improvement_retest_attempts": await self._delete_student_rows(StudentImprovementRetestAttempt, student_id),
            "student_improvement_tasks": await self._delete_student_rows(StudentImprovementTask, student_id),
            "student_improvement_plans": await self._delete_student_rows(StudentImprovementPlan, student_id),
            "student_scope_diagnostic_kp_results": await self._delete_student_rows(StudentScopeDiagnosticKpResult, student_id),
            "student_scope_diagnostic_attempts": await self._delete_student_rows(StudentScopeDiagnosticAttempt, student_id),
        }
        student.last_login_at = None
        await self.db.commit()
        await self.db.refresh(student)
        self._remove_answer_uploads(student_id)
        return {"student": student, "deleted": deleted}

    async def _delete_student_rows(self, model, student_id: str) -> int:
        result = await self.db.execute(delete(model).where(model.student_id == student_id))
        return int(result.rowcount or 0)

    def _remove_answer_uploads(self, student_id: str) -> None:
        target = self.answer_upload_root / student_id
        if not target.exists():
            return
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
            return
        target.unlink(missing_ok=True)

    async def authenticate_student(self, username: str, password: str) -> Student | None:
        student = await self.get_student_by_username(username)
        if not student or student.status != "active":
            return None
        verified_version = student.auth_version
        if not self.verify_password(password, student.password_hash):
            return None
        result = await self.db.execute(
            update(Student).where(
                Student.id == student.id,
                Student.auth_version == verified_version,
                Student.status == "active",
            ).values(last_login_at=datetime.now(timezone.utc)).returning(Student.id)
            .execution_options(synchronize_session=False)
        )
        if result.scalar_one_or_none() is None:
            await self.db.rollback()
            return None
        await self.db.commit()
        await self.db.refresh(student)
        # A reset can commit between our commit and refresh. Its newer version
        # must never be issued to the password verified before that reset.
        if student.status != "active" or student.auth_version != verified_version:
            return None
        return student

    @staticmethod
    def get_effective_mastery(mastery: float, last_practiced: datetime | None) -> float:
        """Return the configured mastery value used by recommendation routes.

        Forgetting remains opt-in until product calibration is complete.
        """
        if not settings.mastery_forgetting_enabled or last_practiced is None:
            return mastery
        days = (datetime.now(timezone.utc) - last_practiced).total_seconds() / 86400.0
        return mastery * math.exp(-FORGETTING_LAMBDA * max(0, days))

    async def get_mastery(self, student_id: str, kp_id: str) -> StudentMastery | None:
        result = await self.db.execute(
            select(StudentMastery).where(
                StudentMastery.student_id == student_id,
                StudentMastery.knowledge_point_id == kp_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_all_mastery(self, student_id: str) -> list[StudentMastery]:
        result = await self.db.execute(
            select(StudentMastery).where(StudentMastery.student_id == student_id)
        )
        return list(result.scalars().all())

    async def _get_or_create_mastery(self, student_id: str, kp_id: str) -> StudentMastery:
        stmt = (
            pg_insert(StudentMastery)
            .values(
                student_id=student_id,
                knowledge_point_id=kp_id,
                attempts=0,
                correct_rate=0.0,
                mastery=KnowledgeTracingEngine().initial_p_l(),
            )
            .on_conflict_do_nothing(
                index_elements=[
                    StudentMastery.student_id,
                    StudentMastery.knowledge_point_id,
                ]
            )
        )
        await self.db.execute(stmt)
        result = await self.db.execute(
            select(StudentMastery).where(
                StudentMastery.student_id == student_id,
                StudentMastery.knowledge_point_id == kp_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        mastery = result.scalar_one_or_none()
        if not mastery:
            raise RuntimeError(f"Failed to load mastery for student={student_id}, kp={kp_id}")
        return mastery

    async def update_mastery(
        self, student_id: str, kp_id: str, correct: bool,
        question: Question | None = None,
        learning_transfer: bool = True,
        initial_mastery: float | None = None,
        commit: bool = True,
    ) -> StudentMastery:
        return await self._update_mastery_from_evidence(
            student_id, kp_id,
            MasteryEvidence(correct, float(correct), learning_transfer=learning_transfer,
                            initial_mastery=initial_mastery),
            question=question, commit=commit,
        )

    async def update_mastery_with_score(
        self,
        student_id: str,
        kp_id: str,
        score: float,
        evidence_weight: float = 0.35,
        initial_mastery: float | None = None,
        commit: bool = True,
    ) -> StudentMastery:
        """Update mastery with a low-trust fractional score, used for self review."""
        score = max(0.0, min(1.0, float(score)))
        evidence_weight = max(0.0, min(1.0, float(evidence_weight)))
        return await self._update_mastery_from_evidence(
            student_id, kp_id,
            MasteryEvidence(score >= 0.8, score, evidence_weight, initial_mastery=initial_mastery),
            commit=commit,
        )

    async def update_mastery_from_answer(
        self, student_id: str, kp_id: str, question: Question,
        is_correct: bool, given_answer: str, grading: dict | None, *, commit: bool = True,
    ) -> StudentMastery:
        return await self._update_mastery_from_evidence(
            student_id, kp_id, answer_mastery_evidence(question, is_correct, given_answer, grading),
            question=question, commit=commit,
        )

    async def _update_mastery_from_evidence(
        self, student_id: str, kp_id: str, evidence: MasteryEvidence,
        *, question: Question | None = None, commit: bool = True,
    ) -> StudentMastery:
        mastery = await self._get_or_create_mastery(student_id, kp_id)
        values = mastery_values_after_evidence(
            prior=mastery.mastery, attempts=mastery.attempts, correct_rate=mastery.correct_rate,
            last_practiced=mastery.last_practiced, observed_at=datetime.now(timezone.utc),
            evidence=evidence, question=question, forgetting_enabled=settings.mastery_forgetting_enabled,
        )
        for name, value in values.items():
            setattr(mastery, name, value)
        if commit:
            await self.db.commit()
        else:
            await self.db.flush()
        await self.db.refresh(mastery)
        return mastery

    async def record_answer(
        self,
        student_id: str,
        question_id: str,
        given_answer: str,
        is_correct: bool,
        time_spent_ms: int = 0,
        misconception_ids: list[str] | None = None,
        grading_result: dict | None = None,
        submission_id: str | None = None,
        commit: bool = True,
        teacher_paper_attempt_id: str | None = None,
    ) -> StudentAnswer:
        answer = StudentAnswer(
            student_id=student_id,
            question_id=question_id,
            submission_id=submission_id,
            teacher_paper_attempt_id=teacher_paper_attempt_id,
            given_answer=given_answer,
            is_correct=is_correct,
            time_spent_ms=time_spent_ms,
            misconception_ids=misconception_ids or [],
            grading_result=grading_result,
        )
        self.db.add(answer)
        if teacher_paper_attempt_id:
            from app.services.teacher_paper_service import finish_if_complete
            await finish_if_complete(self.db, student_id, teacher_paper_attempt_id)
        if commit:
            await self.db.commit()
        else:
            await self.db.flush()
        await self.db.refresh(answer)
        return answer

    async def get_answer_by_submission(
        self,
        student_id: str,
        question_id: str,
        submission_id: str | None,
        teacher_paper_attempt_id: str | None = None,
    ) -> StudentAnswer | None:
        if not submission_id and not teacher_paper_attempt_id:
            return None
        result = await self.db.execute(
            select(StudentAnswer).where(
                StudentAnswer.student_id == student_id,
                StudentAnswer.question_id == question_id,
                *([StudentAnswer.teacher_paper_attempt_id == teacher_paper_attempt_id]
                  if teacher_paper_attempt_id else [StudentAnswer.submission_id == submission_id]),
            )
        )
        return result.scalar_one_or_none()

    async def get_answer_history(
        self,
        student_id: str,
        limit: int = 50,
        offset: int = 0,
        from_dt: datetime | None = None,
        to_dt: datetime | None = None,
    ) -> list[StudentAnswer]:
        stmt = (
            select(StudentAnswer)
            .where(StudentAnswer.student_id == student_id)
        )
        if from_dt is not None:
            stmt = stmt.where(StudentAnswer.created_at >= from_dt)
        if to_dt is not None:
            stmt = stmt.where(StudentAnswer.created_at < to_dt)
        stmt = (
            stmt
            .order_by(StudentAnswer.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self.db.execute(
            stmt
        )
        return list(result.scalars().all())

    async def find_recent_paper_batch_answer(
        self,
        student_id: str,
        question_id: str,
        given_answer: str,
        within_minutes: int = 30,
    ) -> StudentAnswer | None:
        """Find a recent paper-batch record so final evaluation does not duplicate it."""
        since = datetime.now(timezone.utc) - timedelta(minutes=within_minutes)
        result = await self.db.execute(
            select(StudentAnswer)
            .where(
                StudentAnswer.student_id == student_id,
                StudentAnswer.question_id == question_id,
                StudentAnswer.teacher_paper_attempt_id.is_(None),
                StudentAnswer.created_at >= since,
            )
            .order_by(StudentAnswer.created_at.desc(), StudentAnswer.id.desc())
            .limit(20)
        )
        expected = self._normalize_answer_for_reuse(given_answer)
        for answer in result.scalars().all():
            grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
            has_image = bool(grading.get("answer_image_path") or grading.get("answer_image_paths"))
            is_paper_batch = grading.get("answer_source") == "paper_batch"
            if not has_image or not is_paper_batch:
                continue
            if self._normalize_answer_for_reuse(answer.given_answer or "") == expected:
                return answer
        return None

    @staticmethod
    def _normalize_answer_for_reuse(value: str) -> str:
        return "".join(str(value or "").split()).strip()

    async def get_answer(self, student_id: str, answer_id: int) -> StudentAnswer | None:
        result = await self.db.execute(
            select(StudentAnswer).where(
                StudentAnswer.id == answer_id,
                StudentAnswer.student_id == student_id,
            )
        )
        return result.scalar_one_or_none()

    async def apply_manual_correction(
        self,
        student_id: str,
        answer_id: int,
        corrected_answer: str,
        is_correct: bool,
        correction_reason: str = "",
        error_type: str | None = None,
    ) -> dict:
        """Correct the original answer record and rebuild affected mastery."""
        answer = await self.get_answer(student_id, answer_id)
        if not answer:
            raise ValueError("Answer not found")

        question = await self.db.get(Question, answer.question_id)
        if not question:
            raise ValueError("Question not found")

        grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
        if grading.get("_teacher_review"):
            raise CorrectionNotAllowed("这份作业已由老师审核发布，请联系老师核实批改结果。")
        kp_id = self._evidence_kp_from_grading(grading)
        if not kp_id:
            kp_id = await self._primary_kp_for_question(answer.question_id)
        if not kp_id:
            raise ValueError("Knowledge point not found")

        question_type = question.question_type.value if question.question_type else ""
        if question_type in CHOICE_QUESTION_TYPES and is_deterministic_grading(grading):
            # Tapped options were compared with the key; there is no AI verdict to dispute.
            raise CorrectionNotAllowed("选择题按所选选项自动判分，不能修改对错。")

        # Use the same per-student/KP lock as new submissions before replaying
        # history, so a correction cannot overwrite concurrent learning evidence.
        update_basic = includes_basic_mastery(grading)
        before_mastery = await self._get_or_create_mastery(student_id, kp_id) if update_basic else None
        before = before_mastery.mastery if before_mastery else 0.0
        if not update_basic:
            await self.db.execute(select(StudentAnswer).where(StudentAnswer.id == answer.id)
                                  .with_for_update().execution_options(populate_existing=True))
        await self.db.refresh(answer)
        previous_correct = answer.is_correct
        grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
        if grading.get("_teacher_review"):
            raise CorrectionNotAllowed("这份作业已由老师审核发布，请联系老师核实批改结果。")
        update_basic = includes_basic_mastery(grading)
        if error_type not in PHYSICS_ERROR_TYPES:
            error_type = None

        grading = {
            **grading,
            "_original_grading": grading.get("_original_grading") or dict(grading),
            "manual_correction": {
                "corrected_answer": corrected_answer,
                "is_correct": is_correct,
                "reason": correction_reason,
                "error_type": error_type or ("none" if is_correct else "unknown"),
            },
            "needs_human_review": False,
            "grading_basis": correction_reason or "已按学生人工纠错结果修正。",
        }
        # The student's confirmation resolves a pending AI verdict.
        grading.pop(PENDING_FLAG, None)
        grading["_evidence_knowledge_point_id"] = kp_id
        if is_correct:
            grading["error_type"] = "none"
            grading["error_type_name"] = "无明显错误"
            answer.misconception_ids = []
            answer.reviewed_at = datetime.now(timezone.utc)
        else:
            corrected_error = error_type or "unknown"
            if corrected_error == "none":
                corrected_error = "unknown"
            grading["error_type"] = corrected_error
            answer.misconception_ids = [corrected_error] if corrected_error != "unknown" else []
            answer.reviewed_at = None

        answer.given_answer = corrected_answer
        answer.is_correct = is_correct
        grading = effective_process_grading(grading)
        answer.grading_result = grading
        updated = await self.rebuild_mastery_for_kp(student_id, kp_id) if update_basic else None
        mastery_update = {kp_id: {"before": before, "after": updated.mastery, "name": ""}} if updated else {}
        answer.grading_result = {**grading, "_mastery_update": mastery_update}
        await self.db.execute(update(LearningCatalogNodeEvidence).where(
            LearningCatalogNodeEvidence.answer_id == answer.id,
            LearningCatalogNodeEvidence.student_id == student_id,
        ).values(score=topic_answer_score(answer)))
        if previous_correct != is_correct:
            corrected_rate = func.greatest(0.0, func.least(1.0,
                (ItemStats.correct_rate * ItemStats.total_attempts + int(is_correct) - int(previous_correct))
                / func.nullif(ItemStats.total_attempts, 0),
            ))
            await self.db.execute(update(ItemStats).where(
                ItemStats.question_id == answer.question_id, ItemStats.total_attempts > 0,
            ).values(correct_rate=corrected_rate, difficulty_estimate=1.0 - corrected_rate))
        await self.db.commit()
        await self.db.refresh(answer)

        return {
            "answer_id": answer.id,
            "question_id": answer.question_id,
            "is_correct": answer.is_correct,
            "given_answer": answer.given_answer,
            "mastery_update": mastery_update,
            "process_grading": answer.grading_result,
        }

    async def _primary_kp_for_question(self, question_id: str) -> str | None:
        result = await self.db.execute(
            select(QuestionLabel.label_id)
            .where(
                QuestionLabel.question_id == question_id,
                QuestionLabel.label_type == "knowledge_point",
            )
            .order_by(
                case(
                    (QuestionLabel.role.in_(["primary", "主要"]), 0),
                    else_=1,
                ),
                QuestionLabel.confidence.desc().nullslast(),
                QuestionLabel.label_id,
            )
            .limit(1)
        )
        return result.scalar_one_or_none()

    @staticmethod
    def _evidence_kp_from_grading(grading: dict | None) -> str | None:
        if not isinstance(grading, dict):
            return None
        stored = grading.get("_evidence_knowledge_point_id")
        if isinstance(stored, str) and stored.strip():
            return stored.strip()
        mastery_update = grading.get("_mastery_update")
        if isinstance(mastery_update, dict) and len(mastery_update) == 1:
            return str(next(iter(mastery_update))).strip() or None
        return None

    @staticmethod
    def _primary_kp_from_loaded_question(question: Question, allowed_ids: set[str] | None = None) -> str | None:
        labels = [
            label
            for label in (question.labels or [])
            if label.label_type == "knowledge_point"
            and (allowed_ids is None or label.label_id in allowed_ids)
        ]
        if not labels:
            return None
        labels.sort(
            key=lambda label: (
                0 if str(label.role or "").strip().lower() in {"primary", "主要"} else 1,
                -float(label.confidence or 0.0),
                label.label_id,
            )
        )
        return labels[0].label_id

    @classmethod
    def evidence_knowledge_point_id(
        cls, answer: StudentAnswer, question: Question, allowed_ids: set[str] | None = None,
    ) -> str | None:
        if not includes_basic_mastery(answer.grading_result):
            return None
        stored = cls._evidence_kp_from_grading(answer.grading_result)
        if stored:
            return stored if allowed_ids is None or stored in allowed_ids else None
        # Legacy records have no session target; preserve the primary-label
        # fallback inside the requested scope without reassigning newer evidence.
        return cls._primary_kp_from_loaded_question(question, allowed_ids)

    async def rebuild_mastery_for_kp(
        self, student_id: str, kp_id: str, *, refresh_answer_snapshots: bool = False,
    ) -> StudentMastery | None:
        from app.services.teacher_learning_evidence import app_homework_attempt_ids, released_teacher_evidence

        mastery = await self._get_or_create_mastery(student_id, kp_id)
        qids_result = await self.db.execute(
            select(QuestionLabel.question_id).where(
                QuestionLabel.label_type == "knowledge_point",
                QuestionLabel.label_id == kp_id,
            )
        )
        question_ids = list(qids_result.scalars().all())

        answers_result = await self.db.execute(
            select(StudentAnswer, Question)
            .join(Question, Question.id == StudentAnswer.question_id)
            .where(
                StudentAnswer.student_id == student_id,
                (StudentAnswer.teacher_paper_attempt_id.is_(None)
                 | StudentAnswer.teacher_paper_attempt_id.not_in(app_homework_attempt_ids())),
                StudentAnswer.question_id.in_(question_ids)
                | (StudentAnswer.grading_result["_evidence_knowledge_point_id"].astext == kp_id)
                | StudentAnswer.grading_result["_mastery_update"].has_key(kp_id),
            )
            .options(selectinload(Question.labels))
            .order_by(StudentAnswer.created_at.asc(), StudentAnswer.id.asc())
        )
        candidate_rows = list(answers_result.all())
        rows = []
        for answer, question in candidate_rows:
            grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
            # Preserve evidence already applied by the live pipeline, including
            # low-weight self-review and process credit. The advisory review flag
            # alone must not erase these records during replay. Pending AI never counts.
            applied = grading.get("_mastery_update")
            counted_live = isinstance(applied, dict) and kp_id in applied
            if is_pending_confirmation(grading) or (grading.get('needs_human_review') and not counted_live):
                continue
            if self.evidence_knowledge_point_id(answer, question) == kp_id:
                rows.append((answer, question))
        events = [(answer_observed_at(answer), 0, answer.id, answer, question, None)
                  for answer, question in rows]
        for evidence in await released_teacher_evidence(self.db, [student_id]):
            if evidence.kp_id == kp_id:
                events.append((evidence.observed_at, 1, evidence.item.id, None, None, evidence))
        events.sort(key=lambda event: event[:3])

        mastery.mastery = KnowledgeTracingEngine.initial_p_l()
        mastery.attempts = 0
        mastery.correct_rate = 0.0
        mastery.confidence = KnowledgeTracingEngine.entropy(mastery.mastery)
        mastery.last_practiced = None
        misconceptions = {}
        previous_misconceptions = mastery.main_misconceptions or {}
        if refresh_answer_snapshots:
            from app.services.knowledge_service import canonical_kp_name
            kp_name = canonical_kp_name(kp_id, kp_id)
        for observed_at, _, _, answer, question, teacher in events:
            before = mastery.mastery
            values = mastery_values_after_evidence(
                prior=mastery.mastery, attempts=mastery.attempts, correct_rate=mastery.correct_rate,
                last_practiced=mastery.last_practiced, observed_at=observed_at,
                evidence=(teacher.mastery_evidence if teacher else
                          answer_mastery_evidence(question, answer.is_correct, answer.given_answer, answer.grading_result)),
                question=question, forgetting_enabled=settings.mastery_forgetting_enabled,
            )
            for name, value in values.items():
                setattr(mastery, name, value)
            if refresh_answer_snapshots and answer is not None:
                answer.grading_result = {
                    **(answer.grading_result or {}),
                    "_evidence_knowledge_point_id": kp_id,
                    "_mastery_update": {kp_id: {"before": before, "after": mastery.mastery, "name": kp_name}},
                }
            correct = teacher.credit >= 1 if teacher else answer.is_correct
            errors = ([teacher.item.error_type] if teacher and teacher.item.error_type not in {None, "none", "unknown"}
                      else [] if teacher else answer.misconception_ids or [])
            if not correct:
                for misconception_id in errors:
                    entry = misconceptions.setdefault(misconception_id, {
                        "name": previous_misconceptions.get(misconception_id, {}).get("name", misconception_id),
                        "count": 0,
                    })
                    entry["count"] += 1
        mastery.main_misconceptions = misconceptions
        await self.db.flush()
        return mastery

    async def get_wrong_answers(
        self,
        student_id: str,
        limit: int = 20,
    ) -> list[StudentAnswer]:
        result = await self.db.execute(
            select(StudentAnswer)
            .where(
                StudentAnswer.student_id == student_id,
                StudentAnswer.is_correct == False,
                StudentAnswer.reviewed_at.is_(None),
            )
            .order_by(StudentAnswer.created_at.desc(), StudentAnswer.id.desc())
            .limit(max(limit * 4, limit))
        )
        rows = list(result.scalars().all())
        seen_question_ids: set[str] = set()
        deduped: list[StudentAnswer] = []
        for answer in rows:
            if answer.question_id in seen_question_ids:
                continue
            seen_question_ids.add(answer.question_id)
            deduped.append(answer)
            if len(deduped) >= limit:
                break
        return deduped

    async def mark_mistake_reviewed(self, student_id: str, answer_id: int) -> bool:
        result = await self.db.execute(
            select(StudentAnswer).where(
                StudentAnswer.id == answer_id,
                StudentAnswer.student_id == student_id,
                StudentAnswer.is_correct == False,
            )
        )
        answer = result.scalar_one_or_none()
        if not answer:
            return False
        reviewed_at = datetime.now(timezone.utc)
        await self.db.execute(
            update(StudentAnswer)
            .where(
                StudentAnswer.student_id == student_id,
                StudentAnswer.question_id == answer.question_id,
                StudentAnswer.is_correct == False,
                StudentAnswer.reviewed_at.is_(None),
            )
            .values(reviewed_at=reviewed_at)
        )
        await self.db.commit()
        return True

    async def get_mistake_clearance_counts(self, student_id: str) -> dict[str, int]:
        total = await self.db.scalar(
            select(func.count(func.distinct(StudentAnswer.question_id))).where(
                StudentAnswer.student_id == student_id,
                StudentAnswer.is_correct == False,
            )
        )
        pending = await self.db.scalar(
            select(func.count(func.distinct(StudentAnswer.question_id))).where(
                StudentAnswer.student_id == student_id,
                StudentAnswer.is_correct == False,
                StudentAnswer.reviewed_at.is_(None),
            )
        )
        total_count = total or 0
        pending_count = pending or 0
        return {"reviewed": max(0, total_count - pending_count), "total": total_count}

    async def add_misconception(
        self, student_id: str, kp_id: str, misconception: dict, commit: bool = True
    ):
        """Record a detected misconception in StudentMastery.main_misconceptions."""
        mastery = await self.get_mastery(student_id, kp_id)
        if not mastery:
            return
        current = mastery.main_misconceptions or {}
        mc_id = misconception["id"]
        entry = current.get(mc_id, {"name": misconception["name"], "count": 0})
        entry["count"] += 1
        current[mc_id] = entry
        mastery.main_misconceptions = current
        if commit:
            await self.db.commit()
        else:
            await self.db.flush()

    async def update_item_stats(
        self,
        question_id: str,
        is_correct: bool,
        time_spent_ms: int = 0,
        commit: bool = True,
    ):
        credit = float(is_correct)
        previous_count = func.coalesce(ItemStats.total_attempts, 0)
        next_count = previous_count + 1
        next_rate = (func.coalesce(ItemStats.correct_rate, 0.0) * previous_count + credit) / next_count
        next_time = case(
            (ItemStats.avg_time_ms.is_(None), float(time_spent_ms)),
            else_=(ItemStats.avg_time_ms * previous_count + time_spent_ms) / next_count,
        )
        await self.db.execute(
            pg_insert(ItemStats).values(
                question_id=question_id, total_attempts=1, correct_rate=credit,
                avg_time_ms=float(time_spent_ms), difficulty_estimate=1.0 - credit,
            ).on_conflict_do_update(index_elements=[ItemStats.question_id], set_={
                "total_attempts": next_count, "correct_rate": next_rate,
                "avg_time_ms": next_time, "difficulty_estimate": 1.0 - next_rate,
                "updated_at": func.now(),
            })
        )
        if commit:
            await self.db.commit()
        else:
            await self.db.flush()
