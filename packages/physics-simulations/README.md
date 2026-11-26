# OpenPhysics动画实验室

这是 OpenPhysics 仓库内的独立物理动画项目。当前阶段只用于本地开发、教师审阅和录屏，不接入学生端，也不进入生产镜像。

## 目录

```text
packages/physics-simulations/
├── core/          纯物理计算，不依赖 React 或浏览器
├── react/         可复用的 React 动画组件与播放时钟
├── scenarios/     教学参数、知识点映射和动画目录
├── gallery/       独立预览与调试页面
├── video-export/  横屏/竖屏录制约定
└── tests/         物理正确性和目录契约测试
```

## 本地运行

```bash
cd packages/physics-simulations
npm install
npm run dev
```

打开 `http://127.0.0.1:5180/`。录屏时可打开：

- 横屏：`http://127.0.0.1:5180/?mode=recording&format=landscape`
- 竖屏：`http://127.0.0.1:5180/?mode=recording&format=portrait`

## 当前边界

- 第一套样例：水平地面上的木板—滑块。
- 参数分别表示“木板与地面”和“滑块与木板”两个接触面的摩擦因数；当前教学模型假设每个接触面的最大静摩擦力等于滑动摩擦力。
- 物理模型在滑块到达木板边缘时停止，不处理离板后的竖直下落。
- 三维库、Manim 和学生端依赖暂不引入。
- 新动画先通过 `core` 测试和教师审阅，再进入目录的 `available` 状态。
