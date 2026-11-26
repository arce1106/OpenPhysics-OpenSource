from __future__ import annotations

import hashlib
import html
import json
import logging
import os
import select
import subprocess
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Iterable

from app.core.config import settings

logger = logging.getLogger(__name__)

RENDERER = "katex"
RENDER_RULE_VERSION = "rich-content-v1"


class RichContentRenderService:
    """Runtime bridge from Python APIs to the shared TypeScript KaTeX renderer."""

    def __init__(
        self,
        *,
        enabled: bool | None = None,
        timeout_seconds: float = 8.0,
        max_cache_entries: int = 1024,
        frontend_student_dir: Path | None = None,
    ):
        env_enabled = _env_bool(os.getenv("OPENPHYSICS_RENDER_RICH_CONTENT"))
        if enabled is None:
            self.enabled = env_enabled if env_enabled is not None else settings.render_rich_content
        else:
            self.enabled = enabled
        self.timeout_seconds = timeout_seconds
        self.max_cache_entries = max_cache_entries
        self._cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._render_lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None
        repo_root = Path(__file__).resolve().parents[3]
        self.frontend_student_dir = frontend_student_dir or repo_root / "frontend" / "student"

    def render_text(
        self,
        text: str | None,
        *,
        image_paths: Iterable[str] | None = None,
        strict: bool = False,
    ) -> dict[str, Any] | None:
        if not self.enabled or text is None:
            return None
        rendered = self.render_items(
            [{"id": "single", "text": text, "imagePaths": list(image_paths or [])}],
            strict=strict,
        )
        return rendered.get("single")

    def render_items(
        self,
        items: Iterable[dict[str, Any]],
        *,
        strict: bool = False,
    ) -> dict[str, dict[str, Any]]:
        with self._render_lock:
            return self._render_items_locked(items, strict=strict)

    def _render_items_locked(
        self,
        items: Iterable[dict[str, Any]],
        *,
        strict: bool = False,
    ) -> dict[str, dict[str, Any]]:
        if not self.enabled:
            return {}
        started_at = time.perf_counter()
        cli_elapsed_ms = 0.0

        normalized_items = [
            {
                "id": str(item.get("id") or ""),
                "text": str(item.get("text") or ""),
                "imagePaths": [str(path) for path in item.get("imagePaths") or []],
            }
            for item in items
            if item.get("id")
        ]
        results: dict[str, dict[str, Any]] = {}
        to_render: list[dict[str, Any]] = []
        cache_keys: dict[str, str] = {}

        for item in normalized_items:
            cache_key = self._cache_key(item["text"], item["imagePaths"], strict)
            cache_keys[item["id"]] = cache_key
            cached = self._get_cache(cache_key)
            if cached is not None:
                results[item["id"]] = cached
            else:
                to_render.append(item)

        if not to_render:
            self._log_render_stats(
                strict=strict,
                item_count=len(normalized_items),
                cache_hits=len(results),
                cache_misses=0,
                cli_elapsed_ms=cli_elapsed_ms,
                total_elapsed_ms=(time.perf_counter() - started_at) * 1000,
            )
            return results

        try:
            cli_started_at = time.perf_counter()
            rendered_items = self._invoke_cli(to_render, strict=strict)
            cli_elapsed_ms = (time.perf_counter() - cli_started_at) * 1000
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning("rich content renderer failed: %s", exc)
            rendered_items = {
                item["id"]: self._fallback_rendered(
                    item["text"],
                    item["imagePaths"],
                    error_message=str(exc),
                )
                for item in to_render
            }

        for item in to_render:
            item_id = item["id"]
            rendered = rendered_items.get(item_id)
            if not rendered:
                rendered = self._fallback_rendered(
                    item["text"],
                    item["imagePaths"],
                    error_message="renderer returned no item",
                )
            rendered = self._normalize_rendered(rendered)
            results[item_id] = rendered
            self._set_cache(cache_keys[item_id], rendered)

        self._log_render_stats(
            strict=strict,
            item_count=len(normalized_items),
            cache_hits=len(results) - len(to_render),
            cache_misses=len(to_render),
            cli_elapsed_ms=cli_elapsed_ms,
            total_elapsed_ms=(time.perf_counter() - started_at) * 1000,
        )
        return results

    def enrich_question(self, question: dict[str, Any] | None) -> dict[str, Any] | None:
        if not self.enabled or not isinstance(question, dict):
            return question

        render_items, bindings = self._collect_question_render_items(question, "question")
        rendered = self.render_items(render_items)
        self._apply_question_rendered(bindings, rendered)

        return question

    def enrich_questions(self, questions: Iterable[dict[str, Any]] | None) -> None:
        if not self.enabled:
            return

        render_items: list[dict[str, Any]] = []
        all_bindings: list[tuple[str, dict[str, Any], str, str | None]] = []
        for index, question in enumerate(questions or []):
            if not isinstance(question, dict):
                continue
            question_items, bindings = self._collect_question_render_items(question, f"q{index}")
            render_items.extend(question_items)
            all_bindings.extend(bindings)

        rendered = self.render_items(render_items)
        self._apply_question_rendered(all_bindings, rendered)

    def _collect_question_render_items(
        self,
        question: dict[str, Any],
        prefix: str,
    ) -> tuple[list[dict[str, Any]], list[tuple[str, dict[str, Any], str, str | None]]]:
        image_paths = self._question_image_paths(question)
        render_items: list[dict[str, Any]] = []
        bindings: list[tuple[str, dict[str, Any], str, str | None]] = []

        if isinstance(question.get("stem_text"), str):
            item_id = f"{prefix}:stem"
            render_items.append({"id": item_id, "text": question["stem_text"], "imagePaths": image_paths})
            bindings.append((item_id, question, "stem_rendered", None))
        elif isinstance(question.get("stem"), str):
            item_id = f"{prefix}:stem"
            render_items.append({"id": item_id, "text": question["stem"], "imagePaths": image_paths})
            bindings.append((item_id, question, "stem_rendered", None))

        for field_name in ("correct_answer", "answer", "explanation"):
            if isinstance(question.get(field_name), str):
                item_id = f"{prefix}:{field_name}"
                render_items.append({"id": item_id, "text": question[field_name], "imagePaths": image_paths})
                bindings.append((item_id, question, f"{field_name}_rendered", None))

        for index, option in enumerate(question.get("options") or []):
            if isinstance(option, dict) and isinstance(option.get("text"), str):
                item_id = f"{prefix}:option:{index}"
                render_items.append({
                    "id": item_id,
                    "text": option["text"],
                    "imagePaths": image_paths,
                })
                bindings.append((item_id, option, "rendered", "text_rendered"))

        return render_items, bindings

    def _apply_question_rendered(
        self,
        bindings: Iterable[tuple[str, dict[str, Any], str, str | None]],
        rendered: dict[str, dict[str, Any]],
    ) -> None:
        for item_id, target, primary_field, secondary_field in bindings:
            item = rendered.get(item_id)
            if not item:
                continue
            target[primary_field] = item
            if secondary_field:
                target[secondary_field] = item

    def enrich_submit_response(self, payload: dict[str, Any] | None) -> dict[str, Any] | None:
        if not self.enabled or not isinstance(payload, dict):
            return payload
        render_items = [
            {"id": field_name, "text": payload[field_name], "imagePaths": []}
            for field_name in ("correct_answer", "explanation", "ai_feedback", "extracted_answer")
            if isinstance(payload.get(field_name), str)
        ]
        process_grading = payload.get("process_grading")
        if isinstance(process_grading, dict):
            for field_name in ("final_answer", "first_error", "next_action", "feedback", "grading_basis"):
                if isinstance(process_grading.get(field_name), str):
                    render_items.append({
                        "id": f"process_grading:{field_name}",
                        "text": process_grading[field_name],
                        "imagePaths": [],
                    })
        rendered = self.render_items(render_items)
        for field_name in ("correct_answer", "explanation", "ai_feedback", "extracted_answer"):
            if field_name in rendered:
                payload[f"{field_name}_rendered"] = rendered[field_name]
        if isinstance(process_grading, dict):
            for field_name in ("final_answer", "first_error", "next_action", "feedback", "grading_basis"):
                key = f"process_grading:{field_name}"
                if key in rendered:
                    process_grading[f"{field_name}_rendered"] = rendered[key]
        return payload

    def enrich_review_groups(self, groups: Iterable[dict[str, Any]] | None) -> None:
        for group in groups or []:
            for mistake in group.get("mistakes") or []:
                self.enrich_question(mistake)
                self._enrich_answer_fields(mistake)

    def enrich_review_group_summaries(self, groups: Iterable[dict[str, Any]] | None) -> None:
        if not self.enabled:
            return
        render_items: list[dict[str, Any]] = []
        bindings: list[tuple[str, dict[str, Any], str, str | None]] = []
        for group_index, group in enumerate(groups or []):
            for mistake_index, mistake in enumerate(group.get("mistakes") or []):
                image_paths = self._question_image_paths(mistake)
                prefix = f"review:{group_index}:{mistake_index}"
                if isinstance(mistake.get("stem_text"), str):
                    item_id = f"{prefix}:stem"
                    render_items.append({
                        "id": item_id,
                        "text": mistake["stem_text"],
                        "imagePaths": image_paths,
                    })
                    bindings.append((item_id, mistake, "stem_rendered", None))
                for option_index, option in enumerate(mistake.get("options") or []):
                    if not isinstance(option, dict) or not isinstance(option.get("text"), str):
                        continue
                    item_id = f"{prefix}:option:{option_index}"
                    render_items.append({
                        "id": item_id,
                        "text": option["text"],
                        "imagePaths": image_paths,
                    })
                    bindings.append((item_id, option, "rendered", "text_rendered"))
        rendered = self.render_items(render_items)
        self._apply_question_rendered(bindings, rendered)

    def enrich_history_items(self, items: Iterable[dict[str, Any]] | None) -> None:
        for item in items or []:
            self.enrich_question(item)
            self._enrich_answer_fields(item)

    def enrich_variations(self, variations: Iterable[dict[str, Any]] | None) -> None:
        for variation in variations or []:
            self.enrich_question(variation.get("question"))

    def enrich_learn_bundle(self, bundle: Any) -> Any:
        if not self.enabled or bundle is None:
            return bundle
        payload = bundle.model_dump() if hasattr(bundle, "model_dump") else bundle
        if not isinstance(payload, dict):
            return bundle
        card = payload.get("card")
        if isinstance(card, dict):
            for section in card.get("sections") or []:
                self.enrich_learning_section(section)
        slides = payload.get("slides")
        if isinstance(slides, dict):
            for slide in slides.get("slides") or []:
                for block in slide.get("blocks") or []:
                    content = block.get("content") if isinstance(block, dict) else None
                    if isinstance(content, dict):
                        self._enrich_learning_content_dict(content)
        for example in payload.get("examples") or []:
            if isinstance(example, dict):
                body = example.get("body")
                if isinstance(body, dict):
                    self._enrich_learning_content_dict(body)
        return payload

    def enrich_learning_section(self, section: dict[str, Any]) -> None:
        content = section.get("content")
        if isinstance(content, dict):
            self._enrich_learning_content_dict(content)

    def enrich_learning_content(self, content: dict[str, Any] | None) -> dict[str, Any] | None:
        if self.enabled and isinstance(content, dict):
            self._enrich_learning_content_dict(content)
            for section in content.get("sections") or []:
                if isinstance(section, dict):
                    self.enrich_learning_section({"content": section})
            for slide in content.get("slides") or []:
                if not isinstance(slide, dict):
                    continue
                for block in slide.get("blocks") or []:
                    if isinstance(block, dict) and isinstance(block.get("content"), dict):
                        self._enrich_learning_content_dict(block["content"])
        return content

    def enrich_tutor_payload(self, payload: dict[str, Any] | None) -> dict[str, Any] | None:
        if not self.enabled or not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
            return payload
        payload["text_rendered"] = self.render_text(payload["text"])
        return payload

    def _enrich_answer_fields(self, payload: dict[str, Any]) -> None:
        items = [
            {"id": field_name, "text": payload[field_name], "imagePaths": []}
            for field_name in ("correct_answer", "explanation", "given_answer")
            if isinstance(payload.get(field_name), str)
        ]
        rendered = self.render_items(items)
        for field_name, item in rendered.items():
            payload[f"{field_name}_rendered"] = item

    def _enrich_learning_content_dict(self, content: dict[str, Any]) -> None:
        items: list[dict[str, Any]] = []
        for field_name in ("text", "body", "content", "summary", "formula", "description"):
            if isinstance(content.get(field_name), str):
                items.append({"id": field_name, "text": content[field_name], "imagePaths": []})
        rendered = self.render_items(items)
        for field_name, item in rendered.items():
            content[f"{field_name}_rendered"] = item

    def _invoke_cli(self, items: list[dict[str, Any]], *, strict: bool) -> dict[str, dict[str, Any]]:
        payload = {"items": items, "strict": strict}
        process = self._ensure_process()
        if process.stdin is None or process.stdout is None:
            self.close()
            raise RuntimeError("renderer process streams unavailable")
        try:
            process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
            process.stdin.flush()
            ready, _, _ = select.select([process.stdout], [], [], self.timeout_seconds)
            if not ready:
                self.close()
                raise TimeoutError("renderer process timed out")
            raw_output = process.stdout.readline()
        except (BrokenPipeError, OSError):
            self.close()
            raise RuntimeError("renderer process stopped unexpectedly")
        if not raw_output:
            self.close()
            raise RuntimeError("renderer process returned no output")
        data = json.loads(raw_output)
        if data.get("error"):
            raise RuntimeError(str(data["error"]))
        return {
            str(item.get("id")): self._normalize_rendered(item.get("rendered"))
            for item in data.get("items") or []
            if item.get("id") and isinstance(item.get("rendered"), dict)
        }

    def _ensure_process(self) -> subprocess.Popen[str]:
        if self._process is not None and self._process.poll() is None:
            return self._process
        self.close()
        self._process = subprocess.Popen(
            ["npm", "run", "render-rich-content", "--silent", "--", "--server"],
            cwd=self.frontend_student_dir,
            text=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=1,
        )
        return self._process

    def close(self) -> None:
        process = self._process
        self._process = None
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=1)

    def __del__(self):  # pragma: no cover - interpreter cleanup is runtime-specific
        try:
            self.close()
        except Exception:
            pass

    def _normalize_rendered(self, rendered: dict[str, Any] | None) -> dict[str, Any]:
        if not isinstance(rendered, dict):
            return {}
        normalized = dict(rendered)
        if "plainText" in normalized:
            normalized["plain_text"] = normalized["plainText"]
        if "rendererVersion" in normalized:
            normalized["renderer_version"] = normalized["rendererVersion"]
        if "contentHash" in normalized:
            normalized["content_hash"] = normalized["contentHash"]
        if "hasMath" in normalized:
            normalized["has_math"] = normalized["hasMath"]
        if "hasImage" in normalized:
            normalized["has_image"] = normalized["hasImage"]
        if "hasMarkdownTable" in normalized:
            normalized["has_markdown_table"] = normalized["hasMarkdownTable"]
        return normalized

    def _question_image_paths(self, question: dict[str, Any]) -> list[str]:
        paths = []
        for image in question.get("images") or []:
            if isinstance(image, dict) and image.get("image_path"):
                paths.append(str(image["image_path"]))
        return paths

    def _cache_key(self, text: str, image_paths: list[str], strict: bool) -> str:
        payload = json.dumps(
            {
                "text": text,
                "imagePaths": image_paths,
                "renderer": RENDERER,
                "rulesVersion": RENDER_RULE_VERSION,
                "strict": strict,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _get_cache(self, key: str) -> dict[str, Any] | None:
        cached = self._cache.get(key)
        if cached is None:
            return None
        self._cache.move_to_end(key)
        return dict(cached)

    def _set_cache(self, key: str, value: dict[str, Any]) -> None:
        self._cache[key] = dict(value)
        self._cache.move_to_end(key)
        while len(self._cache) > self.max_cache_entries:
            self._cache.popitem(last=False)

    def _fallback_rendered(
        self,
        text: str,
        image_paths: list[str],
        *,
        error_message: str,
    ) -> dict[str, Any]:
        return {
            "html": html.escape(text).replace("\n", "<br />"),
            "plainText": text,
            "plain_text": text,
            "renderer": RENDERER,
            "rendererVersion": "fallback",
            "renderer_version": "fallback",
            "contentHash": self._cache_key(text, image_paths, False),
            "content_hash": self._cache_key(text, image_paths, False),
            "hasMath": _has_math(text),
            "has_math": _has_math(text),
            "hasImage": "{{IMG:" in text,
            "has_image": "{{IMG:" in text,
            "hasMarkdownTable": _has_markdown_table(text),
            "has_markdown_table": _has_markdown_table(text),
            "errors": [{"type": "unknown", "message": error_message, "latex": None, "position": None}],
        }

    def _log_render_stats(
        self,
        *,
        strict: bool,
        item_count: int,
        cache_hits: int,
        cache_misses: int,
        cli_elapsed_ms: float,
        total_elapsed_ms: float,
    ) -> None:
        if not _render_debug_enabled():
            return
        logger.debug(
            "rich content render stats strict=%s items=%s cache_hits=%s cache_misses=%s cli_ms=%.1f total_ms=%.1f",
            strict,
            item_count,
            cache_hits,
            cache_misses,
            cli_elapsed_ms,
            total_elapsed_ms,
        )


def _has_math(text: str) -> bool:
    return "$" in text or "\\(" in text or "\\[" in text


def _has_markdown_table(text: str) -> bool:
    return "|" in text and "---" in text


def _env_bool(value: str | None) -> bool | None:
    if value is None:
        return None
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _render_debug_enabled() -> bool:
    env_value = _env_bool(os.getenv("OPENPHYSICS_RENDER_RICH_CONTENT_DEBUG"))
    return bool(env_value) or logger.isEnabledFor(logging.DEBUG)
