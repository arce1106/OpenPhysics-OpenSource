"""Read-only class statistics.

Practice facts and released homework scores are counted separately, and then read together as one
performance figure per student and knowledge point. Homework is read the way the paper was marked:
its rate is total points earned / total points available, so a 12-point question weighs four times a
3-point one and a 100-point exam more than a 10-point quiz. Practice has no points: each answer is
one question at its partial credit. The two meet per question — homework contributes its points rate
times its number of questions — so neither source can outweigh the other by sheer size of numbers.

Each figure carries how many questions it rests on; below ``MIN_EVIDENCE`` it is "数据不足", never a
percentage, so a single lucky answer does not read like a solid result.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean

from sqlalchemy import Float, and_, case, func, or_, select
from sqlalchemy.orm import selectinload

from app.models.knowledge import KnowledgePoint
from app.models.question import Question
from app.models.student import StudentAnswer, StudentMastery
from app.models.teacher import TeacherAssignment, TeacherClassMember
from app.models.teacher_paper import TeacherPaperAttempt
from app.models.teacher_scan import TeacherSubmission, TeacherSubmissionItem
from app.services.physics_error_types import error_type_name
from app.services.knowledge_service import canonical_kp_name

HOMEWORK_CATALOG = "teacher_homework"
MIN_EVIDENCE = 3          # questions needed before a level is shown
MASTERED = 0.85           # average score at or above: 已掌握
DEVELOPING = 0.6          # at or above: 待巩固; below: 薄弱
RECENT_DAYS = 7
LOW_OVERALL_EVIDENCE = 5  # an overall rate below DEVELOPING is flagged only on this much work


def level(score, evidence):
    if not evidence or evidence < MIN_EVIDENCE or score is None:
        return 'insufficient'
    return 'mastered' if score >= MASTERED else 'developing' if score >= DEVELOPING else 'weak'


def _credit_sum():
    """Per graded answer: 1 when correct, otherwise its process score (0–100) as partial credit."""
    process = StudentAnswer.grading_result['process_score']
    partial = case((func.jsonb_typeof(process) == 'number',
                    func.least(func.greatest(process.astext.cast(Float) / 100, 0.0), 1.0)), else_=0.0)
    return func.sum(case((and_(_graded(), StudentAnswer.is_correct.is_(True)), 1.0),
                         (_graded(), partial), else_=0.0))


def _graded():
    return and_(
        func.coalesce(StudentAnswer.grading_result['_pending_confirmation'].astext, 'false') != 'true',
        func.coalesce(StudentAnswer.grading_result['needs_human_review'].astext, 'false') != 'true',
        StudentAnswer.is_correct.is_not(None),
    )


def _practice_query():
    # App homework also writes StudentAnswer. It belongs to homework, once, not practice again.
    return or_(StudentAnswer.teacher_paper_attempt_id.is_(None),
               TeacherPaperAttempt.catalog_code != HOMEWORK_CATALOG)


def _since_joining(class_id):
    """Practice the class teacher may see: from the day the student joined this class. Joining
    shares learning from then on (the notice says so); earlier practice stays the student's own."""
    return and_(TeacherClassMember.class_id == class_id, TeacherClassMember.student_id == StudentAnswer.student_id,
                StudentAnswer.created_at >= TeacherClassMember.added_at)


def _evidence(student_id):
    return dict(student_id=student_id, practice_count=0, practice_graded=0, practice_correct=0,
                practice_credit=0.0, homework_earned=0.0, homework_full=0.0, homework_items=0,
                mastery=None, mastery_attempts=0, mastery_updated_at=None)


def _homework_share(items, earned, full):
    """Homework's weight in a performance figure: its questions, at its points-weighted rate."""
    return items * min(earned / full, 1.0) if full else 0.0


