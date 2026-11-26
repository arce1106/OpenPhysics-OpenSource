# OpenPhysics · 自部署源码版

面向物理教学与学习的应用源码，包含学生网页、教师网页、管理后台、AI 批改、原生 Android/iOS 客户端及共享题目渲染组件。

**自行部署、个人使用及机构内部自用可以免费完整使用。对外商业化须取得项目权利人的书面授权。** 本项目采用自定义的[自部署与商业授权许可](LICENSE)，属于 source-available（源码可用），并非允许自由商用的 OSI 开源许可。

这是独立维护的自部署源码预览版。软件功能代码与教学内容分开管理：不提供原运营服务的教材题库、题图、学生数据、答案照片、签名证书或生产凭据。示例题专为此仓库编写；新增教学内容由部署者确认使用权。

## 核心版范围

保留学生学习、诊断、练习与错题、可选 AI 辅助、题库与知识卡管理、教师班级/作业/审核批改，以及 Android/iOS 客户端。账号由本部署管理员创建。

已从源码和首次发布历史中剥离 Coach、会员订单、支付/内购、短信供应商及手机注册/找回、原运营部署与发布脚本、安卓自更新、固定套卷和运营视频清单。图标采用独立版重新绘制的 OP 标识。通用的账号安全、班级权限、教师自建作业与视频上传仍保留。

## 在线体验

想先看实际效果，可直接访问我们已经部署的元智物理：

