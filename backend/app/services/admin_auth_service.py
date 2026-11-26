import base64
import hashlib
import hmac
import json
import secrets
from time import time

PASSWORD_ITERATIONS = 260_000
ADMIN_SUBJECT = "admin"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


class AdminAuthService:
    @staticmethod
    def hash_password(password: str) -> str:
        salt = secrets.token_urlsafe(16)
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            PASSWORD_ITERATIONS,
        )
        return f"pbkdf2_sha256:{PASSWORD_ITERATIONS}:{salt}:{_b64url(digest)}"

    @staticmethod
    def verify_password(password: str, password_hash: str) -> bool:
        try:
            separator = ":" if ":" in password_hash else "$"
            algorithm, iterations_raw, salt, expected = password_hash.split(separator, 3)
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
    def create_access_token(username: str, secret: str, minutes: int) -> str:
        header = {"alg": "HS256", "typ": "JWT"}
        payload = {
            "sub": ADMIN_SUBJECT,
            "username": username,
            "exp": int(time()) + minutes * 60,
        }
        header_part = _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
        payload_part = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        signing_input = f"{header_part}.{payload_part}".encode("ascii")
        signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
        return f"{header_part}.{payload_part}.{_b64url(signature)}"

    @staticmethod
    def decode_access_token(token: str, secret: str) -> str | None:
        try:
            header_part, payload_part, signature_part = token.split(".", 2)
            signing_input = f"{header_part}.{payload_part}".encode("ascii")
            expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
            if not hmac.compare_digest(_b64url(expected_sig), signature_part):
                return None
            payload = json.loads(_b64url_decode(payload_part))
            if payload.get("sub") != ADMIN_SUBJECT:
                return None
            if int(payload.get("exp", 0)) < int(time()):
                return None
            username = payload.get("username")
            return username if isinstance(username, str) and username else None
        except Exception:
            return None
