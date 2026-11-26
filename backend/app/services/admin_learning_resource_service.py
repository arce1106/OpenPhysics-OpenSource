import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import KnowledgePoint
from app.models.learning import LearningContent, LearningVideoCuration
from app.models.question import QualityStatus, Question, QuestionLabel


LOCAL_DEMO_CATALOG = [
    {
        "demo_id": "left-hand-rule",
        "title": "左手定则方向模型",
        "description": "用四指、掌心和拇指建立 B、I/v、F 的垂直关系",
        "kp_prefixes": ["x2c1s1k02", "x2c1s2k02", "x2c1s2k03"],
    },
    {
        "demo_id": "magnetic-force",
        "title": "安培力模型",
        "description": "看清 B、I、L 与安培力方向和大小的关系",
        "kp_prefixes": ["x2c1s1", "x2c1s2"],
    },
    {
        "demo_id": "lorentz-motion",
        "title": "带电粒子磁场运动",
        "description": "用半径、周期和速度方向理解洛伦兹力只改变方向",
        "kp_prefixes": ["x2c1s3k01", "x2c1s3k02", "x2c1s3k03", "x2c1s3k04", "x2c1s4"],
    },
    {
        "demo_id": "bounded-magnetic-field",
        "title": "有界磁场偏转模型",
        "description": "用圆心、半径、弦长和偏转角分析入射与出射",
        "kp_prefixes": ["x2c1s3k05"],
    },
    {
        "demo_id": "electromagnetic-induction",
        "title": "电磁感应导轨模型",
        "description": "把磁通量变化、感应电动势、电流和安培力连起来",
        "kp_prefixes": ["x2c2"],
    },
    {
        "demo_id": "ac-generator",
        "title": "正弦交变电流模型",
        "description": "观察线圈转动时磁通量与感应电动势的相位关系",
        "kp_prefixes": ["x2c3s1", "x2c3s2", "x2c3s3", "x2c3s4"],
    },
    {
        "demo_id": "lc-oscillation",
        "title": "LC 电磁振荡模型",
        "description": "观察电场能和磁场能的周期性交替转化",
        "kp_prefixes": ["x2c4"],
    },
    {
        "demo_id": "sensor-divider",
        "title": "传感器分压模型",
        "description": "把物理量变化转化为电阻变化，再转化为电压信号",
        "kp_prefixes": ["x2c5"],
    },
]

BACKEND_SIMULATION_CATALOG = [
    {
        "demo_id": "left_hand_rule",
        "title": "左手定则后端物理引擎",
        "description": "由后端计算 B、I/v、F 的方向关系，前端负责展示",
        "kp_prefixes": ["x2c1s1k02", "x2c1s2k02", "x2c1s2k03"],
    },
    {
        "demo_id": "bounded_magnetic_field",
        "title": "带电粒子有界磁场后端引擎",
        "description": "由后端计算半径、圆心、出射点与运动轨迹",
        "kp_prefixes": ["x2c1s3k05"],
    },
]


