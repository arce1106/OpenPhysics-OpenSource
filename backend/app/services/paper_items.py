"""What each item of a printed homework is: a choice answered in the table at the top,
or a question worked in an answer area under its stem, and how tall that area is."""

CHOICE_TYPES = {"single_choice", "multiple_choice", "true_false"}
BOX_HEIGHTS = {"small": 40.0, "medium": 70.0, "large": 110.0}
# Teachers may set an exact height instead; it must still fit one page column and scan as an area.
AREA_MM_RANGE = (30, 230)
AREA_MM_STEP = 5


def normalize_print_layout(value):
    """Small, bounded print overrides; never accept arbitrary CSS or markup."""
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) - {"figure", "figure_width_mm", "break_before"}:
        raise ValueError("排版设置无效")
    figure, width, before = value.get("figure", "auto"), value.get("figure_width_mm"), value.get("break_before")
    if not isinstance(figure, str) or figure not in {"auto", "wrap", "block"} or (before is not None and before != "column"):
        raise ValueError("题图位置或分栏设置无效")
    if width is not None and (type(width) is not int or not 20 <= width <= 75 or width % 5):
        raise ValueError("题图宽度需为20—75毫米，按5毫米调整")
    result = {}
    if figure != "auto":
        result["figure"] = figure
    if width is not None:
        result["figure_width_mm"] = width
    if before:
        result["break_before"] = before
    return result or None

DEFAULT_BOX_BY_TYPE = {
    "fill_in_blank": "small",
    "knowledge_fill_in_blank": "small",
    "experiment": "medium",
    "graph_construction": "medium",
    "problem_solving": "large",
    "comprehensive": "large",
}


def is_choice(question_type: str | None) -> bool:
    return question_type in CHOICE_TYPES


def default_box(question_type: str | None) -> str | None:
    if is_choice(question_type):
        return None
    return DEFAULT_BOX_BY_TYPE.get(question_type or "", "medium")
