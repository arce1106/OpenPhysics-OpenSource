from typing import Any


_PAPER_IMAGE_PLACEHOLDERS = {
    "[图片]",
    "[手写图片]",
    "[手写过程]",
    "[整套纸笔照片]",
}


def should_infer_paper_batch_image(process_grading: dict[str, Any] | None, given_answer: str | None) -> bool:
    """Only paper/image answers may infer a nearby uploaded worksheet image."""
    grading = process_grading or {}
    if grading.get("answer_source") == "paper_batch":
        return True
    return (given_answer or "").strip() in _PAPER_IMAGE_PLACEHOLDERS
