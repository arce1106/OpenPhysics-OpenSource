import math

from app.physics_core.elective2 import (
    build_bounded_magnetic_field_simulation,
    build_left_hand_rule_model_package,
)


def test_bounded_magnetic_field_simulation_contains_physics_contract():
    sim = build_bounded_magnetic_field_simulation(
        charge=1.0,
        mass=1.0,
        speed=4.2,
        magnetic_field=0.8,
        entry_y_ratio=0.5,
    )

    assert sim["model_id"] == "bounded_magnetic_field"
    assert sim["title"] == "有界磁场偏转模型"
    assert sim["params"]["radius"] == 5.25
    assert sim["params"]["boundary"] in {"right", "top", "bottom", "arc"}
    assert sim["series"][0]["t"] == 0
    assert sim["series"][0]["x"] == sim["params"]["entry_x"]
    assert sim["series"][0]["y"] == sim["params"]["entry_y"]
    assert sim["series"][-1]["x"] == sim["params"]["exit_x"]
    assert sim["series"][-1]["y"] == sim["params"]["exit_y"]
    assert "r=\\frac{mv}{|q|B}" in sim["formulas"]
    assert any(item["type"] == "point" and item["label"] == "圆心" for item in sim["annotations"])


def test_bounded_magnetic_field_series_stays_on_circular_path():
    sim = build_bounded_magnetic_field_simulation(
        charge=1.0,
        mass=1.0,
        speed=4.2,
        magnetic_field=0.8,
        entry_y_ratio=0.5,
        samples=16,
    )
    cx = sim["params"]["center_x"]
    cy = sim["params"]["center_y"]
    display_radius = sim["params"]["display_radius"]

    for point in sim["series"]:
        distance = math.hypot(point["x"] - cx, point["y"] - cy)
        assert abs(distance - display_radius) < 1e-6


def test_left_hand_rule_model_package_unifies_2d_3d_and_ai_context():
    package = build_left_hand_rule_model_package()

    assert package["model_id"] == "left_hand_rule"
    assert package["render_modes"] == ["2d_canvas", "3d_manim_video", "ai_context"]
    assert package["vectors"]["magnetic_field"]["vector3"] == [0, 0, -1]
    assert package["vectors"]["current"]["vector3"] == [1, 0, 0]
    assert package["vectors"]["force"]["vector3"] == [0, 1, 0]
    assert package["views"]["two_d_projection"]["plane"] == "xy"
    assert package["views"]["three_d_video"]["source"] == "manim"
    assert package["views"]["three_d_video"]["url"].endswith("/left_hand_rule_3d.mp4")
    assert "负电荷" in package["ai_context"]["common_mistakes"][0]
    assert "F=I L B" in package["ai_context"]["teacher_summary"]
