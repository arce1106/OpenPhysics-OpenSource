"""Deployment contract and opt-in equivalence checks for the minimal renderer.

The static checks require no services. Integration checks use two preinstalled
directories supplied by OPENPHYSICS_RENDERER_REFERENCE_DIR and
OPENPHYSICS_RENDERER_RUNTIME_DIR; neither npm install nor network I/O occurs here.
"""

import json
import os
from pathlib import Path
import subprocess
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_ROOT = BACKEND_ROOT / "runtime-rich-content"
STUDENT_ROOT = BACKEND_ROOT.parent / "frontend" / "student"
RENDER_COMMAND = ["npm", "run", "render-rich-content", "--silent", "--"]
REFERENCE_DIR = os.getenv("OPENPHYSICS_RENDERER_REFERENCE_DIR")
RUNTIME_DIR = os.getenv("OPENPHYSICS_RENDERER_RUNTIME_DIR")


def read_json(path):
    return json.loads(path.read_text())


class RichContentRuntimeContractTest(unittest.TestCase):
    def test_runtime_has_only_exact_existing_renderer_dependencies(self):
        manifest = read_json(RUNTIME_ROOT / "package.json")
        student_lock = read_json(STUDENT_ROOT / "package-lock.json")
        self.assertEqual(
            manifest["dependencies"],
            {
                name: student_lock["packages"][f"node_modules/{name}"]["version"]
                for name in ("katex", "tsx")
            },
        )
        self.assertFalse(manifest.get("devDependencies"))
        self.assertTrue(manifest["private"])

    def test_runtime_preserves_the_existing_script_and_module_mode(self):
        runtime = read_json(RUNTIME_ROOT / "package.json")
        student = read_json(STUDENT_ROOT / "package.json")
        self.assertEqual(runtime["type"], student["type"])
        self.assertEqual(
            runtime["scripts"],
            {"render-rich-content": student["scripts"]["render-rich-content"]},
        )

    def test_runtime_lock_has_no_web_build_or_browser_dependencies(self):
        lock = read_json(RUNTIME_ROOT / "package-lock.json")
        student_lock = read_json(STUDENT_ROOT / "package-lock.json")
        existing = {
            (path.rsplit("node_modules/", 1)[-1], package["version"], package.get("integrity"))
            for path, package in student_lock["packages"].items()
            if path
        }
        self.assertEqual(lock["packages"][""]["dependencies"], read_json(RUNTIME_ROOT / "package.json")["dependencies"])
        self.assertEqual(
            lock["packages"]["node_modules/commander"]["version"],
            student_lock["packages"]["node_modules/commander"]["version"],
        )
        for path, package in lock["packages"].items():
            if not path:
                continue
            name = path.rsplit("node_modules/", 1)[-1]
            self.assertTrue(name in {"katex", "tsx", "commander", "esbuild", "fsevents"} or name.startswith("@esbuild/"), name)
            self.assertNotIn("dev", package, name)
            self.assertTrue(
                (name, package["version"], package.get("integrity")) in existing,
                f"{name}@{package['version']} must match the existing student lockfile",
            )

    def test_backend_installs_runtime_without_changing_process_paths(self):
        dockerfile = (BACKEND_ROOT / "Dockerfile.dev").read_text()
        self.assertIn("WORKDIR /frontend/student", dockerfile)
        self.assertIn("COPY backend/runtime-rich-content/package*.json ./", dockerfile)
        self.assertIn("RUN npm ci --omit=dev", dockerfile)
        self.assertIn("COPY frontend/shared /frontend/shared", dockerfile)
        self.assertNotIn("COPY frontend/student/package", dockerfile)


