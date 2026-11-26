"""Versioned, account-scoped permission receipts for the native iOS client."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.models.student import Student, StudentPrivacyConsent

PRIVACY_VERSION = "2026-10-11.2"
AI_VERSION = "ios-ai-2026-10-11.2"
VERSIONS = {"ios_terms": PRIVACY_VERSION, "ios_ai": AI_VERSION}


class PrivacyConsentService:
    def __init__(self, db):
        self.db = db

    async def state(self, student_id):
        receipts = (await self.db.execute(select(StudentPrivacyConsent)
            .where(StudentPrivacyConsent.student_id == student_id,
                   StudentPrivacyConsent.scope.in_(list(VERSIONS)))
            .distinct(StudentPrivacyConsent.scope)
            .order_by(StudentPrivacyConsent.scope, StudentPrivacyConsent.id.desc()))).scalars()
        latest = {}
        for receipt in receipts:
            latest.setdefault(receipt.scope, receipt)
            if len(latest) == len(VERSIONS):
                break
        return {"privacy_version": PRIVACY_VERSION, "ai_version": AI_VERSION,
                # Preserve an explicit withdrawal across login and policy updates.
                "ios_ai_withdrawn": "ios_ai" in latest and not latest["ios_ai"].granted,
                **{scope: bool(scope in latest and latest[scope].granted
                    and latest[scope].version == version) for scope, version in VERSIONS.items()}}

    async def declined_ai(self, student_ids):
        """Students whose latest iOS AI receipt is a refusal: the iOS app will not send their
        written answers for grading, so App-delivered homework cannot be finished there."""
        if not student_ids:
            return set()
        receipts = (await self.db.execute(select(StudentPrivacyConsent)
            .where(StudentPrivacyConsent.student_id.in_(list(student_ids)), StudentPrivacyConsent.scope == "ios_ai")
            .distinct(StudentPrivacyConsent.student_id)
            .order_by(StudentPrivacyConsent.student_id, StudentPrivacyConsent.id.desc()))).scalars()
        return {receipt.student_id for receipt in receipts if not receipt.granted}

    async def record(self, student_id, scope, version, granted, *, preserve_withdrawal=False):
        if scope not in VERSIONS or (granted and version != VERSIONS[scope]):
            raise ValueError("协议已更新，请重新阅读后确认。")
        # Serialize grant/revoke with each other and account erasure.
        student = (await self.db.execute(select(Student).where(Student.id == student_id)
            .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
        if student is None or student.status != "active":
            raise PermissionError("账号已失效，请重新登录。")
        last = (await self.db.execute(select(StudentPrivacyConsent).where(
            StudentPrivacyConsent.student_id == student_id, StudentPrivacyConsent.scope == scope)
            .order_by(StudentPrivacyConsent.id.desc()).limit(1))).scalar_one_or_none()
        # A combined login action must not reverse a withdrawal made on this or
        # another device, including between reading state and saving this receipt.
        preserves_existing_choice = preserve_withdrawal and scope == "ios_ai" and granted and last is not None and not last.granted
        if not preserves_existing_choice and (last is None or (last.version, last.granted) != (version, granted)):
            self.db.add(StudentPrivacyConsent(student_id=student_id, scope=scope,
                version=version, granted=granted, recorded_at=datetime.now(timezone.utc)))
        await self.db.commit()
        return await self.state(student_id)
