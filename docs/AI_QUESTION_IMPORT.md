# 用 AI 辅助录入题库

推荐流程：有权使用的原稿或原创要求 → AI 整理 → 人工核对 → JSON 草稿 → 导入自己的数据库 → 教师审核 → 学生使用。可以把本仓库交给支持读文件的 AI 编程助手，也可以在普通 AI 对话中提供原稿、知识点列表和下方示例。AI 负责整理和建议，教师负责核对题意、答案与标签。

先在本地、自建测试环境完成一小批题目。使用本仓库的自部署环境，不向官网运营站点导入；本教程不需要运营站点账号，也不附带第三方 AI 额度。

## 1. 准备材料和知识点

- 使用自己编写、取得许可或有权使用的题目。原稿保持只读；不把学生身份信息、真实答卷或部署密钥交给模型。
- DOCX、PDF 或截图必须保留题干、答案、解析、图表与小问的对应关系。扫描不清、答案缺失或图片归属不明时，标记待确认，不让 AI 猜测补齐。
- 已有知识点见 [`knowledge_points.json`](../backend/app/seed/knowledge_points.json)，高考板块和专题见 [`learning_catalogs.json`](../backend/app/seed/learning_catalogs.json)。如已在自己的数据库新增或修改知识点，以管理端实际目录为准。
- 先查自己的已有题号，分配未占用的连续 `q_XXXX`；示例文件中的 `q_0001` 只是格式样例，不能每批重复使用，也不要覆盖 `demo_` 题号。

本仓库有结构化 DOCX 解析器 [`DocParser`](../backend/app/services/doc_parser.py) 和 [`import_homework.py`](../backend/scripts/import_homework.py)。它们针对特定文档格式，不是任意 Word/PDF 的通用识题器；后者运行会直接尝试导入，不应跳过原稿核对就拿整本教材运行。管理端当前没有通用的“一键上传 Word 并可靠录入全部题目”入口。

## 2. 把任务交给 AI

以下提示词可直接复制；将占位说明替换为本批材料、知识点和实际题号范围。先做 3—5 道题，确认格式后再分批扩展。

```text
请为我自己的 OpenPhysics 自部署题库整理题目，先只生成草稿文件，不执行数据库写入或审核。

输入：我有权使用的原稿（或明确的原创命题要求）、现有知识点列表、
允许的标签值、未占用的题号范围，以及 docs/examples/ai-question-draft.json。

要求：
1. 先列出原稿顺序表和实际题目数量。原稿按页面、段落、图表和小问顺序处理，
   不把讲解、页眉、栏目标题当题目。原创命题须明确标记来源，不能冒充教材原题。
2. 每题保留完整题干、选项、答案、解析、单位、限定条件和必要图片。
   删除来源题号及分值标记；不改题意，不猜缺失答案或图片归属。
3. 输出标准 UTF-8 JSON，顶层为 {"questions": [...]}，不要混入 Markdown 围栏。
   所有题目 quality_status 必须为 draft，使用分配好的唯一题号。
4. 从已有列表选择知识点 ID，明确“主要/辅助”角色，不发明不存在的 ID。
   补齐 knowledge_point、question_type、physics_model、question_structure、
   ability_dimension、solution_strategy、core_literacy、math_prerequisite 八类标签，
   标签值按仓库现有定义选择。高考题按需附 gaokao_topic；来源系列只用已有值。
5. 单选题恰有一个正确选项，多选题的 answer 与各选项 is_correct 保持一致。
   answer 使用选项标签，如 A 或 AC；解析必须有可检查的物理推理或计算过程。
6. 实验题用 question_type=experiment、options=[]；小问中的 A—D、表格和图片
   保留在所属小问的位置。小问编号连续，答案和解析逐问对应。
7. 公式使用 KaTeX 支持的 LaTeX。JSON 中反斜杠要转义，例如 \\frac、\\times，
   避免产生控制字符。题干图用 {{IMG:0}} 等零起始索引引用 images 中相应位置。
   不添加无关图片或图片说明。
8. 最后提供独立的核对清单：题号、题型、主知识点、答案、图片归属，以及待确认问题。
   任何不确定内容单独列出，未确认前不进入导入批次。

将 JSON 保存为 backend/.local/imports/batch.json，图片放在
backend/.local/imports/images/；先让我查看结果，不擅自审批。
```

静态标签定义可查看 [`ai_service.py` 中的 `STATIC_LABEL_ID_SETS`](../backend/app/services/ai_service.py)，物理模型 ID 见 [`physics_models.py`](../backend/app/services/physics_models.py)。这些文件给出允许值；题目属于哪一类仍需根据实际任务判断，不能把整章或全部实验题套成同一组标签。

