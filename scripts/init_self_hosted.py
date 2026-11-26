#!/usr/bin/env python3
"""Initialize only this checkout, using fresh secrets and no existing deployment files."""

from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path
import secrets


ROOT = Path(__file__).resolve().parents[1]


def password_hash(password: str) -> str:
    salt = secrets.token_urlsafe(16)
    iterations = 260_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), iterations)
    encoded = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return f"pbkdf2_sha256:{iterations}:{salt}:{encoded}"


def main() -> int:
    env_path = ROOT / ".env"
    local_dir = ROOT / ".local"
    if env_path.exists() or local_dir.exists():
        raise SystemExit("Existing .env or .local found; nothing overwritten. Keep the existing configuration.")
    template = (ROOT / ".env.example").read_text(encoding="utf-8")
    admin_password = secrets.token_urlsafe(24)
    replacements = {
        "__POSTGRES_PASSWORD__": secrets.token_hex(24),
        "__ADMIN_PASSWORD_HASH__": password_hash(admin_password),
        "__ADMIN_AUTH_SECRET__": secrets.token_hex(32),
        "__STUDENT_AUTH_SECRET__": secrets.token_hex(32),
        "__TEACHER_AUTH_SECRET__": secrets.token_hex(32),
        "__ANSWER_IMAGE_SIGNING_SECRET__": secrets.token_hex(32),
    }
    for marker, value in replacements.items():
        template = template.replace(marker, value)
    local_dir.mkdir(mode=0o700)
    with os.fdopen(os.open(local_dir / "admin-password.txt", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as file:
        file.write(admin_password + "\n")
    with os.fdopen(os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as file:
        file.write(template)
    print("Created local .env and .local/admin-password.txt with permissions 0600.")
    print("No external services contacted. Next: docker compose up -d --build")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
