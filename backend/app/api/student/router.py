from fastapi import APIRouter, Depends
from .privacy_consent import router as privacy_router, enforce_ios_ai_consent

from . import account_deletion, answer_grading, auth, classes, diagnose, diagnostic_attempts, directory, growth, history, improvement, journey, learn, learning_catalogs, learning_trace, mastery_judgment, practice, teacher_homework, tutor

router = APIRouter(prefix="/api/student", tags=["student"], dependencies=[Depends(enforce_ios_ai_consent)])

for subrouter in (
    auth.router,
    classes.router,
    privacy_router,
    account_deletion.router,
    practice.router,
    answer_grading.router,
    history.router,
    growth.router,
    journey.router,
    tutor.router,
    learn.router,
    learning_catalogs.router,
    teacher_homework.router,
    directory.router,
    diagnose.router,
    diagnostic_attempts.router,
    improvement.router,
    learning_trace.router,
    mastery_judgment.router,
):
    router.include_router(subrouter)
