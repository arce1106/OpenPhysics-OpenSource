from scripts.import_homework import infer_volume_from_doc_name


def test_infer_volume_from_elective2_doc_name():
    assert infer_volume_from_doc_name("第二章　2　法拉第电磁感应定律.docx") == "选择性必修 第二册"


def test_infer_volume_from_explicit_required_doc_name():
    assert infer_volume_from_doc_name("必修二 第五章 曲线运动.docx") == "必修 第二册"


def test_infer_volume_returns_none_when_ambiguous():
    assert infer_volume_from_doc_name("第一章 质点 参考系.docx") is None
