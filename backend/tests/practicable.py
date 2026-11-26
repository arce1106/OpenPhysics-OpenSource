"""Test helper: make KPs practicable (students only see KPs with an approved primary question)."""

from app.models.question import QualityStatus, Question, QuestionLabel


async def seed_practicable(db, *kp_ids: str) -> None:
    for kp_id in kp_ids:
        db.add(Question(
            id=f"q-practicable-{kp_id}",
            stem_text=f"{kp_id} practicable question",
            quality_status=QualityStatus.approved,
            labels=[QuestionLabel(label_type="knowledge_point", label_id=kp_id, role="主要")],
        ))
    await db.commit()
