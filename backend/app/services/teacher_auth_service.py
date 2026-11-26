import hashlib
import hmac
import json
from dataclasses import dataclass
from time import time

from app.services.admin_auth_service import AdminAuthService, _b64url, _b64url_decode

TEACHER_SUBJECT = "teacher"
MIN_PASSWORD_LENGTH = 8


@dataclass(frozen=True)
class TeacherTokenClaims:
    teacher_id: str
    auth_version: int


class TeacherAuthService:
    hash_password = staticmethod(AdminAuthService.hash_password)
    verify_password = staticmethod(AdminAuthService.verify_password)

    @staticmethod
    def password_problem(password: str) -> str | None:
        if len(password) < MIN_PASSWORD_LENGTH:
            return f"密码至少 {MIN_PASSWORD_LENGTH} 位"
        if password.isdigit() or password.isalpha():
            return "密码需同时包含字母和数字"
        return None

    @staticmethod
    def create_access_token(teacher_id: str, auth_version: int, secret: str, minutes: int) -> str:
        header = {"alg": "HS256", "typ": "JWT"}
        payload = {
            "sub": TEACHER_SUBJECT,
            "tid": teacher_id,
            "ver": auth_version,
            "exp": int(time()) + minutes * 60,
        }
        header_part = _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
        payload_part = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        signing_input = f"{header_part}.{payload_part}".encode("ascii")
        signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
        return f"{header_part}.{payload_part}.{_b64url(signature)}"

    @staticmethod
    def decode_access_token(token: str, secret: str) -> TeacherTokenClaims | None:
        try:
            header_part, payload_part, signature_part = token.split(".", 2)
            signing_input = f"{header_part}.{payload_part}".encode("ascii")
            expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
            if not hmac.compare_digest(_b64url(expected_sig), signature_part):
                return None
            payload = json.loads(_b64url_decode(payload_part))
            if payload.get("sub") != TEACHER_SUBJECT:
                return None
            if int(payload.get("exp", 0)) < int(time()):
                return None
            teacher_id, version = payload.get("tid"), payload.get("ver")
            if not isinstance(teacher_id, str) or not teacher_id or type(version) is not int:
                return None
            return TeacherTokenClaims(teacher_id, version)
        except Exception:
            return None