def _settle(value):
    """Performance of one evidence cell: practice credit plus homework at its points rate, per question."""
    evidence = value['practice_graded'] + value['homework_items']
    credit = value['practice_credit'] + _homework_share(value['homework_items'], value['homework_earned'], value['homework_full'])
    score = round(credit / evidence, 4) if evidence else None
    value.update(evidence=evidence, score=score, level=level(score, evidence), credit=credit)
    return value


def _practice_credit(grading):
    """A practice answer's partial credit, from its process score (0–100), when it has one."""
    score = grading.get('process_score') if isinstance(grading, dict) else None
    if isinstance(score, (int, float)):
        return max(0.0, min(1.0, float(score) / 100))
    return 0.0


def _recent(value, since):
    if value is None:
        return False
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)) >= since


def _rate(earned, full):
    return round(earned / full, 4) if full else None


class TeacherStatisticsService:
    def __init__(self, db):
        from app.services.teacher_service import TeacherService
        self.db = db
        self.teachers = TeacherService(db)

    async def build(self, class_id, members):
        from app.services.teacher_assignment_service import _primary_kp_label

        ids = {student.id for student in members}
        numbers = await self.teachers.member_numbers(class_id)
        from app.services.teacher_service import mask_phone
        rows = {s.id: dict(student_id=s.id, display_name=mask_phone(s.display_name), student_number=numbers.get(s.id),
                          practice_count=0, practice_graded=0, practice_correct_rate=None,
                          homework_expected=0, homework_submitted=0, homework_scored=0, homework_rate=None,
                          latest_activity_at=None, mastery=None, knowledge_count=0,
                          recent_practice_count=0, homework_missed=0, evidence=0, score=None, level='insufficient',
                          weak_points=[], strong_points=[], attention=[]) for s in members}
        credit_by_student = defaultdict(float)
        homework_by_student = defaultdict(lambda: [0, 0.0, 0.0])  # released items, points earned, points available
        since = datetime.now(timezone.utc) - timedelta(days=RECENT_DAYS)
        points = {p.id: p for p in (await self.db.scalars(select(KnowledgePoint))).all()}
        evidence = defaultdict(dict)
        homework_points = defaultdict(lambda: [0.0, 0.0])  # per student over released papers: earned, available
        mastery_values = defaultdict(list)

        def cell(kp_id, student_id):
            return evidence[kp_id].setdefault(student_id, _evidence(student_id))

        def latest(student_id, value):
            if value is not None:
                current = rows[student_id]['latest_activity_at']
                if current is None or value > current:
                    rows[student_id]['latest_activity_at'] = value

        recorded_target = StudentAnswer.grading_result['_evidence_knowledge_point_id'].astext
        mastery_scope = StudentAnswer.grading_result['_mastery_scope'].astext
        practice = (await self.db.execute(select(
            StudentAnswer.student_id, StudentAnswer.question_id, func.count(),
            func.sum(case((_graded(), 1), else_=0)),
            func.sum(case((and_(_graded(), StudentAnswer.is_correct.is_(True)), 1), else_=0)),
            func.max(StudentAnswer.created_at),
            _credit_sum(),
            func.sum(case((StudentAnswer.created_at >= since, 1), else_=0)),
            recorded_target,
            mastery_scope,
        ).outerjoin(TeacherPaperAttempt, TeacherPaperAttempt.id == StudentAnswer.teacher_paper_attempt_id)
            .join(TeacherClassMember, _since_joining(class_id))
            .where(StudentAnswer.student_id.in_(ids), _practice_query())
            .group_by(StudentAnswer.student_id, StudentAnswer.question_id, recorded_target, mastery_scope))).all() if ids else []
        questions = (await self.db.scalars(select(Question).where(Question.id.in_({r[1] for r in practice}))
                                          .options(selectinload(Question.labels)))).all() if practice else []
        question_kps = {q.id: label.label_id for q in questions if (label := _primary_kp_label(q))}
        correct_by_student = defaultdict(int)
        for sid, qid, count, graded, correct, date, credit, recent, recorded_kp, scope in practice:
            row = rows[sid]
            row['practice_count'] += count
            row['practice_graded'] += graded
            row['recent_practice_count'] += recent
            correct_by_student[sid] += correct
            credit_by_student[sid] += float(credit or 0)
            latest(sid, date)
            kp_id = None if scope == 'topic_only' else recorded_kp or question_kps.get(qid)
            if kp_id:
                item = cell(kp_id, sid)
                item['practice_count'] += count
                item['practice_graded'] += graded
                item['practice_correct'] += correct
                item['practice_credit'] += float(credit or 0)

        assignments = list((await self.db.scalars(select(TeacherAssignment).where(
            TeacherAssignment.class_id == class_id, TeacherAssignment.status == 'published',
            or_(TeacherAssignment.removed_at.is_(None), TeacherAssignment.results_released_at.is_not(None)),
        ))).all())
        assignment_map = {a.id: a for a in assignments}
        expected = {}
        for a in assignments:
            selected = a.roster if a.roster is not None else (a.settings or {}).get('student_ids')
            expected[a.id] = ids & set(selected) if selected is not None else ids
            for sid in expected[a.id]:
                rows[sid]['homework_expected'] += 1
        submissions = list((await self.db.scalars(select(TeacherSubmission).where(
            TeacherSubmission.assignment_id.in_(assignment_map), TeacherSubmission.student_id.in_(ids),
        ))).all()) if assignments and ids else []
        official = {s.id: s for s in submissions if s.student_id in expected[s.assignment_id]
                    and assignment_map[s.assignment_id].results_released_at and s.total_score is not None}
        items = list((await self.db.scalars(select(TeacherSubmissionItem).where(
            TeacherSubmissionItem.submission_id.in_(official),
        ))).all()) if official else []
        item_totals = defaultdict(float)
        for item in items:
            submission = official[item.submission_id]
            assignment = assignment_map[submission.assignment_id]
            item_totals[submission.id] += item.max_score or 0
            if item.score is not None and item.max_score:
                counted = homework_by_student[submission.student_id]
                counted[0] += 1
                counted[1] += item.score
                counted[2] += item.max_score
            # Frozen snapshots own the knowledge-point identity of a released assignment.
            snapshots = assignment.question_snapshot or []
            if assignment.kind == 'personalized':
                # Personalized snapshots live on each student's paper, loaded below in one query.
                continue
            q = next((q for q in snapshots if q['id'] == item.question_id), {})
            kp_id = (q.get('primary_kp') or {}).get('id')
            if kp_id and item.score is not None and item.max_score:
                value = cell(kp_id, submission.student_id)
                value['homework_earned'] += item.score
                value['homework_full'] += item.max_score
                value['homework_items'] += 1
        if any(a.kind == 'personalized' for a in assignments):
            from app.models.teacher import TeacherStudentPaper
            papers = (await self.db.scalars(select(TeacherStudentPaper).where(
                TeacherStudentPaper.assignment_id.in_(assignment_map), TeacherStudentPaper.student_id.in_(ids),
            ))).all()
            snapshots = {(p.assignment_id, p.student_id): {q['id']: q for q in p.question_snapshot or []} for p in papers}
            for item in items:
                s = official[item.submission_id]
                if assignment_map[s.assignment_id].kind != 'personalized':
                    continue
                q = snapshots.get((s.assignment_id, s.student_id), {}).get(item.question_id, {})
                kp_id = (q.get('primary_kp') or {}).get('id')
                if kp_id and item.score is not None and item.max_score:
                    value = cell(kp_id, s.student_id)
                    value['homework_earned'] += item.score
                    value['homework_full'] += item.max_score
                    value['homework_items'] += 1
        handed_in = set()
        for submission in submissions:
            sid = submission.student_id
            if sid not in expected[submission.assignment_id]:
                continue
            handed_in.add((submission.assignment_id, sid))
            latest(sid, submission.created_at)
            if submission.id in official:
                rows[sid]['homework_scored'] += 1
                full = item_totals[submission.id]
                if not full:
                    full = sum(float(i['points']) for i in assignment_map[submission.assignment_id].items)
                if full:
                    homework_points[sid][0] += submission.total_score
                    homework_points[sid][1] += full
        # Count completed App papers even if the teacher has not opened collection to import them.
        app_done = (await self.db.scalars(select(TeacherPaperAttempt).where(
            TeacherPaperAttempt.catalog_code == HOMEWORK_CATALOG, TeacherPaperAttempt.node_id.in_(assignment_map),
            TeacherPaperAttempt.student_id.in_(ids), TeacherPaperAttempt.status == 'completed',
            # Released paper results mirrored into the student's records are not App work.
            TeacherPaperAttempt.paper_id.not_like('homework-paper:%'),
        ))).all() if assignments and ids else []
        for a in app_done:
            if a.student_id in expected[a.node_id]:
                handed_in.add((a.node_id, a.student_id))
                latest(a.student_id, a.completed_at)
        for _, sid in handed_in:
            rows[sid]['homework_submitted'] += 1
        for a in assignments:
            if a.results_released_at:
                for sid in expected[a.id]:
                    if (a.id, sid) not in handed_in:
                        rows[sid]['homework_missed'] += 1
        masteries = (await self.db.scalars(select(StudentMastery).where(
            StudentMastery.student_id.in_(ids), StudentMastery.attempts > 0,
        ))).all() if ids else []
        for m in masteries:
            value = cell(m.knowledge_point_id, m.student_id)
            value.update(mastery=m.mastery, mastery_attempts=m.attempts, mastery_updated_at=m.last_practiced)
            mastery_values[m.student_id].append(m.mastery)
            latest(m.student_id, m.last_practiced)
        names = {kp_id: canonical_kp_name(kp_id, points[kp_id].name if kp_id in points else None) for kp_id in evidence}
        for students in evidence.values():
            for value in students.values():
                _settle(value)
        now = datetime.now(timezone.utc)
        for sid, row in rows.items():
            row['practice_correct_rate'] = _rate(correct_by_student[sid], row['practice_graded'])
            # Over all released papers by points, as marked: a 100-point exam outweighs a 10-point quiz.
            earned, available = homework_points[sid]
            row['homework_rate'] = round(min(earned / available, 1.0), 4) if available else None
            row['mastery'] = round(mean(mastery_values[sid]), 4) if mastery_values[sid] else None
            row['knowledge_count'] = sum(sid in students for students in evidence.values())
            items, earned, available = homework_by_student[sid]
            row['evidence'] = row['practice_graded'] + items
            credit = credit_by_student[sid] + _homework_share(items, earned, available)
            row['score'] = round(credit / row['evidence'], 4) if row['evidence'] else None
            row['level'] = level(row['score'], row['evidence'])
            mine = [(kp_id, students[sid]) for kp_id, students in evidence.items() if sid in students]
            weak = sorted((v['score'], kp_id) for kp_id, v in mine if v['level'] == 'weak')
            strong = sorted(((-v['score'], kp_id) for kp_id, v in mine if v['level'] == 'mastered'))
            row['weak_points'] = [dict(kp_id=kp_id, kp_name=names[kp_id], score=score) for score, kp_id in weak[:3]]
            row['strong_points'] = [dict(kp_id=kp_id, kp_name=names[kp_id], score=-score) for score, kp_id in strong[:3]]
            row['attention'] = self._attention(row, now)
        knowledge = []
        for kp_id, students in evidence.items():
            kp = points.get(kp_id)
            values = list(students.values())
            total = sum(v['evidence'] for v in values)
            score = round(sum(v['credit'] for v in values) / total, 4) if total else None
            knowledge.append(dict(
                kp_id=kp_id, kp_name=names[kp_id], chapter=kp.chapter if kp else None,
                section=kp.section if kp else None, student_count=len(values),
                practice_count=sum(v['practice_count'] for v in values),
                practice_correct_rate=_rate(sum(v['practice_correct'] for v in values), sum(v['practice_graded'] for v in values)),
                homework_rate=_rate(sum(v['homework_earned'] for v in values), sum(v['homework_full'] for v in values)),
                evidence=total, score=score, level=level(score, total),
                weak_students=sum(v['level'] == 'weak' for v in values),
                developing_students=sum(v['level'] == 'developing' for v in values),
                students=values,
            ))
        return dict(students=list(rows.values()), knowledge_points=knowledge,
                    summary=dict(data_students=sum(bool(r['practice_count'] or r['homework_submitted'] or r['mastery'] is not None) for r in rows.values()),
                                 practice_count=sum(r['practice_count'] for r in rows.values()),
                                 released_assignments=sum(bool(a.results_released_at) for a in assignments),
                                 # Practised, or handed in homework, within the window.
                                 active_students=sum(bool(r['recent_practice_count']) or _recent(r['latest_activity_at'], since)
                                                     for r in rows.values()),
                                 recent_practice_count=sum(r['recent_practice_count'] for r in rows.values()),
                                 recent_days=RECENT_DAYS),
                    thresholds=dict(min_evidence=MIN_EVIDENCE, mastered=MASTERED, developing=DEVELOPING))

    @staticmethod
    def _attention(row, now):
        """Why a teacher might look at this student now, most pressing first. Empty when nothing stands out."""
        reasons = []
        latest = row['latest_activity_at']
        if latest is None:
            reasons.append(dict(code='inactive', text='入班后还没有学习记录'))
        else:
            latest = latest if latest.tzinfo else latest.replace(tzinfo=timezone.utc)
            idle = (now - latest).days
            if idle >= RECENT_DAYS:
                reasons.append(dict(code='inactive', text=f'已 {idle} 天没有学习'))
        if row['homework_missed']:
            reasons.append(dict(code='missed', text=f"缺交 {row['homework_missed']} 份已发布作业"))
        if row['evidence'] >= LOW_OVERALL_EVIDENCE and row['score'] is not None and row['score'] < DEVELOPING:
            reasons.append(dict(code='low', text=f"整体得分率 {round(row['score'] * 100)}%"))
        if row['weak_points']:
            reasons.append(dict(code='weak', text='薄弱：' + '、'.join(p['kp_name'] for p in row['weak_points'][:2])))
        return reasons

    async def records(self, teacher_id, class_id, student_id=None, kp_id=None, wrong_only=False, source='practice',
                      offset=0, page=20):
        from app.services.teacher_assignment_service import TeacherAssignmentService, _primary_kp_label
        from app.services.teacher_homework_service import _relative_upload
        from app.services.teacher_scan_service import sign_image
        from app.services.teacher_service import TeacherServiceError

        await self.teachers.get_owned_class(teacher_id, class_id)
        members = {s.id: s for s in await self.teachers.list_members(class_id)}
        if student_id and student_id not in members:
            raise TeacherServiceError(404, '该学生不在这个班级')
        from app.services.teacher_service import mask_phone
        names = {sid: mask_phone(s.display_name) for sid, s in members.items()}
        query = (select(StudentAnswer)
                 .outerjoin(TeacherPaperAttempt, TeacherPaperAttempt.id == StudentAnswer.teacher_paper_attempt_id)
                 .join(TeacherClassMember, _since_joining(class_id)))
        query = query.where(StudentAnswer.student_id.in_([student_id] if student_id else members), _practice_query())
        if kp_id:
            from app.models.question import QuestionLabel
            # Use the same primary knowledge point as the aggregate table, not secondary labels.
            candidates = (await self.db.scalars(select(Question).where(Question.id.in_(
                select(QuestionLabel.question_id).where(QuestionLabel.label_type == 'knowledge_point',
                                                       QuestionLabel.label_id == kp_id)
            )).options(selectinload(Question.labels)))).all()
            primary_ids = [q.id for q in candidates if (label := _primary_kp_label(q)) and label.label_id == kp_id]
            recorded = StudentAnswer.grading_result['_evidence_knowledge_point_id'].astext
            query = query.where(func.coalesce(StudentAnswer.grading_result['_mastery_scope'].astext, '') != 'topic_only',
                                or_(recorded == kp_id, and_(recorded.is_(None), StudentAnswer.question_id.in_(primary_ids))))
        if wrong_only:
            query = query.where(StudentAnswer.is_correct.is_(False), _graded())
        # Practice and released homework are merged by time, so a page needs up to offset+page+1 of each.
        window = offset + page + 1
        answers = (await self.db.scalars(query.order_by(StudentAnswer.created_at.desc(), StudentAnswer.id.desc()).limit(window))).all() if source != 'homework' else []
        question_ids = {a.question_id for a in answers}
        questions = (await self.db.scalars(select(Question).where(Question.id.in_(question_ids)).options(
            selectinload(Question.labels), selectinload(Question.options), selectinload(Question.images),
        ))).all() if question_ids else []
        kps = {p.id: p for p in (await self.db.scalars(select(KnowledgePoint))).all()}
        payload = {q.id: TeacherAssignmentService(self.db)._question_payload(q, kps, {}) for q in questions}
        results = []
        for a in answers:
            grade = a.grading_result if isinstance(a.grading_result, dict) else {}
            pending = bool(grade.get('_pending_confirmation') or grade.get('needs_human_review'))
            crop = _relative_upload(grade.get('answer_image_path'))
            question = payload.get(a.question_id)
            recorded = grade.get('_evidence_knowledge_point_id')
            if question and recorded in kps:
                kp = kps[recorded]
                question = {**question, 'primary_kp': {'id': recorded, 'name': canonical_kp_name(recorded, kp.name), 'chapter': kp.chapter}}
            credit = None if pending else (1.0 if a.is_correct else _practice_credit(grade))
            results.append(dict(id=a.id, source='practice', student_id=a.student_id, display_name=names[a.student_id],
                                created_at=a.created_at, question=question, given_answer=a.given_answer,
                                is_correct=None if pending else a.is_correct, credit=credit, image_url=sign_image(crop, teacher_id) if crop else None,
                                feedback=None if pending else grade.get('feedback'),
                                error_type_name=error_type_name(grade['error_type']) if not pending and grade.get('error_type') not in {None, 'none', 'unknown'} else None))
        if source != 'practice':
            from app.services.teacher_learning_evidence import released_teacher_evidence
            teacher_rows = await released_teacher_evidence(self.db, [student_id] if student_id else list(members),
                                                           teacher_id=teacher_id, class_id=class_id)
            for teacher in teacher_rows:
                if (kp_id and teacher.kp_id != kp_id) or (wrong_only and teacher.credit >= 1):
                    continue
                item, submission, assignment = teacher.item, teacher.submission, teacher.assignment
                question = dict(teacher.question)
                question.update(default_points=item.max_score, default_box=question.get('default_box'),
                                class_attempted=0, class_correct_rate=None)
                results.append(dict(id=f'teacher:{item.id}', student_id=submission.student_id,
                                    display_name=names[submission.student_id], credit=round(teacher.credit, 4),
                                    created_at=teacher.observed_at, question=question, given_answer=item.answer,
                                    source='teacher_app' if submission.source == 'app' else 'teacher_paper',
                                    assignment_id=assignment.id, assignment_title=assignment.title,
                                    score=item.score, max_score=item.max_score, is_correct=teacher.credit >= 1,
                                    image_url=sign_image(item.crop_path, teacher_id) if item.crop_path else None,
                                    feedback=item.teacher_comment or item.feedback, first_error=item.first_error,
                                    error_type_name=error_type_name(item.error_type) if teacher.credit < 1 and item.error_type not in {None, 'none', 'unknown'} else None))
        from app.services.teacher_learning_evidence import utc
        results.sort(key=lambda item: (utc(item['created_at']), str(item['id'])), reverse=True)
        return dict(items=results[offset:offset + page], has_more=len(results) > offset + page, offset=offset)
