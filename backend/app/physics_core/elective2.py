import math


FIELD_BOUNDS = {"left": 70.0, "right": 306.0, "top": 38.0, "bottom": 198.0}


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _round(value: float, digits: int = 6) -> float:
    return round(float(value), digits)


def build_left_hand_rule_model_package() -> dict:
    """Build the canonical model package for the left-hand rule.

    The same vector contract drives the 2D projection, the Manim 3D video, and
    the tutoring context so students meet one physics model in multiple views.
    """
    return {
        "model_id": "left_hand_rule",
        "title": "左手定则方向模型",
        "description": "用同一组三维方向向量统一二维投影、三维讲解和 AI 助教解释。",
        "render_modes": ["2d_canvas", "3d_manim_video", "ai_context"],
        "formulas": [
            "\\vec F=I\\vec L\\times\\vec B",
            "\\vec F=q\\vec v\\times\\vec B",
            "F=I L B\\quad (I\\perp B)",
        ],
        "vectors": {
            "magnetic_field": {
                "symbol": "B",
                "label": "磁场方向",
                "vector3": [0, 0, -1],
                "color": "#2563eb",
                "teaching_role": "让磁感线垂直穿入手心",
            },
            "current": {
                "symbol": "I/v",
                "label": "电流方向或正电荷速度方向",
                "vector3": [1, 0, 0],
                "color": "#d97706",
                "teaching_role": "四指指向电流方向；若讨论负电荷，要先换成等效电流方向",
            },
            "force": {
                "symbol": "F",
                "label": "安培力或洛伦兹力方向",
                "vector3": [0, 1, 0],
                "color": "#dc2626",
                "teaching_role": "拇指所指方向",
            },
        },
        "views": {
            "two_d_projection": {
                "plane": "xy",
                "camera": [2.6, -3.0, 2.1],
                "projection_note": "二维画面采用俯视投影：电流向右、磁场用叉点表示垂直纸面、受力向上或向下。",
            },
            "three_d_video": {
                "source": "manim",
                "url": "/static/physics_videos/elective2/left_hand_rule_3d.mp4",
                "scene": "LeftHandRule3D",
                "duration_seconds": 32,
            },
        },
        "ai_context": {
            "teacher_summary": "左手定则的核心是三维叉乘关系：磁场 B 垂直穿入手心，四指指向电流 I 或正电荷速度 v，拇指方向就是受力 F。垂直情形下大小可用 F=I L B 或 F=qvB。",
            "common_mistakes": [
                "负电荷运动方向不能直接当四指方向；要么先转成等效电流方向，要么最后把正电荷受力方向反向。",
                "把磁场方向、运动方向、受力方向画在同一条直线上，忽略三者互相垂直的空间关系。",
                "磁场垂直纸面时，叉表示向里，点表示向外，不能只看箭头平面方向。",
            ],
            "student_prompt": "先判断 B 是否垂直穿过手心，再判断四指应该指向 I 还是正电荷速度，最后看拇指方向。",
        },
    }


def build_bounded_magnetic_field_simulation(
    *,
    charge: float = 1.0,
    mass: float = 1.0,
    speed: float = 4.2,
    magnetic_field: float = 0.8,
    entry_y_ratio: float = 0.5,
    samples: int = 48,
) -> dict:
    """Build a standard JSON simulation for charged-particle motion in a finite B field.

    Geometry matches the current student Canvas coordinate system, while physical
    quantities remain explicit in params. The trajectory is an exact circular arc.
    """
    q_abs = max(abs(charge), 0.1)
    b_abs = max(abs(magnetic_field), 0.1)
    safe_mass = max(mass, 0.1)
    radius = safe_mass * speed / (q_abs * b_abs)
    display_radius = _clamp(radius * 24.0, 38.0, 170.0)

    entry_y_ratio = _clamp(entry_y_ratio, 0.08, 0.92)
    entry_x = FIELD_BOUNDS["left"]
    entry_y = FIELD_BOUNDS["top"] + (FIELD_BOUNDS["bottom"] - FIELD_BOUNDS["top"]) * entry_y_ratio
    bend = -1.0 if charge * magnetic_field >= 0 else 1.0
    center_x = entry_x
    center_y = entry_y + bend * display_radius

    candidates: list[tuple[float, str]] = []
    right_ratio = (FIELD_BOUNDS["right"] - entry_x) / display_radius
    if 0 < right_ratio <= 1:
        candidates.append((math.asin(right_ratio), "right"))

    y_distance = FIELD_BOUNDS["bottom"] - entry_y if bend > 0 else entry_y - FIELD_BOUNDS["top"]
    y_cos = 1 - y_distance / display_radius
    if y_distance > 0 and -1 <= y_cos <= 1:
        candidates.append((math.acos(y_cos), "bottom" if bend > 0 else "top"))

    valid = sorted((theta, boundary) for theta, boundary in candidates if theta > 0.02)
    if valid:
        exit_theta, boundary = valid[0]
    else:
        exit_theta, boundary = min(math.pi * 0.92, max(0.35, math.pi * 0.62)), "arc"

    exit_x = entry_x + display_radius * math.sin(exit_theta)
    exit_y = entry_y + bend * display_radius * (1 - math.cos(exit_theta))
    period = 2 * math.pi * safe_mass / (q_abs * b_abs)
    flight_time = exit_theta / (2 * math.pi) * period

    count = max(2, min(samples, 120))
    series = []
    for idx in range(count):
        theta = exit_theta * idx / (count - 1)
        x = entry_x + display_radius * math.sin(theta)
        y = entry_y + bend * display_radius * (1 - math.cos(theta))
        series.append({
            "t": _round(flight_time * idx / (count - 1)),
            "x": _round(x),
            "y": _round(y),
            "vx": _round(math.cos(theta)),
            "vy": _round(bend * math.sin(theta)),
            "theta": _round(theta),
        })

    params = {
        "charge": charge,
        "mass": mass,
        "speed": speed,
        "magnetic_field": magnetic_field,
        "radius": _round(radius),
        "period": _round(period),
        "flight_time": _round(flight_time),
        "display_radius": _round(display_radius),
        "entry_x": _round(entry_x),
        "entry_y": _round(entry_y),
        "center_x": _round(center_x),
        "center_y": _round(center_y),
        "exit_x": _round(exit_x),
        "exit_y": _round(exit_y),
        "exit_theta": _round(exit_theta),
        "deflection_angle_deg": _round(exit_theta * 180 / math.pi, 3),
        "boundary": boundary,
        "bend": int(bend),
        "field_bounds": FIELD_BOUNDS,
    }

    return {
        "model_id": "bounded_magnetic_field",
        "title": "有界磁场偏转模型",
        "description": "后端按洛伦兹力提供向心力计算半径，并用圆弧几何求出出射边界、出射点和偏转角。",
        "params": params,
        "series": series,
        "annotations": [
            {"type": "point", "x": params["center_x"], "y": params["center_y"], "label": "圆心"},
            {"type": "point", "x": params["entry_x"], "y": params["entry_y"], "label": "入射点"},
            {"type": "point", "x": params["exit_x"], "y": params["exit_y"], "label": "出射点"},
            {"type": "segment", "from": "center", "to": "entry", "label": "r"},
            {"type": "segment", "from": "center", "to": "exit", "label": "r"},
        ],
        "formulas": [
            "r=\\frac{mv}{|q|B}",
            "T=\\frac{2\\pi m}{|q|B}",
            "t=\\frac{\\theta}{2\\pi}T",
        ],
    }
