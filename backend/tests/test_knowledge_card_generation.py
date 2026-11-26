import pytest

from app.services.knowledge_card_generation import (
    CARD_GENERATION_SYSTEM,
    KnowledgeCardValidationError,
    build_card_prompt,
    default_content_id,
    normalize_generated_cards,
)


KP_LOOKUP = {
    "e2c1s1k01": {
        "id": "e2c1s1k01",
        "name": "磁场",
        "chapter": "安培力与洛伦兹力",
        "section": "1.1 磁场对通电导线的作用力",
        "description": "认识磁场以及磁场对通电导线的作用。",
        "volume": "选择性必修 第二册",
    }
}


def test_build_card_prompt_contains_teacher_quality_constraints():
    prompt = build_card_prompt(list(KP_LOOKUP.values()), "选择性必修 第二册")

    assert "高中物理教师" in CARD_GENERATION_SYSTEM
    assert "只输出 JSON" in CARD_GENERATION_SYSTEM
    assert "选择性必修 第二册" in prompt
    assert "e2c1s1k01" in prompt
    assert "sections" in prompt
    assert "常见错误" in prompt


def test_normalize_generated_cards_accepts_teacher_grade_card():
    raw_cards = [
        {
            "kp_id": "e2c1s1k01",
            "title": "磁场：用场描述磁相互作用",
            "sections": [
                {"type": "concept", "title": "这个知识点解决什么问题", "html": "磁场用来描述磁体、电流和运动电荷周围的磁相互作用。"},
                {"type": "concept", "title": "核心理解", "html": "磁场不是看得见的物质，但可以通过受力、磁感线和小磁针转向来判断。"},
                {
                    "type": "formula",
                    "title": "关键公式/规律",
                    "latex": "\\vec F=I\\vec L\\times\\vec B",
                    "variable_table": [
                        {"symbol": "\\vec F", "name": "安培力", "unit": "N"},
                        {"symbol": "I", "name": "电流", "unit": "A"},
                    ],
                },
                {"type": "concept", "title": "模型图像", "html": "先确定磁场方向，再判断电流或运动电荷的受力方向。"},
                {"type": "concept", "title": "常见错误", "html": "不要把磁感线当作真实线，也不要把磁场方向等同于受力方向。"},
                {
                    "type": "example",
                    "title": "典型小例子",
                    "stem": "一段直导线垂直放入匀强磁场，电流为 $I$，有效长度为 $L$，求受力大小。",
                    "solution": "垂直时 $\\sin\\theta=1$，所以 $F=BIL$。",
                    "key_takeaway": "只有垂直分量参与安培力大小计算。",
                },
                {"type": "summary", "title": "一句话总结", "items": ["磁场通过受力表现出来", "方向判断要分清对象", "公式要先看夹角"]},
            ],
        }
    ]

    cards = normalize_generated_cards(raw_cards, KP_LOOKUP)

    assert cards[0]["kp_id"] == "e2c1s1k01"
    assert cards[0]["title"] == "磁场：用场描述磁相互作用"
    assert cards[0]["body"]["sections"][-1]["type"] == "summary"


def test_normalize_generated_cards_rejects_unknown_kp():
    with pytest.raises(KnowledgeCardValidationError, match="unknown kp_id"):
        normalize_generated_cards([{"kp_id": "missing", "title": "x", "sections": []}], KP_LOOKUP)


def test_normalize_generated_cards_requires_summary_and_example():
    bad_card = {
        "kp_id": "e2c1s1k01",
        "title": "磁场",
        "sections": [
            {"type": "concept", "title": "核心理解", "html": "磁场描述磁相互作用。"},
            {"type": "formula", "title": "关键公式/规律", "latex": "\\text{无固定公式}", "variable_table": []},
        ],
    }

    with pytest.raises(KnowledgeCardValidationError, match="example"):
        normalize_generated_cards([bad_card], KP_LOOKUP)


def test_default_content_id_is_stable():
    assert default_content_id("e2c1s1k01") == "e2c1s1k01-card-ai-001"