@unittest.skipUnless(REFERENCE_DIR and RUNTIME_DIR, "Requires two isolated, preinstalled renderer directories")
class RichContentInstalledRuntimeTest(unittest.TestCase):
    @staticmethod
    def run_cli(directory, lines, *, server=True):
        command = RENDER_COMMAND + (["--server"] if server else [])
        return subprocess.run(
            command,
            cwd=directory,
            input="\n".join(lines) + "\n",
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
        )

    def test_installed_runtime_has_no_react_or_web_tools(self):
        modules = Path(RUNTIME_DIR) / "node_modules"
        for name in ("katex", "tsx", "esbuild"):
            self.assertTrue((modules / name / "package.json").is_file(), name)
        for name in ("react", "react-dom", "vite", "vitest", "@playwright/test", "playwright", "typescript", "dompurify"):
            self.assertFalse((modules / name).exists(), name)

    def test_json_lines_are_identical_for_valid_and_invalid_rich_content(self):
        items = [
            {"id": "plain", "text": "物理中文：位移、速度与加速度。<script>不会作为标签</script>"},
            {"id": "formula", "text": r"由 $v=at$、$E_k=\frac{1}{2}mv^2$ 与 $$\vec F=m\vec a$$ 可得。"},
            {"id": "table", "text": "| 量 | 数值 |\n| --- | --- |\n| 速度 | $v_1$ |\n| 位移 | $x=\\frac12at^2$ |"},
            {"id": "image", "text": "如图 {{IMG:0}} 再看 {{IMG:1}}", "imagePaths": ["/static/questions/example.png", "https://example.test/a.png?q=1&n=2"]},
            {"id": "missing-image", "text": "缺失题图 {{IMG:9}}", "imagePaths": []},
            {"id": "invalid", "text": r"错误公式 $\notARealCommand{1}$"},
            {"id": "warning", "text": r"中文数学 $速度=2\text{ m/s}$"},
            {"id": "version", "text": "$x^2$", "rendererVersion": "must-not-override-installed-version"},
        ]
        lines = [json.dumps({"items": items, "strict": strict}, ensure_ascii=False) for strict in (False, True)]
        reference = self.run_cli(REFERENCE_DIR, lines)
        runtime = self.run_cli(RUNTIME_DIR, lines)
        self.assertEqual(reference.returncode, 0, reference.stderr)
        self.assertEqual(runtime.returncode, 0, runtime.stderr)
        self.assertEqual(runtime.stdout, reference.stdout)
        responses = [json.loads(line) for line in runtime.stdout.splitlines()]
        self.assertEqual(len(responses), 2)
        for response in responses:
            rendered = {item["id"]: item["rendered"] for item in response["items"]}
            self.assertTrue(rendered["formula"]["hasMath"])
            self.assertTrue(rendered["table"]["hasMarkdownTable"])
            self.assertTrue(rendered["image"]["hasImage"])
            self.assertTrue(rendered["invalid"]["errors"])
            self.assertFalse(rendered["formula"]["errors"])
            self.assertNotEqual(rendered["version"]["rendererVersion"], "must-not-override-installed-version")
            self.assertTrue(all(item["contentHash"] for item in rendered.values()))

    def test_server_reports_bad_json_then_continues_and_preserves_empty_batches(self):
        lines = ["{not-json", "{}", '{"items":[{"id":"after-error","text":"继续 $v=at$"}],"strict":true}']
        reference = self.run_cli(REFERENCE_DIR, lines)
        runtime = self.run_cli(RUNTIME_DIR, lines)
        self.assertEqual(reference.returncode, 0, reference.stderr)
        self.assertEqual(runtime.returncode, 0, runtime.stderr)
        self.assertEqual(runtime.stdout, reference.stdout)
        responses = [json.loads(line) for line in runtime.stdout.splitlines()]
        self.assertTrue(responses[0]["error"])
        self.assertEqual(responses[1], {"items": []})
        self.assertEqual(responses[2]["items"][0]["id"], "after-error")

    def test_one_shot_output_and_invalid_input_exit_contract_match(self):
        for line in ('{"items":[{"id":"once","text":"中文 $x=1$"}],"strict":true}', "{not-json"):
            with self.subTest(line=line):
                reference = self.run_cli(REFERENCE_DIR, [line], server=False)
                runtime = self.run_cli(RUNTIME_DIR, [line], server=False)
                self.assertEqual(runtime.returncode, reference.returncode)
                self.assertEqual(runtime.stdout, reference.stdout)
                self.assertEqual(runtime.stderr.splitlines()[:1], reference.stderr.splitlines()[:1])

    def test_python_bridge_cache_process_and_errors_match(self):
        from app.services.rich_content_render_service import RichContentRenderService

        reference = RichContentRenderService(enabled=True, frontend_student_dir=Path(REFERENCE_DIR))
        runtime = RichContentRenderService(enabled=True, frontend_student_dir=Path(RUNTIME_DIR))
        try:
            for strict in (False, True):
                for text in ("中文 $v=at$ {{IMG:0}}", r"错误 $\notARealCommand{1}$"):
                    with self.subTest(strict=strict, text=text):
                        kwargs = {"strict": strict, "image_paths": ["/static/questions/example.png"]}
                        expected = reference.render_text(text, **kwargs)
                        actual = runtime.render_text(text, **kwargs)
                        self.assertEqual(actual, expected)
                        self.assertEqual(actual["renderer"], "katex")
                        self.assertEqual(actual["renderer_version"], read_json(RUNTIME_ROOT / "package.json")["dependencies"]["katex"])
                        self.assertEqual(actual["content_hash"], actual["contentHash"])
                        process = runtime._process
                        self.assertEqual(runtime.render_text(text, **kwargs), actual)
                        self.assertIs(runtime._process, process)
            self.assertEqual(len(runtime._cache), 4)
        finally:
            runtime.close()
            reference.close()


if __name__ == "__main__":
    unittest.main()
