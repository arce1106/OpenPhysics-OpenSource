# Manim Physics Scenes

Manim is used for pre-rendered explanation videos. The frontend should play the
rendered MP4 files; it should not run Manim during student learning.

Render the elective 2 left-hand rule scene after Manim is installed:

```bash
cd backend
manim -qm manim_scenes/elective2/left_hand_rule_3d.py LeftHandRule3D -o left_hand_rule_3d
mkdir -p static/physics_videos/elective2
cp media/videos/left_hand_rule_3d/720p30/left_hand_rule_3d.mp4 \
  static/physics_videos/elective2/left_hand_rule_3d.mp4
```

The student API points to:

```text
/static/physics_videos/elective2/left_hand_rule_3d.mp4
```
