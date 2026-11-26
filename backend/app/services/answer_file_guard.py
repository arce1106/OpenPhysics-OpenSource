"""Cross-worker serialization for private photo writes and irreversible account erasure."""
import fcntl
import os
import re
from contextlib import contextmanager
from pathlib import Path


class AnswerFilesErased(PermissionError):
    pass


@contextmanager
def answer_file_guard(root: Path, student_id: str, *, erasing: bool = False):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", student_id):
        raise AnswerFilesErased("Invalid private media owner")
    # Outside the deleted photo directory: late uploads must not recreate it.
    guards = root.parent / ".account-erasure"
    guards.mkdir(parents=True, exist_ok=True)
    lock_fd = os.open(guards / f"{student_id}.lock", os.O_CREAT | os.O_RDWR, 0o600)
    marker = guards / f"{student_id}.deleted"
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        if not erasing and marker.exists():
            raise AnswerFilesErased("Account media erased")
        # The caller must not await while holding this synchronous filesystem lock.
        yield marker
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        os.close(lock_fd)
