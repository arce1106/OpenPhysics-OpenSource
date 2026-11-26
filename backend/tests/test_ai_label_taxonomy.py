from app.services.ai_service import sanitize_labeling_results


def test_sanitize_labeling_results_rejects_invented_labels_and_keeps_one_kp():
    kps = [
        {"id": "x2c2s1k04", "name": "楞次定律"},
        {"id": "x2c2s1k05", "name": "安培定则"},
    ]
    raw = [
        {
            "question_id": "q_0001",
            "difficulty_tier": "medium",
            "labels": [
                {"label_type": "knowledge_point", "label_id": "不存在的新知识点", "role": "主要", "confidence": 0.9},
                {"label_type": "knowledge_point", "label_id": "x2c2s1k04", "role": "主要", "confidence": 0.95},
                {"label_type": "knowledge_point", "label_id": "x2c2s1k05", "role": "次要", "confidence": 0.8},
                {"label_type": "physics_model", "label_id": "invented_model", "role": "主要", "confidence": 0.9},
                {"label_type": "question_type", "label_id": "single_choice", "role": "主要", "confidence": 1.0},
                {"label_type": "solution_strategy", "label_id": "formula_application", "role": "主要", "confidence": 0.9},
            ],
        }
    ]

    [result] = sanitize_labeling_results(raw, kps, question_ids={"q_0001"})

    labels = result["labels"]
    assert [label["label_id"] for label in labels if label["label_type"] == "knowledge_point"] == ["x2c2s1k04"]
    assert ("physics_model", "invented_model") not in {
        (label["label_type"], label["label_id"]) for label in labels
    }
    assert ("question_type", "single_choice") in {
        (label["label_type"], label["label_id"]) for label in labels
    }
    assert ("solution_strategy", "formula_application") in {
        (label["label_type"], label["label_id"]) for label in labels
    }


def test_sanitize_labeling_results_maps_unique_existing_kp_name_to_id():
    kps = [
        {"id": "x2c2s1k04", "name": "楞次定律"},
        {"id": "x2c2s1k05", "name": "安培定则"},
    ]
    raw = [
        {
            "question_id": "q_0002",
            "difficulty_tier": "not_a_tier",
            "labels": [
                {"label_type": "knowledge_point", "label_id": "安培定则", "role": "主要", "confidence": 0.9},
            ],
        }
    ]

    [result] = sanitize_labeling_results(raw, kps, question_ids={"q_0002"})

    assert result["difficulty_tier"] is None
    assert result["labels"] == [
        {
            "label_type": "knowledge_point",
            "label_id": "x2c2s1k05",
            "role": "主要",
            "confidence": 0.9,
        }
    ]


def test_sanitize_labeling_results_does_not_guess_duplicate_kp_names():
    kps = [
        {"id": "x2c2s1k04", "name": "楞次定律"},
        {"id": "x2c2s1k07", "name": "楞次定律"},
    ]
    raw = [
        {
            "question_id": "q_0003",
            "labels": [
                {"label_type": "knowledge_point", "label_id": "楞次定律", "role": "主要", "confidence": 0.9},
            ],
        }
    ]

    [result] = sanitize_labeling_results(raw, kps, question_ids={"q_0003"})

    assert result["labels"] == []
