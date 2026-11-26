#!/usr/bin/env python3
"""Inspect Git candidates without printing secret values; ignored local config stays private."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess


SENSITIVE_SUFFIXES = {".p12", ".pfx", ".p8", ".pem", ".key", ".jks", ".keystore", ".dump", ".sqlite", ".sqlite3", ".db", ".mobileprovision"}
PATTERNS = {
    "private-key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "provider-token": re.compile(rb"(?:AKID[A-Za-z0-9]{28,40}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})"),
}


def inspect(root: Path, forbidden_values: list[str] | None = None) -> tuple[int, list[str]]:
    paths = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root).decode().split("\0")
    paths = sorted(set(path for path in paths if path))
    findings = []
    for relative in paths:
        path = root / relative
        if path.is_symlink():
            findings.append(f"{relative}: symlink requires explicit review")
            continue
        if not path.is_file():
            continue
        if (path.name == ".env" or path.name.startswith(".env.")) and path.name != ".env.example":
            findings.append(f"{relative}: environment file is a Git candidate")
        if path.suffix.lower() in SENSITIVE_SUFFIXES:
            findings.append(f"{relative}: sensitive file extension")
        if path.stat().st_size > 15_000_000:
            findings.append(f"{relative}: large binary requires review")
            continue
        data = path.read_bytes()
        for name, pattern in PATTERNS.items():
            if pattern.search(data):
                findings.append(f"{relative}: {name} candidate (value redacted)")
        for value in forbidden_values or []:
            if value.encode() in data:
                findings.append(f"{relative}: deployment-specific value (redacted)")
    return len(paths), findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--forbidden-value", action="append", default=[])
    args = parser.parse_args()
    count, findings = inspect(args.root, args.forbidden_value)
    for finding in findings:
        print(finding)
    print(f"Scanned {count} Git candidate files; findings: {len(findings)}. Values are never printed.")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
