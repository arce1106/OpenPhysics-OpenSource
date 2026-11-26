"""Self-service erasure with a fresh password proof."""
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.student.dependencies import get_current_student_id, get_student_service
from app.services.account_deletion_service import AccountDeletionService
from app.services.auth_request_limiter import (
    SensitiveActionLimiter, get_sensitive_action_limiter, request_ip,
)
from app.services.student_service import StudentService

router = APIRouter(prefix="/auth/account-deletion", tags=["account-deletion"])


class DeleteAccountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmed: bool
    current_password: str | None = Field(default=None, min_length=1, max_length=128)
    code: str | None = Field(default=None, exclude=True)


@router.post("")
async def delete_account(body: DeleteAccountRequest, request: Request, response: Response,
    student_id: str = Depends(get_current_student_id), authorization: str = Header(),
    students: StudentService = Depends(get_student_service),
    limiter: SensitiveActionLimiter = Depends(get_sensitive_action_limiter)):
    response.headers["Cache-Control"] = "no-store"
    if not body.confirmed or not body.current_password or body.code is not None:
        raise HTTPException(400, "请确认注销影响，并使用当前密码验证身份。")
    await limiter.reserve([("security-verify-ip", request_ip(request), 30, 600),
                           ("account-deletion", student_id, 5, 600)])
    try:
        erased = await AccountDeletionService(students).erase(
            student_id, authorization.split(" ", 1)[1].strip(),
            password=body.current_password, code=body.code)
    except OSError:
        raise HTTPException(503, "数据清理暂未完成，请稍后重试注销。") from None
    if not erased:
        raise HTTPException(400, "身份验证失败或已失效，请重新验证。")
    return {"deleted": True}
