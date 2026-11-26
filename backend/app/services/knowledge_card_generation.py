"""Helpers for generating and validating OpenPhysics knowledge cards."""

from __future__ import annotations

import json
import re
from typing import Any


VALID_SECTION_TYPES = {"concept", "formula", "diagram", "example", "summary"}

CARD_GENERATION_SYSTEM = """你是一位经验丰富的高中物理教师，正在为 OpenPhysics 智适应系统编写学生端知识卡片。

目标：让学生在 3-5 分钟内真正理解一个知识点，不追求花哨，追求准确、清楚、能纠正常见误区。

质量要求：
1. 只输出 JSON，不要输出 Markdown、解释文字或代码围栏。
2. 严格围绕给定知识点，不要编造不存在的知识点，不要扩展到大学物理。
3. 每张卡片必须有 sections，且至少包含：
   - 这个知识点解决什么问题
   - 核心理解
   - 关键公式/规律
   - 模型图像
   - 常见错误
   - 典型小例子
   - 一句话总结
4. 中文讲解要短而准。概念段落每段尽量不超过 90 个汉字。
5. 公式必须使用 LaTeX；正文中出现公式也用 $...$ 包裹，避免中文、字母和公式混排混乱。
6. 变量表要解释符号、物理意义和单位。没有固定计算公式时，latex 写 "\\text{本知识点重在概念判断，无固定计算公式}"。
7. 例子要小而典型，能暴露学生最容易错的地方，不要生成大题。

输出 JSON 数组格式：
[
  {
    "kp_id": "知识点ID",
    "title": "知识点标题：一句教学定位",
    "sections": [
      {"type": "concept", "title": "这个知识点解决什么问题", "html": "..."},
      {"type": "concept", "title": "核心理解", "html": "..."},
      {"type": "formula", "title": "关键公式/规律", "latex": "...", "variable_table": [{"symbol": "...", "name": "...", "unit": "..."}]},
      {"type": "concept", "title": "模型图像", "html": "..."},
      {"type": "concept", "title": "常见错误", "html": "..."},
      {"type": "example", "title": "典型小例子", "stem": "...", "solution": "...", "key_takeaway": "..."},
      {"type": "summary", "title": "一句话总结", "items": ["...", "...", "..."]}
    ]
  }
]"""


class KnowledgeCardValidationError(ValueError):
    """Raised when an AI-generated knowledge card is not safe to persist."""


def default_content_id(kp_id: str) -> str:
    return f"{kp_id}-card-ai-001"


def build_card_prompt(kps: list[dict[str, Any]], volume: str) -> str:
    compact_kps = [
        {
            "id": kp["id"],
            "name": kp["name"],
            "chapter": kp.get("chapter", ""),
            "section": kp.get("section", ""),
            "description": kp.get("description", ""),
            "difficulty": kp.get("difficulty"),
        }
        for kp in kps
    ]
    return (
        f"请为《{volume}》下面这些高中物理知识点生成高质量知识卡片。\n"
        "每个知识点生成一张卡片，kp_id 必须原样返回。\n"
        "卡片 sections 必须覆盖：这个知识点解决什么问题、核心理解、关键公式/规律、模型图像、常见错误、典型小例子、一句话总结。\n"
        "知识点列表 JSON：\n"
        f"{json.dumps(compact_kps, ensure_ascii=False, indent=2)}"
    )


def extract_json_payload(text: str) -> Any:
    text = _strip_think(text).strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:])
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
        text = text.strip()

    if text.startswith("["):
        end = text.rfind("]")
        text = text[: end + 1] if end != -1 else text
    else:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            text = text[start : end + 1]

    payload = json.loads(text)
    if isinstance(payload, dict) and isinstance(payload.get("cards"), list):
        return payload["cards"]
    return payload


