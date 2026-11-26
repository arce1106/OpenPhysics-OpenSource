from manim import *


FONT = "Noto Sans CJK SC"


def zh(text: str, font_size: int = 28, color=WHITE) -> Text:
    return Text(text, font=FONT, font_size=font_size, color=color)


class LeftHandRule3D(ThreeDScene):
    """Chinese 3D teaching scene for the left-hand rule model package."""

    def construct(self):
        self.set_camera_orientation(phi=62 * DEGREES, theta=-42 * DEGREES, zoom=1.0)
        self.camera.background_color = "#0b1220"

        title = zh("左手定则", 38, WHITE).to_edge(UP)
        subtitle = zh("磁场穿入手心，四指指向电流，拇指指向受力", 22, GRAY_B)
        subtitle.next_to(title, DOWN, buff=0.12)
        formula = MathTex(r"\vec F=I\vec L\times\vec B", font_size=34, color=GRAY_A)
        formula.to_edge(DOWN)
        self.add_fixed_in_frame_mobjects(title, subtitle, formula)

        axes = ThreeDAxes(
            x_range=(-2.4, 2.4, 1),
            y_range=(-2.0, 2.0, 1),
            z_range=(-2.0, 2.0, 1),
            x_length=4.6,
            y_length=4.0,
            z_length=4.0,
        ).set_opacity(0.22)

        palm, fingers, thumb_body = self._build_teaching_hand()
        field = self._field_arrows()
        current = Arrow3D(-1.45 * RIGHT - 0.45 * UP, 1.65 * RIGHT - 0.45 * UP, color=YELLOW, thickness=0.035)
        force = Arrow3D(0.1 * RIGHT - 0.12 * UP, 0.1 * RIGHT + 1.65 * UP, color=RED, thickness=0.04)

        field_label = zh("磁场 B：垂直穿入手心", 24, BLUE_B).to_corner(UL).shift(0.05 * DOWN)
        finger_label = zh("四指：电流 I / 正电荷速度 v", 24, YELLOW).to_corner(UL).shift(0.48 * DOWN)
        force_label = zh("拇指：受力 F", 24, RED_B).to_corner(UL).shift(0.91 * DOWN)
        self.add_fixed_in_frame_mobjects(field_label, finger_label, force_label)

        current_label = MathTex(r"I\ /\ v_+", color=YELLOW, font_size=34).move_to(1.95 * RIGHT - 0.5 * UP)
        force_math_label = MathTex(r"F", color=RED, font_size=40).move_to(0.22 * RIGHT + 1.95 * UP)
        field_math_label = MathTex(r"B", color=BLUE_B, font_size=40).move_to(1.65 * IN + 1.05 * LEFT)

        self.play(Create(axes), FadeIn(title), FadeIn(subtitle), FadeIn(formula), run_time=1.0)
        self.play(FadeIn(palm), Create(fingers), run_time=1.2)
        self.play(Create(field), FadeIn(field_math_label), run_time=1.2)
        self.play(Create(current), FadeIn(current_label), run_time=1.0)
        self.play(Create(thumb_body), Create(force), FadeIn(force_math_label), run_time=1.0)

        self.begin_ambient_camera_rotation(rate=0.16)
        self.wait(1.6)
        self.stop_ambient_camera_rotation()

        negative_note = zh("注意：负电荷受力方向与正电荷相反", 26, RED_B)
        negative_note.to_edge(DOWN).shift(0.52 * UP)
        self.add_fixed_in_frame_mobjects(negative_note)
        reversed_force = Arrow3D(0.72 * RIGHT + 0.68 * UP, 0.72 * RIGHT - 1.08 * UP, color=RED_E, thickness=0.04)
        reversed_label = MathTex(r"F_{-}", color=RED_E, font_size=36).move_to(0.95 * RIGHT - 1.3 * UP)
        self.play(FadeOut(force), FadeOut(force_math_label), Create(reversed_force), FadeIn(reversed_label), run_time=1.0)
        self.wait(1.1)

    def _build_teaching_hand(self) -> tuple[VGroup, VGroup, VGroup]:
        palm = RoundedRectangle(width=1.2, height=1.52, corner_radius=0.18, color=TEAL_B)
        palm.set_fill(TEAL_E, opacity=0.32)
        palm.rotate(90 * DEGREES, axis=RIGHT)
        palm.shift(0.15 * RIGHT + 0.08 * UP - 0.14 * OUT)

        fingers = VGroup()
        for z in [-0.42, -0.15, 0.12, 0.39]:
            finger = Cylinder(radius=0.055, height=1.28, direction=RIGHT, resolution=10, color=YELLOW)
            finger.set_fill(YELLOW_E, opacity=0.9)
            finger.move_to(0.63 * RIGHT + 0.62 * UP + z * OUT)
            tip = Sphere(radius=0.065, resolution=(8, 12), color=YELLOW).move_to(1.28 * RIGHT + 0.62 * UP + z * OUT)
            fingers.add(finger, tip)

        knuckle = Cylinder(radius=0.07, height=0.86, direction=OUT, resolution=10, color=YELLOW_E)
        knuckle.move_to(-0.02 * RIGHT + 0.62 * UP)
        fingers.add(knuckle)

        thumb_body = VGroup()
        thumb = Cylinder(radius=0.07, height=1.18, direction=UP, resolution=10, color=RED)
        thumb.set_fill(RED_E, opacity=0.9)
        thumb.move_to(-0.42 * RIGHT + 0.72 * UP - 0.06 * OUT)
        thumb_tip = Sphere(radius=0.085, resolution=(8, 12), color=RED).move_to(-0.42 * RIGHT + 1.34 * UP - 0.06 * OUT)
        thumb_base = Cylinder(radius=0.08, height=0.52, direction=RIGHT, resolution=10, color=RED_E)
        thumb_base.move_to(-0.18 * RIGHT + 0.28 * UP - 0.06 * OUT)
        thumb_body.add(thumb_base, thumb, thumb_tip)
        return VGroup(palm), fingers, thumb_body

    def _field_arrows(self) -> VGroup:
        arrows = VGroup()
        for x in [-0.8, 0.15, 1.1]:
            arrow = Arrow3D(x * RIGHT + 0.05 * UP + 1.18 * OUT, x * RIGHT + 0.05 * UP + 1.0 * IN, color=BLUE_B, thickness=0.025)
            arrows.add(arrow)
        return arrows
