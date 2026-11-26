

def compact_learning_card_context(body: dict | None) -> str:
    if not body:
        return ""
    sections = body.get("sections", [])
    if not isinstance(sections, list):
        return ""
    lines: list[str] = []
    for section in sections[:8]:
        if not isinstance(section, dict):
            continue
        title = section.get("title") or section.get("type") or "内容"
        parts = []
        for key in ("html", "latex", "stem", "solution", "key_takeaway"):
            value = section.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
        items = section.get("items")
        if isinstance(items, list):
            parts.extend(str(item).strip() for item in items[:5] if str(item).strip())
        if parts:
            lines.append(f"{title}: " + "；".join(parts))
    return "\n".join(lines)[:3000]
