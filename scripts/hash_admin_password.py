#!/usr/bin/env python3
"""Generate ADMIN_PASSWORD_HASH for OpenPhysics admin login."""

from __future__ import annotations

import getpass
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.admin_auth_service import AdminAuthService


def main() -> int:
    password = getpass.getpass("Admin password: ")
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("Passwords do not match", file=sys.stderr)
        return 2
    if len(password) < 10:
        print("Password must be at least 10 characters", file=sys.stderr)
        return 2
    print(AdminAuthService.hash_password(password))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