def normalize_generated_cards(
    raw_payload: Any,
    kp_lookup: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    cards = raw_payload
    if isinstance(cards, dict) and isinstance(cards.get("cards"), list):
        cards = cards["cards"]
    if not isinstance(cards, list):
        raise KnowledgeCardValidationError("payload must be a JSON array")

    normalized = []
    seen: set[str] = set()
    for index, card in enumerate(cards):
        normalized.append(_normalize_one_card(card, kp_lookup, index, seen))
    return normalized


def _normalize_one_card(
    card: Any,
    kp_lookup: dict[str, dict[str, Any]],
    index: int,
    seen: set[str],
) -> dict[str, Any]:
    if not isinstance(card, dict):
        raise KnowledgeCardValidationError(f"card {index} must be an object")

    kp_id = str(card.get("kp_id", "")).strip()
    if kp_id not in kp_lookup:
        raise KnowledgeCardValidationError(f"card {index} has unknown kp_id: {kp_id}")
    if kp_id in seen:
        raise KnowledgeCardValidationError(f"duplicate kp_id: {kp_id}")
    seen.add(kp_id)

    title = _clean_text(card.get("title")) or kp_lookup[kp_id]["name"]
    sections = card.get("sections")
    if not isinstance(sections, list):
        raise KnowledgeCardValidationError(f"{kp_id} sections must be a list")

    normalized_sections = [_normalize_section(section, kp_id) for section in sections]
    types = {section["type"] for section in normalized_sections}
    if "example" not in types:
        raise KnowledgeCardValidationError(f"{kp_id} requires an example section")
    if "summary" not in types:
        raise KnowledgeCardValidationError(f"{kp_id} requires a summary section")
    if "formula" not in types:
        raise KnowledgeCardValidationError(f"{kp_id} requires a formula section")
    if len(normalized_sections) < 5:
        raise KnowledgeCardValidationError(f"{kp_id} requires at least 5 sections")

    return {
        "kp_id": kp_id,
        "title": title,
        "body": {"sections": normalized_sections},
    }


def _normalize_section(section: Any, kp_id: str) -> dict[str, Any]:
    if not isinstance(section, dict):
        raise KnowledgeCardValidationError(f"{kp_id} section must be an object")

    section_type = _clean_text(section.get("type"))
    if section_type not in VALID_SECTION_TYPES:
        raise KnowledgeCardValidationError(f"{kp_id} has invalid section type: {section_type}")

    title = _clean_text(section.get("title"))
    if not title:
        raise KnowledgeCardValidationError(f"{kp_id} {section_type} section requires title")

    normalized = dict(section)
    normalized["type"] = section_type
    normalized["title"] = title

    if section_type == "concept":
        html = _clean_text(section.get("html"))
        if not html:
            raise KnowledgeCardValidationError(f"{kp_id} concept section requires html")
        normalized["html"] = html
    elif section_type == "formula":
        latex = _clean_text(section.get("latex"))
        if not latex:
            raise KnowledgeCardValidationError(f"{kp_id} formula section requires latex")
        variable_table = section.get("variable_table", [])
        if not isinstance(variable_table, list):
            raise KnowledgeCardValidationError(f"{kp_id} formula variable_table must be a list")
        normalized["latex"] = latex
        normalized["variable_table"] = [_normalize_variable(row) for row in variable_table]
    elif section_type == "example":
        for key in ("stem", "solution"):
            if not _clean_text(section.get(key)):
                raise KnowledgeCardValidationError(f"{kp_id} example section requires {key}")
        normalized["stem"] = _clean_text(section.get("stem"))
        normalized["solution"] = _clean_text(section.get("solution"))
        normalized["key_takeaway"] = _clean_text(section.get("key_takeaway"))
    elif section_type == "summary":
        items = section.get("items")
        if not isinstance(items, list):
            raise KnowledgeCardValidationError(f"{kp_id} summary items must be a list")
        cleaned_items = [_clean_text(item) for item in items if _clean_text(item)]
        if not cleaned_items:
            raise KnowledgeCardValidationError(f"{kp_id} summary requires non-empty items")
        normalized["items"] = cleaned_items
    elif section_type == "diagram":
        if not (_clean_text(section.get("svg")) or _clean_text(section.get("html"))):
            raise KnowledgeCardValidationError(f"{kp_id} diagram section requires svg or html")

    return normalized


def _normalize_variable(row: Any) -> dict[str, str]:
    if not isinstance(row, dict):
        raise KnowledgeCardValidationError("formula variable row must be an object")
    return {
        "symbol": _clean_text(row.get("symbol")),
        "name": _clean_text(row.get("name")),
        "unit": _clean_text(row.get("unit")) or "-",
    }


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return re.sub(r"\s+", " ", text)


def _strip_think(text: str) -> str:
    if "</think>" in text:
        return text.split("</think>")[-1].strip()
    return text
