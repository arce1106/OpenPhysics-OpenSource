import inspect

from app.api.student import answer_grading
from app.services.physics_error_types import normalize_process_grading


def test_handwriting_trace_submission_route_is_not_exposed():
    paths = {route.path for route in answer_grading.router.routes}

    assert "/practice/submit-handwriting" not in paths


def test_process_evidence_contract_does_not_require_strokes_json():
    signature = inspect.signature(answer_grading.submit_process_evidence)

    assert "strokes_json" not in signature.parameters


def test_process_grading_drops_legacy_handwriting_trace_metadata():
    result = normalize_process_grading({
        "is_correct": False,
        "process_evidence_kind": "scratch_image",
        "process_evidence_image_path": "/static/uploads/answers/student/evidence.png",
        "strokes_path": "/static/uploads/answers/student/evidence.strokes.json",
        "trace_features": {"stroke_count": 1},
        "trace_analysis": {"process_summary": "旧过程分析"},
        "client_platform": "web",
        "source_kind": "web_canvas",
        "trace_schema_version": 1,
    })

    assert result["process_evidence_kind"] == "scratch_image"
    assert result["process_evidence_image_path"] == "/static/uploads/answers/student/evidence.png"
    assert "strokes_path" not in result
    assert "trace_features" not in result
    assert "trace_analysis" not in result
    assert "client_platform" not in result
    assert "source_kind" not in result
    assert "trace_schema_version" not in result
