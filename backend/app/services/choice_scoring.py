"""Reading and scoring objective answers, shared by practice in the apps and teachers' paper homework.

Multiple choice follows the national exam (高考) rule: exactly the correct options earn full
marks; some of the correct options and nothing wrong ("少选") earns half; any wrong option
earns nothing.
"""
import re

PARTIAL_CREDIT = 0.5
# A half-right multiple choice moves mastery like a partly scored worked answer.
PARTIAL_EVIDENCE_WEIGHT = 0.55
PARTIAL_FEEDBACK = "少选：选出的选项都对，但没有选全。按高考多选题规则得一半分（如 6 分题得 3 分）。"

_FULL_WIDTH = str.maketrans({
    "Ａ": "A", "Ｂ": "B", "Ｃ": "C", "Ｄ": "D", "Ｅ": "E", "Ｆ": "F", "Ｇ": "G", "Ｈ": "H",
    "ａ": "A", "ｂ": "B", "ｃ": "C", "ｄ": "D", "ｅ": "E", "ｆ": "F", "ｇ": "G", "ｈ": "H",
})


def normalize_choice_answer(answer: str | None, question_type: str) -> str:
    normalized = (
        (answer or "")
        .translate(_FULL_WIDTH)
        .replace("，", ",")
        .replace("、", ",")
        .replace(" ", "")
        .replace("\t", "")
        .upper()
    )
    labels = extract_choice_labels(normalized)
    if question_type == "multiple_choice":
        return "".join(sorted(dict.fromkeys(labels)))
    return labels[0] if labels else normalized.strip(",")


def extract_choice_labels(answer: str) -> list[str]:
    text = (answer or "").strip()
    if not text:
        return []

    compact = re.sub(r"[\s,，、;；.。:：()（）\[\]【】]+", "", text)
    if compact and re.fullmatch(r"[A-H]+", compact):
        return list(compact)

    for marker in ("答案", "故选", "选项", "选"):
        if marker in text:
            tail = text.split(marker, 1)[1]
            found = re.findall(r"[A-H]", tail)
            if found:
                return found

    leading = re.match(r"^[\(（\[]?([A-H])([\)）\].。:：、,，项]|$)", text)
    if leading:
        return [leading.group(1)]

    return []


def multiple_choice_credit(key_letters: str, given_letters: str) -> float | None:
    """1 for exactly the key, PARTIAL_CREDIT for a correct but incomplete set, else 0; None without a key."""
    expected, chosen = set(key_letters), set(given_letters)
    if not expected:
        return None
    if chosen == expected:
        return 1.0
    if chosen and chosen < expected:
        return PARTIAL_CREDIT
    return 0.0


def is_partial_multiple_choice(question_type: str | None, key: str | None, answer: str | None) -> bool:
    if question_type != "multiple_choice":
        return False
    credit = multiple_choice_credit(normalize_choice_answer(key, question_type),
                                    normalize_choice_answer(answer, question_type))
    return credit == PARTIAL_CREDIT
