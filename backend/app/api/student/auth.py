from app.services.student_service import StudentService
from app.core.config import settings
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from app.services.login_attempt_limiter import LoginAttemptLimiter, get_login_limiter
from app.services.account_security_service import AccountSecurityService
from app.services.username_policy import USERNAME_RULE_HINT
from app.services.auth_request_limiter import (
    SensitiveActionLimiter, captcha_ip_budget, get_sensitive_action_limiter, request_ip,
)

from . import schemas
from .dependencies import get_current_student_id, get_student_service

router = APIRouter()


@router.post("/auth/login", response_model=schemas.StudentLoginResponse)
async def login_student(
    body: schemas.StudentLoginRequest,
    student_svc: StudentService = Depends(get_student_service),
    limiter: LoginAttemptLimiter = Depends(get_login_limiter),
):
    attempt_key = await limiter.check("student", body.username)
    if await limiter.captcha_required(attempt_key):
        if not await student_svc.verify_captcha(body.captcha_id, body.captcha_answer):
            raise HTTPException(403, "多次登录失败，请完成图形验证码后重试", headers={"X-Login-Captcha-Required": "true"})
    student = await student_svc.authenticate_student(body.username, body.password)
    if not student:
        required = await limiter.captcha_required(attempt_key, next_attempt=True)
        raise HTTPException(status_code=401, detail="用户名或密码错误", headers={"X-Login-Captcha-Required": str(required).lower()})
    await limiter.succeeded(attempt_key)
    return {
        "access_token": student_svc.create_access_token(student.id, auth_version=student.auth_version),
        "token_type": "bearer",
        "student": student_svc.serialize_student(student),
    }


@router.post("/auth/web-login-ticket", response_model=schemas.StudentWebLoginTicketResponse)
async def create_web_login_ticket(
    student_id: str = Depends(get_current_student_id),
    student_svc: StudentService = Depends(get_student_service),
    authorization: str | None = Header(default=None),
):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Student login required")
    result = await student_svc.create_web_login_ticket(
        student_id, source_access_token=authorization.split(" ", 1)[1].strip(),
    )
    if not result:
        raise HTTPException(status_code=401, detail="Student account unavailable")
    ticket, expires_at = result
    return {
        "ticket": ticket,
        "expires_at": expires_at.isoformat(),
        "expires_in_seconds": settings.student_web_login_ticket_minutes * 60,
    }


@router.post("/auth/web-login-ticket/exchange", response_model=schemas.StudentLoginResponse)
async def exchange_web_login_ticket(
    body: schemas.StudentWebLoginTicketExchangeRequest,
    student_svc: StudentService = Depends(get_student_service),
):
    student = await student_svc.consume_web_login_ticket(body.ticket)
    if not student:
        raise HTTPException(status_code=401, detail="Invalid or expired login ticket")
    return {
        "access_token": student_svc.create_access_token(student.id, auth_version=student.auth_version),
        "token_type": "bearer",
        "student": student_svc.serialize_student(student),
    }


@router.get("/auth/captcha", response_model=schemas.StudentCaptchaResponse)
async def get_captcha(
    request: Request,
    response: Response,
    student_svc: StudentService = Depends(get_student_service),
    limiter: SensitiveActionLimiter = Depends(get_sensitive_action_limiter),
):
    # Password-login challenges remain available when public registration is off.
    response.headers["Cache-Control"] = "no-store"
    await limiter.reserve([captcha_ip_budget(request_ip(request))])
    return await student_svc.request_captcha(
        return_debug_answer=False,
    )


