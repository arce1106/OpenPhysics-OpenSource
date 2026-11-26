from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.student.dependencies import get_current_student_id, get_student_service
from app.models.question import Question
from app.services.privacy_consent_service import PrivacyConsentService
from app.services.student_service import StudentService

router = APIRouter(prefix="/auth/privacy-consent", tags=["privacy-consent"])


class ConsentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: Literal["ios_terms", "ios_ai"]
    version: str = Field(min_length=1, max_length=80)
    granted: bool = Field(strict=True)
    preserve_withdrawal: bool = Field(default=False, strict=True)


@router.get("")
async def state(response: Response, student_id: str = Depends(get_current_student_id),
                students: StudentService = Depends(get_student_service)):
    response.headers["Cache-Control"] = "no-store"
    return await PrivacyConsentService(students.db).state(student_id)


@router.post("")
async def record(body: ConsentRequest, response: Response,
                 student_id: str = Depends(get_current_student_id),
                 students: StudentService = Depends(get_student_service)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await PrivacyConsentService(students.db).record(student_id, body.scope, body.version, body.granted,
                                                               preserve_withdrawal=body.preserve_withdrawal)
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    except PermissionError as error:
        raise HTTPException(401, str(error)) from None


def ai_route(path: str, method: str) -> bool:
    return method == "POST" and (path in {
        "practice/submit", "practice/submit-photo", "practice/process-evidence",
        "practice/submit-paper-batch", "practice/extract-photo", "learn/chat",
    } or path.startswith("tutor/"))


async def enforce_ios_ai_consent(request: Request,
                                 students: StudentService = Depends(get_student_service)):
    # Additive contract: older Web/Android clients keep their existing behavior.
    # Only a stored receipt grants access; the client header never grants permission.
    if request.headers.get("X-OpenPhysics-Privacy-Client") != "ios":
        return
    path = request.url.path.removeprefix("/api/student/").rstrip("/")
    if not ai_route(path, request.method):
        return
    student_id = await get_current_student_id(request.headers.get("Authorization"), students)
    if path == "practice/submit":
        body = await request.json()
        question_id = body.get("question_id") if isinstance(body, dict) else None
        question = await students.db.get(Question, question_id) if isinstance(question_id, str) else None
        # Objective grading never sends the student's answer to an AI provider.
        if question is not None and question.question_type not in {
            "fill_in_blank", "knowledge_fill_in_blank", "experiment", "problem_solving", "comprehensive"
        }:
            return
    permissions = await PrivacyConsentService(students.db).state(student_id)
    if not permissions["ios_terms"] or not permissions["ios_ai"]:
        raise HTTPException(403, "请先阅读并确认第三方 AI 处理说明；拒绝不影响查看学习资料和已有记录。",
                            headers={"X-OpenPhysics-AI-Consent-Required": "true"})
