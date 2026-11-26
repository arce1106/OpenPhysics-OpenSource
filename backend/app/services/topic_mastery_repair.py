"""Preview, then separate known historical Gaokao evidence after a database backup."""
import argparse
import asyncio
import json
from collections import defaultdict

from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.models.learning_catalog import LearningCatalog, LearningCatalogNode, LearningCatalogNodeEvidence, LearningCatalogNodeKnowledgePoint
from app.models.question import Question
from app.models.student import StudentAnswer
from app.models.teacher_paper import TeacherPaperAttempt
from app.services.mastery_scope import includes_basic_mastery, topic_answer_score, topic_updates_basic
from app.services.student_service import StudentService


async def repair_topic_mastery(db, *, apply=False):
    if apply:
        await db.execute(text("SET LOCAL lock_timeout = '10s'"))
        await db.execute(text("SET LOCAL statement_timeout = '90s'"))
        await db.execute(text("LOCK TABLE student_answers, student_mastery, learning_catalog_node_evidence IN SHARE ROW EXCLUSIVE MODE"))
    sources = defaultdict(set)
    evidence_rows = list((await db.scalars(select(LearningCatalogNodeEvidence)
        .join(LearningCatalogNode, LearningCatalogNode.id == LearningCatalogNodeEvidence.node_id)
        .join(LearningCatalog, LearningCatalog.id == LearningCatalogNode.catalog_id)
        .where(LearningCatalog.code == "gaokao_review"))).all())
    for row in evidence_rows:
        sources[row.answer_id].add(("gaokao_review", row.node_id, row.layer))
    paper_rows = (await db.execute(select(StudentAnswer.id, TeacherPaperAttempt.node_id)
        .join(TeacherPaperAttempt, TeacherPaperAttempt.id == StudentAnswer.teacher_paper_attempt_id)
        .where(TeacherPaperAttempt.catalog_code == "gaokao_review"))).all()
    for answer_id, node_id in paper_rows:
        sources[answer_id].add(("gaokao_review", node_id, "paper"))
    if any(len(contexts) != 1 for contexts in sources.values()):
        raise ValueError("Historical repair requires review: conflicting topic contexts")
    records = (await db.execute(select(StudentAnswer, Question)
        .join(Question, Question.id == StudentAnswer.question_id)
        .where(StudentAnswer.id.in_(sources)).options(selectinload(Question.labels)))).all()
    mappings = defaultdict(set)
    for row in (await db.scalars(select(LearningCatalogNodeKnowledgePoint).where(
            LearningCatalogNodeKnowledgePoint.role == "core"))).all():
        mappings[row.node_id].add(row.knowledge_point_id)
    existing_evidence = {(row.answer_id, row.node_id) for row in evidence_rows}
    restored_evidence = []
    changes, pairs = [], set()
    for answer, question in records:
        catalog, node, layer = next(iter(sources[answer.id]))
        context = {"catalog_code": catalog, "node_id": node, "layer": layer}
        grading = dict(answer.grading_result or {})
        if (answer.id, node) not in existing_evidence:
            # Durable paper ownership is positive evidence of this source even
            # when the old client's follow-up registration never completed.
            kp = StudentService._evidence_kp_from_grading(grading)
            restored_evidence.append(LearningCatalogNodeEvidence(
                student_id=answer.student_id, node_id=node, answer_id=answer.id,
                question_id=answer.question_id, knowledge_point_id=kp if kp in mappings[node] else None,
                layer=layer, score=topic_answer_score(answer), created_at=answer.created_at,
            ))
        if grading.get("_topic_context") not in (None, context):
            raise ValueError("Historical repair aborted: conflicting stored topic context")
        if grading.get("_topic_context") == context and grading.get("_mastery_scope") in {"basic", "topic_only"}:
            continue
        basic = topic_updates_basic(context, question)
        scope = "basic" if basic else "topic_only"
        if grading.get("_mastery_scope") == scope and grading.get("_topic_context") == context:
            continue
        if basic and not includes_basic_mastery(grading):
            raise ValueError("Historical repair aborted: foundation evidence requires review")
        if not basic and includes_basic_mastery(grading):
            kps = set((grading.get("_mastery_update") or {}).keys())
            kp = StudentService._evidence_kp_from_grading(grading) or StudentService._primary_kp_from_loaded_question(question)
            if kp:
                kps.add(kp)
            pairs.update((answer.student_id, kp) for kp in kps)
            grading["_previous_basic_mastery_update"] = grading.get("_mastery_update")
        if not basic:
            grading["_mastery_update"] = {}
        grading.update({"_mastery_scope": scope, "_topic_context": context, "_topic_scope_repair": "2026-09-23"})
        changes.append((answer, grading))
    answers = {a.id: a for a, _ in records}
    score_changes = [(row, topic_answer_score(answers[row.answer_id])) for row in evidence_rows
                     if row.answer_id in answers and row.score != topic_answer_score(answers[row.answer_id])]
    summary = {"mode": "apply" if apply else "preview", "known_topic_answers": len(records),
               "answers_to_classify": len(changes), "mastery_pairs_to_rebuild": len(pairs),
               "students_affected": len({student for student, _ in pairs}), "topic_scores_to_refresh": len(score_changes),
               "topic_evidence_to_restore": len(restored_evidence)}
    if apply:
        for answer, grading in changes:
            answer.grading_result = grading
        for row, score in score_changes:
            row.score = score
        db.add_all(restored_evidence)
        await db.flush()
        for student_id, kp in sorted(pairs):
            await StudentService(db).rebuild_mastery_for_kp(student_id, kp, refresh_answer_snapshots=True)
    return summary


async def main(apply):
    from app.core.database import async_session, engine
    try:
        async with async_session() as db:
            try:
                if not apply:
                    await db.execute(text("SET TRANSACTION READ ONLY"))
                result = await repair_topic_mastery(db, apply=apply)
                if apply:
                    await db.commit()
                else:
                    await db.rollback()
                print(json.dumps(result, ensure_ascii=False))
            except Exception:
                await db.rollback()
                raise
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    asyncio.run(main(parser.parse_args().apply))
