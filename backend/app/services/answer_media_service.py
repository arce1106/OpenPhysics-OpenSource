import hashlib
import hmac
import time
from pathlib import Path
from urllib.parse import quote

from app.core.config import settings


ANSWER_STATIC_PREFIX = "/static/uploads/answers/"
ANSWER_MEDIA_API_PREFIX = "/api/student/answer-images/"
# A teacher's scan crops live in the student's own folder, one level per homework:
# answers/<student>/teacher/<assignment>/<file>. The link carries them as one token.
TEACHER_CROP_MARK = "teacher__"
TEACHER_CROP_SEPARATOR = "__"
ANSWER_IMAGE_FIELDS = {
    "answer_image_path",
    "answer_image_paths",
    "answer_crop_image_path",
    "answer_page_image_path",
    "answer_page_image_paths",
    "process_evidence_image_path",
}


class AnswerMediaService:
    def __init__(
        self,
        *,
        secret: str | None = None,
        static_dir: Path | None = None,
        ttl_seconds: int | None = None,
    ):
        self.secret = (secret or settings.answer_image_signing_secret).encode("utf-8")
        self.static_dir = static_dir or Path(__file__).resolve().parents[2] / "static"
        self.ttl_seconds = ttl_seconds or settings.answer_image_url_ttl_seconds

    def secure_payload(self, student_id: str, payload):
        if isinstance(payload, list):
            return [self.secure_payload(student_id, item) for item in payload]
        if not isinstance(payload, dict):
            return payload
        secured = {}
        for key, value in payload.items():
            if key in ANSWER_IMAGE_FIELDS:
                if isinstance(value, list):
                    secured[key] = [self.create_url(student_id, path) for path in value]
                elif isinstance(value, str):
                    secured[key] = self.create_url(student_id, value)
                else:
                    secured[key] = value
            else:
                secured[key] = self.secure_payload(student_id, value)
        return secured

    def create_url(self, student_id: str, internal_path: str, *, now: int | None = None) -> str:
        parsed = self._parse_internal_path(internal_path)
        if not parsed:
            return internal_path
        owner_id, filename = parsed
        if owner_id != student_id:
            return internal_path
        expires = int(now if now is not None else time.time()) + self.ttl_seconds
        signature = self._signature(owner_id, filename, expires)
        return (
            f"{ANSWER_MEDIA_API_PREFIX}{quote(owner_id, safe='')}/{quote(filename, safe='')}"
            f"?expires={expires}&signature={signature}"
        )

    def resolve(
        self,
        student_id: str,
        filename: str,
        expires: int,
        signature: str,
        *,
        now: int | None = None,
    ) -> Path | None:
        if expires < int(now if now is not None else time.time()) or Path(filename).name != filename:
            return None
        expected = self._signature(student_id, filename, expires)
        if not hmac.compare_digest(signature, expected):
            return None
        candidate = self._file_for(student_id, filename)
        if candidate is None or not candidate.is_file():
            return None
        return candidate

    def _file_for(self, student_id: str, filename: str) -> Path | None:
        root = self.static_dir / "uploads" / "answers" / student_id
        if not filename.startswith(TEACHER_CROP_MARK):
            return root / filename
        parts = filename[len(TEACHER_CROP_MARK):].split(TEACHER_CROP_SEPARATOR, 1)
        if len(parts) != 2 or not all(_plain_name(part) for part in parts):
            return None
        return root / "teacher" / parts[0] / parts[1]

    def _signature(self, student_id: str, filename: str, expires: int) -> str:
        message = f"{student_id}\n{filename}\n{expires}".encode("utf-8")
        return hmac.new(self.secret, message, hashlib.sha256).hexdigest()

    @staticmethod
    def _parse_internal_path(path: str) -> tuple[str, str] | None:
        if not path.startswith(ANSWER_STATIC_PREFIX):
            return None
        relative = Path(path[len(ANSWER_STATIC_PREFIX):])
        if relative.is_absolute() or ".." in relative.parts:
            return None
        if len(relative.parts) == 4 and relative.parts[1] == "teacher":
            # A scan crop from the student's teacher homework.
            student_id, _, assignment_id, name = relative.parts
            if not student_id or not _plain_name(assignment_id) or not _plain_name(name) \
                    or TEACHER_CROP_SEPARATOR in assignment_id:
                return None
            return student_id, f"{TEACHER_CROP_MARK}{assignment_id}{TEACHER_CROP_SEPARATOR}{name}"
        if len(relative.parts) != 2:
            return None
        student_id, filename = relative.parts
        if not student_id or Path(filename).name != filename:
            return None
        return student_id, filename


def _plain_name(value: str) -> bool:
    return bool(value) and value not in {".", ".."} and Path(value).name == value


answer_media_service = AnswerMediaService()
