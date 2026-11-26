"""New/changed student usernames only; legacy login names remain untouched."""
import re

USERNAME_RULE_HINT = "中文2—8字，英文4—16位；支持汉字、字母、数字、下划线，混合时汉字算2位，总长4—16位，不能为纯数字"
_ALLOWED = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9_]+")
_LETTER = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fffA-Za-z]")


def username_length(value: str) -> int:
    return sum(2 if ord(char) > 127 else 1 for char in value)


def valid_username(value: str) -> bool:
    return bool(_ALLOWED.fullmatch(value) and _LETTER.search(value) and 4 <= username_length(value) <= 16)
