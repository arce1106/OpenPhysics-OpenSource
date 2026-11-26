from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning import LearningVideoCuration, VideoCurationType


class LearningVideoCurationService:
    """Manage teacher-curated Bilibili videos for knowledge points."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_for_kp(self, kp_id: str) -> list[LearningVideoCuration]:
        result = await self.db.execute(
            select(LearningVideoCuration)
            .where(LearningVideoCuration.knowledge_point_id == kp_id)
            .order_by(
                LearningVideoCuration.video_type,
                LearningVideoCuration.priority,
                LearningVideoCuration.id,
            )
        )
        return list(result.scalars().all())

    async def create(self, data: dict) -> LearningVideoCuration:
        item = LearningVideoCuration(**self._clean_data(data))
        self.db.add(item)
        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def update(self, item_id: int, data: dict) -> LearningVideoCuration | None:
        item = await self.get(item_id)
        if not item:
            return None
        for key, value in self._clean_data(data, partial=True).items():
            setattr(item, key, value)
        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def delete(self, item_id: int) -> bool:
        item = await self.get(item_id)
        if not item:
            return False
        await self.db.delete(item)
        await self.db.commit()
        return True

    async def get(self, item_id: int) -> LearningVideoCuration | None:
        result = await self.db.execute(
            select(LearningVideoCuration).where(LearningVideoCuration.id == item_id)
        )
        return result.scalar_one_or_none()

    async def recommendation_maps(self, kp_id: str) -> dict[str, dict[str, list[dict]]]:
        rows = [
            item for item in await self.list_for_kp(kp_id)
            if item.enabled and self._is_bilibili_video(item.url)
        ]
        lecture = [self.to_recommendation_item(item) for item in rows if item.video_type == VideoCurationType.lecture]
        experiment = [self.to_recommendation_item(item) for item in rows if item.video_type == VideoCurationType.experiment]
        return {
            "lecture": {kp_id: lecture} if lecture else {},
            "experiment": {kp_id: experiment} if experiment else {},
        }

    @staticmethod
    def to_dict(item: LearningVideoCuration) -> dict:
        return {
            "id": item.id,
            "knowledge_point_id": item.knowledge_point_id,
            "video_type": item.video_type.value if hasattr(item.video_type, "value") else str(item.video_type),
            "title": item.title,
            "url": item.url,
            "uploader": item.uploader,
            "duration": item.duration,
            "cover_url": item.cover_url,
            "reason": item.reason,
            "match_focus": item.match_focus,
            "priority": item.priority,
            "enabled": item.enabled,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        }

    @classmethod
    def to_recommendation_item(cls, item: LearningVideoCuration) -> dict:
        video_type = item.video_type.value if hasattr(item.video_type, "value") else str(item.video_type)
        is_experiment = video_type == VideoCurationType.experiment.value
        return {
            "id": f"db-video-{item.id}",
            "title": item.title,
            "url": item.url,
            "uploader": item.uploader,
            "duration": item.duration,
            "cover_url": item.cover_url,
            "source": "teacher_experiment_curated_db" if is_experiment else "teacher_curated_db",
            "category": "演示实验" if is_experiment else "教师精选",
            "play_count": None,
            "reason": item.reason or ("教师精选实验视频。" if is_experiment else "教师精选讲解视频。"),
            "match_focus": item.match_focus or "教师精选",
        }

    @staticmethod
    def _clean_data(data: dict, partial: bool = False) -> dict:
        allowed = {
            "knowledge_point_id",
            "video_type",
            "title",
            "url",
            "uploader",
            "duration",
            "cover_url",
            "reason",
            "match_focus",
            "priority",
            "enabled",
        }
        cleaned = {key: value for key, value in data.items() if key in allowed}
        if "video_type" in cleaned:
            cleaned["video_type"] = VideoCurationType(cleaned["video_type"])
        if not partial:
            cleaned.setdefault("priority", 100)
            cleaned.setdefault("enabled", True)
        return cleaned

    @staticmethod
    def _is_bilibili_video(url: str | None) -> bool:
        return bool(url and "bilibili.com/video" in url)