class AdminLearningResourceService:
    """Builds an admin-side inventory of student learning resources."""

    def __init__(self, db: AsyncSession, video_curations_path: str | Path | None = None):
        self.db = db
        self.video_curations_path = (
            Path(video_curations_path)
            if video_curations_path
            else Path(__file__).resolve().parents[1] / "seed" / "video_curations.json"
        )

    async def build_report(
        self,
        volume: str | None = None,
        chapter: str | None = None,
        section: str | None = None,
        kp_id: str | None = None,
    ) -> dict[str, Any]:
        kps = await self._load_knowledge_points(volume, chapter, section, kp_id)
        kp_ids = [kp.id for kp in kps]
        contents_by_kp = await self._load_contents(kp_ids)
        question_counts = await self._load_question_counts(kp_ids)
        curated_videos = self._load_curated_videos()
        db_curated_videos = await self._load_db_curated_videos(kp_ids)

        items = []
        for kp in kps:
            contents = self._latest_content_by_type(contents_by_kp.get(kp.id, []))
            curated_video_items = [
                *db_curated_videos.get(kp.id, []),
                *curated_videos.get(kp.id, []),
            ]
            local_demos = self._matching_catalog_items(kp.id, LOCAL_DEMO_CATALOG, "local")
            backend_simulations = self._matching_catalog_items(kp.id, BACKEND_SIMULATION_CATALOG, "backend")
            simulation_content = contents.get("simulation")
            has_simulation = bool(simulation_content or local_demos or backend_simulations)

            items.append({
                "kp_id": kp.id,
                "kp_name": kp.name,
                "volume": kp.volume,
                "chapter": kp.chapter,
                "section": kp.section,
                "question_count": question_counts.get(kp.id, 0),
                "contents": contents,
                "video": {
                    "curated_count": len(curated_video_items),
                    "top_title": curated_video_items[0].get("title") if curated_video_items else None,
                },
                "simulations": {
                    "learning_content": simulation_content,
                    "local_demos": local_demos,
                    "backend_simulations": backend_simulations,
                    "has_simulation": has_simulation,
                },
            })

        summary = {
            "kp_count": len(items),
            "card_count": sum(1 for item in items if item["contents"].get("card")),
            "video_count": sum(1 for item in items if item["video"]["curated_count"] > 0),
            "simulation_count": sum(1 for item in items if item["simulations"]["has_simulation"]),
        }
        summary.update({
            "missing_card_count": summary["kp_count"] - summary["card_count"],
            "missing_video_count": summary["kp_count"] - summary["video_count"],
            "missing_simulation_count": summary["kp_count"] - summary["simulation_count"],
        })

        return {"summary": summary, "items": items}

    async def _load_knowledge_points(
        self,
        volume: str | None,
        chapter: str | None,
        section: str | None,
        kp_id: str | None,
    ) -> list[KnowledgePoint]:
        query = select(KnowledgePoint)
        if kp_id:
            query = query.where(KnowledgePoint.id == kp_id)
        else:
            if volume:
                query = query.where(KnowledgePoint.volume == volume)
            if chapter:
                query = query.where(KnowledgePoint.chapter == chapter)
            if section:
                query = query.where(KnowledgePoint.section == section)
        query = query.order_by(
            KnowledgePoint.volume,
            KnowledgePoint.chapter,
            KnowledgePoint.section,
            KnowledgePoint.id,
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _load_contents(self, kp_ids: list[str]) -> dict[str, list[LearningContent]]:
        if not kp_ids:
            return {}
        result = await self.db.execute(
            select(LearningContent)
            .where(LearningContent.knowledge_point_id.in_(kp_ids))
            .order_by(
                LearningContent.knowledge_point_id,
                LearningContent.content_type,
                LearningContent.version.desc(),
            )
        )
        contents_by_kp: dict[str, list[LearningContent]] = defaultdict(list)
        for content in result.scalars().all():
            contents_by_kp[content.knowledge_point_id].append(content)
        return contents_by_kp

    async def _load_question_counts(self, kp_ids: list[str]) -> dict[str, int]:
        if not kp_ids:
            return {}
        result = await self.db.execute(
            select(QuestionLabel.label_id, func.count(func.distinct(Question.id)))
            .join(Question, Question.id == QuestionLabel.question_id)
            .where(
                QuestionLabel.label_type == "knowledge_point",
                QuestionLabel.label_id.in_(kp_ids),
                Question.quality_status != QualityStatus.retired,
            )
            .group_by(QuestionLabel.label_id)
        )
        return {str(kp_id): int(count) for kp_id, count in result.all()}

    def _latest_content_by_type(self, contents: list[LearningContent]) -> dict[str, dict[str, Any]]:
        latest: dict[str, LearningContent] = {}
        for content in contents:
            content_type = content.content_type.value
            existing = latest.get(content_type)
            if existing is None or content.version > existing.version:
                latest[content_type] = content
        return {
            content_type: self._content_summary(content)
            for content_type, content in latest.items()
        }

    def _content_summary(self, content: LearningContent) -> dict[str, Any]:
        return {
            "id": content.id,
            "content_type": content.content_type.value,
            "title": content.title,
            "source": content.source.value,
            "version": content.version,
            "created_at": content.created_at.isoformat() if content.created_at else None,
            "updated_at": content.updated_at.isoformat() if content.updated_at else None,
        }

    def _load_curated_videos(self) -> dict[str, list[dict[str, Any]]]:
        if not self.video_curations_path.exists():
            return {}
        try:
            data = json.loads(self.video_curations_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(data, dict):
            return {}
        return {
            str(kp_id): [item for item in items if isinstance(item, dict)]
            for kp_id, items in data.items()
            if isinstance(items, list)
        }

    async def _load_db_curated_videos(self, kp_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        if not kp_ids:
            return {}
        result = await self.db.execute(
            select(LearningVideoCuration)
            .where(
                LearningVideoCuration.knowledge_point_id.in_(kp_ids),
                LearningVideoCuration.enabled.is_(True),
            )
            .order_by(
                LearningVideoCuration.knowledge_point_id,
                LearningVideoCuration.video_type,
                LearningVideoCuration.priority,
                LearningVideoCuration.id,
            )
        )
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in result.scalars().all():
            grouped[item.knowledge_point_id].append({
                "id": item.id,
                "title": item.title,
                "video_type": item.video_type.value if hasattr(item.video_type, "value") else str(item.video_type),
                "url": item.url,
                "uploader": item.uploader,
                "priority": item.priority,
                "enabled": item.enabled,
            })
        return grouped

    def _matching_catalog_items(
        self,
        kp_id: str,
        catalog: list[dict[str, Any]],
        source: str,
    ) -> list[dict[str, str]]:
        return [
            {
                "demo_id": item["demo_id"],
                "title": item["title"],
                "description": item["description"],
                "source": source,
            }
            for item in catalog
            if any(kp_id.startswith(prefix) for prefix in item["kp_prefixes"])
        ]