## 3. 核对 JSON、公式和图片

完整格式见 [`ai-question-draft.json`](examples/ai-question-draft.json)。它是一道原创单选题，含八类标签、答案和解析，默认草稿；仅作为可复制的格式样例，不随演示种子自动导入。

逐题核对题号、答案、单位、公式与标签。图片按题内顺序放在 `images` 中，例如：

```json
{"ref": "batch-a/q_0001_01.png", "image_type": "diagram", "alt": ""}
```

上例对应本机文件 `backend/.local/imports/images/batch-a/q_0001_01.png`。`ref` 使用相对路径；题干在正确位置写 `{{IMG:0}}`，解析图用 `image_type=explanation` 并放在解析对应位置。实验题所有题干图和解析图都要显式引用一次，不依赖自动附图。选项图应裁为独立 A/B/C/D 图片并由对应选项引用。

含图片、表格、复杂公式的题目逐题看；实验题必须从题首到题尾完整核对小问、A—D、图表和答案顺序。JSON 语法正确不代表题目正确。

## 4. 导入为草稿

在仓库根目录操作。初始化和服务启动方法见 [README](../README.md#快速开始)。`backend/.local/` 会被 Git 忽略；下面路径通过 Compose 的后端挂载对应容器内 `/app/.local/`。

可先复制格式样例体验，再改成自己的批次（请先确认示例题号未被占用）：

```bash
mkdir -p backend/.local/imports
cp docs/examples/ai-question-draft.json backend/.local/imports/batch.json
```

确认原稿与 JSON 后，运行以下命令。它使用应用现有导入服务，拒绝非草稿记录，同题号默认跳过，不更新既有题目；图片会复制到后端题图目录。

```bash
docker compose exec -T backend python - <<'PY'
import asyncio
import json
from pathlib import Path
from app.core.database import async_session
from app.services.question_importer import QuestionImporter
from app.services.question_service import QuestionService

async def main():
    payload = json.loads(Path('/app/.local/imports/batch.json').read_text(encoding='utf-8'))
    questions = payload['questions']
    ids = [q['id'] for q in questions]
    if not questions or len(ids) != len(set(ids)):
        raise ValueError('批次不能为空，题号不能重复')
    if any(q.get('quality_status') != 'draft' for q in questions):
        raise ValueError('首次导入必须全部为 draft')
    image_dir = Path('/app/.local/imports/images')
    async with async_session() as db:
        importer = QuestionImporter(QuestionService(db), allow_updates=False)
        results = await importer.import_questions(
            questions, image_dir=image_dir if image_dir.is_dir() else None,
        )
    for result in results:
        print(result.question_id, result.action)
        if result.action == 'error':
            print(result.error)
    if any(result.action == 'error' for result in results):
        raise SystemExit('存在导入错误，请核对本批记录后再继续')

asyncio.run(main())
PY
```

这是逐题导入；有错误时可能已有部分成功，按输出检查，不能把整批默认视为成功。重复题号显示 `skipped`，不会覆盖已有人工修改。导入器不是题目正确性或所有标签值的审核工具，前面的内容核对仍然需要完成。

需要自动化接入时，也可在自己的 API 文档中使用受管理员认证保护的 `POST /api/admin/questions/batch-import`，提交同样的 `questions` 数组。其 `image_dir` 指后端服务器可读的目录，不是浏览器电脑的目录。

## 5. 教师审核后再开放

进入本地管理端 `http://localhost:5184/resources`，按题号搜索，检查状态、题型、主辅知识点、公式、选项图、答案和解析。未通过审核的草稿不会作为已批准题目进入学生练习。

确认无误后，由管理员或教师按自己的审核流程将题目调整为已通过，再在学生端确认可选题、展示和作答。AI 识别或建议通过不等于人工审核通过，不要让 AI 无条件批量审批。

## 可选：应用内 AI 生成和标注接口

后端保留管理员认证的 `POST /api/admin/ai/generate-questions` 和 `POST /api/admin/ai/label-question`。前者返回生成建议，后者对已有题目返回标签建议；路由不会仅因返回建议就把题目写入并批准。调用前需自行配置 `.env.example` 中对应模型供应商的密钥与模型参数，费用由部署者承担。

当前自部署验收没有执行真实供应商调用，因此不能把这两个接口视为已完成真实模型验收。使用外部 AI 助手先整理 JSON、人工核对后导入的方式，不要求为这一步给本地后端配置模型密钥。
