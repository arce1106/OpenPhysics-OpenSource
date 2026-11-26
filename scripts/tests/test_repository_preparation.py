import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RepositoryPreparationTests(unittest.TestCase):
    def test_initializer_creates_private_independent_secrets_and_refuses_overwrite(self):
        initializer = load("init_self_hosted")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env.example").write_text((SCRIPTS.parent / ".env.example").read_text())
            initializer.ROOT = root
            initializer.main()
            config = dict(line.split("=", 1) for line in (root / ".env").read_text().splitlines() if line and not line.startswith("#"))
            secret_names = ["ADMIN_AUTH_SECRET", "STUDENT_AUTH_SECRET", "TEACHER_AUTH_SECRET", "ANSWER_IMAGE_SIGNING_SECRET"]
            self.assertEqual(len({config[key] for key in secret_names}), 4)
            self.assertTrue(all(len(config[key]) >= 32 for key in secret_names))
            self.assertEqual(os.stat(root / ".env").st_mode & 0o777, 0o600)
            self.assertEqual(os.stat(root / ".local/admin-password.txt").st_mode & 0o777, 0o600)
            before = (root / ".env").read_bytes()
            with self.assertRaises(SystemExit):
                initializer.main()
            self.assertEqual((root / ".env").read_bytes(), before)

    def test_export_guard_checks_forced_tracked_secrets_and_ignores_local_config(self):
        scanner = load("check_public_export")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            (root / ".gitignore").write_text(".env\n")
            (root / ".env").write_text("LOCAL_ONLY=yes\n")
            _, findings = scanner.inspect(root)
            self.assertFalse(findings)
            subprocess.run(["git", "add", "-f", ".env"], cwd=root, check=True)
            self.assertTrue(any("environment file" in item for item in scanner.inspect(root)[1]))
            (root / "signing.txt").write_text("-----BEGIN PRIVATE" + " KEY-----\nplaceholder\n")
            self.assertTrue(any("private-key" in item for item in scanner.inspect(root)[1]))
            (root / "config.txt").write_text("private deployment address")
            self.assertTrue(any("deployment-specific" in item for item in scanner.inspect(root, ["private deployment address"])[1]))


if __name__ == "__main__":
    unittest.main()