- [学生端 · 在线体验](https://physicseed.com/)：查看学习入口，按站内提示注册或登录后体验学习流程。
- [教师端 · 在线体验](https://physicseed.com/teacher/)：教师工作台入口，相关功能需要教师账号及对应班级权限。

这些是现有运营服务，功能、题库、账号规则及可用范围可能与本仓库不同；它们不是开放的演示数据库。源码下载不附带运营站点账号、服务权益或题库内容。想完整控制题库、配置和账号，请按下方步骤部署自己的实例。

## 用 AI 扩充题库

可以把有权使用的题目或原创命题要求交给 AI，整理为带答案、解析、图片引用和知识点标签的 JSON，再导入自己的题库。推荐按“AI 整理 → 人工核对 → 草稿导入 → 教师审核 → 学生使用”进行。

详见 [AI 辅助录题教程](docs/AI_QUESTION_IMPORT.md)：含可复制的提示词、[完整 JSON 示例](docs/examples/ai-question-draft.json)、草稿导入命令、实验题与图片规则，以及可选 AI 生成/标注接口。未配置本地 AI 密钥时，也可用自己选择的 AI 助手整理 JSON 后导入；AI 自动生成和正式教学审核是两个步骤。

## 快速开始

需要 Docker Engine 与 Docker Compose v2，以及用于初始化配置的 Python 3.10+。

当前已验证复用现有兼容后端镜像时的空库部署和核心网页流程；下面的全新镜像构建命令尚未完成实际验收，不能据此宣称任意新机器一键部署已获验证。详细范围见[发布准备记录](docs/PREPARATION.md)。

```bash
python3 scripts/init_self_hosted.py
docker compose up -d --build --wait
docker compose exec backend python scripts/check_self_hosted_schema.py
docker compose exec backend python -m app.seed.seed_demo
```

初始化脚本在本仓库创建被 Git 忽略的 `.env`，生成独立数据库密码、登录密钥和管理员密码。管理员初始密码只保存在权限为 `0600` 的 `.local/admin-password.txt`；请在本机查看并妥善保存。

`--wait` 会等待后端完成迁移并就绪，再执行导入。示例导入可重复执行，同题号题目和既有学习卡片会保留。

如 npm 下载缓慢，可在 `.env` 中设置 `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com` 后重试。此配置同时用于前端容器和后端镜像中的 Node 依赖；不需要私人 npm 令牌。

若你已有兼容的后端镜像，在 `.env` 中填写 `BACKEND_IMAGE=你的本机镜像名`，改用 `docker compose up -d --no-build --pull never --wait`。镜像需满足 `backend/requirements.txt` 的依赖，包含 Node、富内容渲染依赖、Chromium、中文字体和 H5 内容层；任意旧镜像不一定兼容。本仓库不提供原运营项目的私有镜像。

| 入口 | 本机地址 |
| --- | --- |
| 学生网页 | http://localhost:5183 |
| 管理后台 | http://localhost:5184 |
| 教师网页 | http://localhost:5186 |
| API 文档 | http://localhost:8010/docs |

管理员账号为 `admin`。可在管理后台创建学生、教师和班级。使用管理员发放的账号密码登录。有效学生账号可使用完整学习功能；账号禁用、班级隔离、数据访问权限及并发限制仍然生效。本仓库不包含会员套餐、订单、微信支付、苹果内购或商户配置，相关功能由部署者自行实现和接入。

AI 功能需要在本仓库的 `.env` 配置自己的模型服务凭据与模型名称，外部服务费用由部署者承担；没有凭据时不能完成依赖模型的 AI 批改；普通选择题客观判分不依赖模型密钥。图形视频渲染、教师 PDF 和原生客户端有各自的运行依赖，不因源码公开而附带第三方服务额度。

默认 Compose 项目名为 `openphysics-selfhost`，使用本仓库独立的网络和数据卷，端口与原开发配置区分。服务只监听本机回环地址，适合本地体验；对外提供访问前应配置自己的域名、HTTPS、正式环境和独立密钥。

## 源码结构

内置六册物理教材目录：27 章、126 节、574 个知识点，每个知识点至少一道原创演示题，共 586 道。保留第一章原有 20 道示例题，并补入 566 道带答案和解析的基础概念判断题；学习卡片仍仅附第一章的 8 张及一张原创示意图。高考复习提供六个板块、19 个专题。示例用于体验部署与学习流程，未经教师逐题审核，不代表完整教学题库或高考分层训练质量；正式使用前请复核并扩充。见[题库扩充说明](docs/QUESTION_BANK.md)。

| 目录 | 内容 |
| --- | --- |
| `backend/` | FastAPI、数据库模型与迁移、学习与批改服务 |
| `frontend/student/` | 学生网页 |
| `frontend/teacher/` | 教师出卷、扫描收卷与审核 |
| `frontend/admin/` | 管理后台 |
| `frontend/shared/` | 共享富文本与公式渲染 |
| `backend/panes/learning-content-pane/` | 原生应用使用的 H5 内容层 |
| `mobile/` | Android 与 iOS 源码 |
| `packages/physics-simulations/` | 物理仿真组件 |

移动端连接你自己的后端，见 [Android](mobile/openphysics-android/README.md) 与 [iOS](mobile/openphysics-ios/README.md)。本仓库不包含应用商店签名、发布账号或可直接下载的正式 APK。

网页默认不显示未配置的 APP 下载入口、客户端截图和备案号。需要时，在 `.env` 中填写自己的 `VITE_ANDROID_APK_URL`、`VITE_ANDROID_DOWNLOAD_QR_URL`、`VITE_ANDROID_TABLET_PREVIEW_URL`、`VITE_LEGAL_OPERATOR_NAME` 和 `VITE_ICP_FILING`，然后重新创建前端容器；这些公开地址和展示信息不包含 API 密钥。

## 使用许可

- 自行部署供自己、班级或组织内部使用，可以免费使用、修改和构建全部软件功能。
- 销售软件或授权、收费托管、对外提供有偿产品/服务，或将软件集成到对外商业化产品/服务中，需要另行取得书面商业授权。免费试用、广告变现或为后续收费引流也可能属于商业化。
- 机构内部自用本身不因机构具有营利性质而自动成为对外商业化；但用于向客户交付有偿服务的部署属于商业化。
- 免费自部署不授予运营服务、品牌、教材内容、第三方素材或第三方 API 的使用权。

具体权利与义务以 [LICENSE](LICENSE) 为准。商业授权申请内容见 [COMMERCIAL.md](COMMERCIAL.md)。
商业授权由项目发起人（个人）提供，联系邮箱：[451531716@qq.com](mailto:451531716@qq.com)。

## 当前验证范围

首个版本建议定位为**自部署源码预览版**。已验证复用兼容镜像的空库部署、核心网页流程、完整目录与示例题、Android 编译/单元测试和 iOS 编译；全新后端镜像构建、真实 AI、扫描仪与移动端真机、完整 iOS/后端测试、公开部署及 GitHub CI 尚未全部验证。

发布准备状态见 [RELEASE_READINESS](docs/RELEASE_READINESS.md)，详细检查记录见 [PREPARATION](docs/PREPARATION.md)。本地准备通过不代表已公开发布、完成全部素材权利核验或完成所有设备验收。

安全问题及贡献约定见 [SECURITY.md](SECURITY.md)、[CONTRIBUTING.md](CONTRIBUTING.md) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