@router.post("/auth/change-password")
async def change_student_password(
    body: schemas.StudentPasswordChangeRequest,
    student_svc: StudentService = Depends(get_student_service),
    limiter: LoginAttemptLimiter = Depends(get_login_limiter),
):
    if len(body.new_password.strip()) < 6:
        raise HTTPException(status_code=400, detail="新密码至少需要 6 位")
    attempt_key = await limiter.check("student", body.username)
    if await limiter.captcha_required(attempt_key):
        if not await student_svc.verify_captcha(body.captcha_id, body.captcha_answer):
            raise HTTPException(403, "多次验证失败，请完成图形验证码", headers={"X-Login-Captcha-Required": "true"})
    student = await student_svc.change_student_password(
        body.username,
        body.current_password,
        body.new_password,
    )
    if not student:
        required = await limiter.captcha_required(attempt_key, next_attempt=True)
        raise HTTPException(status_code=401, detail="账号或原密码错误", headers={"X-Login-Captcha-Required": str(required).lower()})
    await limiter.succeeded(attempt_key)
    return {"changed": True}


@router.get("/auth/account-credentials", response_model=schemas.AccountCredentialsSettings)
async def get_account_credentials(response: Response,
    student_id: str = Depends(get_current_student_id),
    student_svc: StudentService = Depends(get_student_service)):
    response.headers["Cache-Control"] = "no-store"
    student = await student_svc.get_student(student_id)
    if student is None:
        raise HTTPException(401, "登录已失效，请重新登录")
    return await AccountSecurityService(student_svc).credential_settings(student)


@router.post("/auth/account-credentials")
async def set_account_credentials(body: schemas.AccountCredentialsRequest, request: Request, response: Response,
    student_id: str = Depends(get_current_student_id), authorization: str = Header(),
    student_svc: StudentService = Depends(get_student_service),
    limiter: SensitiveActionLimiter = Depends(get_sensitive_action_limiter)):
    response.headers["Cache-Control"] = "no-store"
    await limiter.reserve([("security-verify-ip", request_ip(request), 30, 600),
                           ("security-credentials-account", student_id, 10, 600)])
    reason = await AccountSecurityService(student_svc).set_credentials(
        student_id, authorization.split(" ", 1)[1].strip(), body.username, body.new_password,
        current_password=body.current_password, renew_session=body.renew_session)
    if isinstance(reason, str):
        messages = {"invalid_username": USERNAME_RULE_HINT,
                    "username_taken": "该账号名已被使用，请换一个",
                    "invalid_password": "密码需为6—128位，不能只有空格",
                    "account_unavailable": "账号不可用或登录已失效，请重新登录",
                    "invalid_current_password": "原密码不正确；如已忘记，请联系部署管理员重置",
                    "username_change_limit": "最近365天内已修改3次用户名，请等待名额恢复后再修改",
                    "no_changes": "请修改用户名或填写新密码后再保存"}
        raise HTTPException(409 if reason == "username_taken" else 400, messages[reason])
    return reason or {"changed": True}


@router.post("/auth/refresh-token", response_model=schemas.StudentLoginResponse)
async def refresh_student_token(
    student_id: str = Depends(get_current_student_id),
    student_svc: StudentService = Depends(get_student_service),
):
    """Exchange a still-valid token for a fresh one; credential changes still revoke both."""
    student = await student_svc.get_student(student_id)
    if not student:
        raise HTTPException(status_code=401, detail="Student account unavailable")
    return {
        "access_token": student_svc.create_access_token(student.id, auth_version=student.auth_version),
        "token_type": "bearer",
        "student": student_svc.serialize_student(student),
    }


@router.get("/auth/me", response_model=schemas.StudentPublic)
async def get_current_student(
    student_id: str = Depends(get_current_student_id),
    student_svc: StudentService = Depends(get_student_service),
):
    student = await student_svc.get_student(student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student_svc.serialize_student(student)


@router.get("/auth/capabilities", response_model=schemas.StudentAuthCapabilitiesResponse)
async def get_auth_capabilities():
    return {"self_registration_enabled": False, "sms_login_enabled": False,
            "sms_password_reset_enabled": False, "sms_phone_change_enabled": False,
            "sms_phone_bind_enabled": False, "class_invitation_registration_enabled": False}
