# 发行素材来源

核对日期：2026-11-26。本清单覆盖 Git 中直接附带的图片与字体；包管理器下载的依赖仍各自适用其许可证。

| 素材 | 来源与分发说明 |
| --- | --- |
| 三端网页 SVG、学生 PWA PNG、教师品牌 PNG、Android 启动图、iOS AppIcon | 本独立发行版重新绘制的几何 OP 标识；PNG 均由学生端 `public/icon.svg` 渲染生成，未复用运营版品牌图片 |
| `backend/static/questions/demo_position_time.svg` | 随原创演示题绘制的位移时间图，不包含教材扫描图片 |
| Android KaTeX 的 20 个 WOFF2 字体 | 与安装的 KaTeX 0.18.2 包中对应字体逐字节一致；保留程序 MIT 及字体项目 MIT 声明，见 `LICENSES/KaTeX-MIT.txt`、`LICENSES/KaTeX-fonts-MIT.txt`；[字体上游](https://github.com/KaTeX/katex-fonts/blob/master/LICENSE) |
| Android Noto CJK 三个 OTF 子集 | 随附说明记载为 Noto Sans CJK SC 2.004 子集；保留原有 SIL OFL 1.1 完整声明和子集说明，见 Android `assets/licenses/NotoSansCJK-OFL.txt` |
| 题库 JSON、知识卡和目录 | 只附演示内容与目录；586 道示例用于体验功能，尚未经过教师逐题教学审核，不包含原运营题库与视频 |

本仓库没有题库扫描图、正式应用安装包、运营视频或应用商店签名。部署者新增的题目、图片、视频、字体和品牌需自行确认分发权限。更换第三方素材或依赖后应同步检查其声明。
