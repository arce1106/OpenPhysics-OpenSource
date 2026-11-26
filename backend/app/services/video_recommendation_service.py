import json
from pathlib import Path
from urllib.parse import quote

import httpx


class VideoRecommendationService:
    """Recommend Bilibili learning videos for a physics knowledge point.

    The service works without a search provider by returning precise Bilibili
    search links. If a search provider is configured later, the same endpoint can
    return ranked video cards without changing the student UI.
    """

    def __init__(
        self,
        search_api_key: str = "",
        search_api_url: str = "",
        curated_videos: dict[str, list[dict]] | None = None,
        curated_experiment_videos: dict[str, list[dict]] | None = None,
        curated_videos_path: str | Path | None = None,
        curated_experiment_videos_path: str | Path | None = None,
        source_preferences_path: str | Path | None = None,
    ):
        self.search_api_key = search_api_key
        self.search_api_url = search_api_url
        self.curated_videos = curated_videos if curated_videos is not None else self._load_curated_videos(curated_videos_path)
        self.curated_experiment_videos = (
            curated_experiment_videos
            if curated_experiment_videos is not None
            else self._load_curated_experiment_videos(curated_experiment_videos_path)
        )
        self.source_preferences = self._load_source_preferences(source_preferences_path)

    DEMONSTRATION_KEYWORDS: tuple[tuple[str, str], ...] = (
        ("安培力", "安培力"),
        ("洛伦兹力", "洛伦兹力演示仪"),
        ("左手定则", "左手定则"),
        ("磁场", "磁场"),
        ("电磁感应", "电磁感应"),
        ("楞次定律", "楞次定律"),
        ("法拉第电磁感应定律", "法拉第电磁感应定律"),
        ("自感", "自感"),
        ("互感", "互感"),
        ("涡流", "涡流"),
        ("电磁阻尼", "电磁阻尼"),
        ("电磁驱动", "电磁驱动"),
        ("变压器", "变压器"),
        ("交流电", "交流电"),
        ("电场", "电场"),
    )

    def build_query(
        self,
        kp_name: str,
        volume: str | None = None,
        chapter: str | None = None,
        section: str | None = None,
    ) -> str:
        parts = [
            "site:bilibili.com/video",
            "高中物理",
            self._volume_query_text(volume),
            self._compact(chapter or ""),
            self._compact(section or ""),
            self._compact(kp_name),
        ]
        deduped = []
        for part in parts:
            if part and part not in deduped:
                deduped.append(part)
        return " ".join(deduped)

    def fallback_recommendations(
        self,
        kp_id: str,
        kp_name: str,
        volume: str | None = None,
        chapter: str | None = None,
        section: str | None = None,
        curated_videos: dict[str, list[dict]] | None = None,
    ) -> list[dict]:
        curated = self._curated_items(kp_id, curated_videos)
        if curated:
            return curated[:1]
        volume_alias = self._volume_alias(self._compact(volume or ""))
        base = self._compact(kp_name)
        preferred_source = self._preferred_source(kp_name, chapter, section)
        query = " ".join(part for part in [preferred_source["search_term"], "高中物理", volume_alias, base] if part)
        return [{
            "id": f"{kp_id}-bilibili-search-best",
            "title": f"B站搜索：{base}",
            "url": self._bilibili_search_url(query),
            "uploader": preferred_source["name"],
            "duration": None,
            "cover_url": None,
            "source": "bilibili_search",
            "category": preferred_source["category"],
            "play_count": None,
            "reason": "最相关讲解",
            "match_focus": query,
        }]

    def demonstration_recommendation(
        self,
        kp_id: str,
        kp_name: str,
        volume: str | None = None,
        chapter: str | None = None,
        section: str | None = None,
        curated_experiment_videos: dict[str, list[dict]] | None = None,
    ) -> dict | None:
        items = self.demonstration_recommendations(
            kp_id, kp_name, volume, chapter, section, curated_experiment_videos
        )
        return items[0] if items else None

    def demonstration_recommendations(
        self,
        kp_id: str,
        kp_name: str,
        volume: str | None = None,
        chapter: str | None = None,
        section: str | None = None,
        curated_experiment_videos: dict[str, list[dict]] | None = None,
    ) -> list[dict]:
        curated = self._curated_experiment_items(kp_id, curated_experiment_videos)
        if curated:
            return curated
        focus = self._demonstration_focus(kp_name, chapter, section)
        if not focus:
            return []
        volume_alias = self._volume_alias(self._compact(volume or ""))
        source = self._demonstration_source()
        query = " ".join(part for part in [
            source["search_term"],
            "高中物理",
            volume_alias,
            focus,
            "演示实验",
        ] if part)
        return [{
            "id": f"{kp_id}-bilibili-demo-search",
            "title": f"演示实验：{focus}演示实验",
            "url": self._bilibili_search_url(query),
            "uploader": source["name"],
            "duration": None,
            "cover_url": None,
            "source": "bilibili_demo_search",
            "category": "演示实验",
            "play_count": None,
            "reason": "通过实验现象帮助学生先建立直观图像，再回到公式和模型。",
            "match_focus": query,
        }]

    async def recommend(
        self,
        kp_id: str,
        kp_name: str,
        volume: str | None = None,
        chapter: str | None = None,
        section: str | None = None,
        limit: int = 5,
        curated_videos: dict[str, list[dict]] | None = None,
        curated_experiment_videos: dict[str, list[dict]] | None = None,
    ) -> dict:
        query = self.build_query(kp_name, volume, chapter, section)
        curated = self._curated_items(kp_id, curated_videos)
        fallback = self.fallback_recommendations(kp_id, kp_name, volume, chapter, section, curated_videos)
        demonstrations = self.demonstration_recommendations(
            kp_id, kp_name, volume, chapter, section, curated_experiment_videos
        )
        demonstration = demonstrations[0] if demonstrations else None
        if not self.search_api_key or not self.search_api_url:
            return {
                "query": query,
                "items": fallback[:limit],
                "experiment": demonstration,
                "experiments": demonstrations,
                "fallback": True,
            }

        try:
            items = await self._search(query, limit)
        except Exception:
            items = []
        if not items:
            return {
                "query": query,
                "items": fallback[:limit],
                "experiment": demonstration,
                "experiments": demonstrations,
                "fallback": True,
            }
        return {
            "query": query,
            "items": (curated + items)[:1],
            "experiment": demonstration,
            "experiments": demonstrations,
            "fallback": False,
        }

    async def _search(self, query: str, limit: int) -> list[dict]:
        headers = {"Authorization": f"Bearer {self.search_api_key}"}
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                self.search_api_url,
                headers=headers,
                json={"q": query, "num": limit},
            )
            response.raise_for_status()
            data = response.json()

        raw_items = data.get("organic") or data.get("results") or data.get("items") or []
        items = []
        for idx, item in enumerate(raw_items):
            url = item.get("link") or item.get("url") or ""
            if "bilibili.com/video" not in url:
                continue
            title = self._compact(item.get("title") or "B站学习视频")
            snippet = self._compact(item.get("snippet") or item.get("description") or "")
            play_count = item.get("play_count") or item.get("views")
            items.append({
                "id": f"bilibili-result-{idx + 1}",
                "title": title,
                "url": url,
                "uploader": item.get("source") or item.get("uploader"),
                "duration": item.get("duration"),
                "cover_url": item.get("thumbnail") or item.get("cover_url"),
                "source": "bilibili",
                "category": "高播放讲解" if play_count else "相关讲解",
                "play_count": play_count,
                "reason": snippet[:120] or "搜索结果与当前知识点相关。",
                "match_focus": query,
            })
        return items

    def _bilibili_search_url(self, query: str) -> str:
        return f"https://search.bilibili.com/all?keyword={quote(' '.join(query.split()))}"

    def _compact(self, text: str) -> str:
        return " ".join(str(text).replace("第", "第").split())

    def _volume_alias(self, volume: str) -> str:
        compact = volume.replace(" ", "")
        aliases = {
            "必修第一册": "必修一",
            "必修第二册": "必修二",
            "必修第三册": "必修三",
            "选择性必修第一册": "选择性必修一",
            "选择性必修第二册": "选择性必修二",
            "选择性必修第三册": "选择性必修三",
        }
        return aliases.get(compact, volume)

    def _volume_query_text(self, volume: str | None) -> str:
        volume_text = self._compact(volume or "")
        alias = self._volume_alias(volume_text)
        return f"{volume_text} {alias}" if volume_text and alias != volume_text else volume_text

    def _preferred_source(self, kp_name: str, chapter: str | None, section: str | None) -> dict[str, str]:
        text = " ".join(self._compact(part or "") for part in [kp_name, chapter, section])
        if any(keyword in text for keyword in ["实验", "探究", "测定", "验证"]):
            return self.source_preferences.get("experiment") or {
                "name": "物理实验",
                "search_term": "物理实验",
                "category": "实验优先",
            }
        return self.source_preferences.get("knowledge") or {
            "name": "物理讲解",
            "search_term": "物理讲解",
            "category": "最相关讲解",
        }

    def _demonstration_source(self) -> dict[str, str]:
        experiment = self.source_preferences.get("experiment") or {}
        for source in experiment.get("backup_sources") or []:
            if source.get("name") == "物理演示":
                return {
                    "name": source.get("name") or "物理演示",
                    "search_term": source.get("search_term") or "物理演示",
                    "category": "演示实验",
                }
        return {
            "name": "物理演示",
            "search_term": "物理演示",
            "category": "演示实验",
        }

    def _demonstration_focus(self, kp_name: str, chapter: str | None, section: str | None) -> str | None:
        text = " ".join(self._compact(part or "") for part in [kp_name, chapter, section])
        for keyword, focus in self.DEMONSTRATION_KEYWORDS:
            if keyword in text:
                return focus
        if any(keyword in text for keyword in ["实验", "演示仪", "观察", "验证"]):
            return self._compact(kp_name)
        return None

    def _load_source_preferences(self, source_preferences_path: str | Path | None) -> dict[str, dict]:
        if not source_preferences_path:
            return {}
        path = Path(source_preferences_path)
        if not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(data, dict):
            return {}
        return {
            key: value
            for key, value in data.items()
            if key in {"knowledge", "experiment"} and isinstance(value, dict)
        }

    def _load_curated_videos(self, curated_videos_path: str | Path | None) -> dict[str, list[dict]]:
        if not curated_videos_path:
            return {}
        path = Path(curated_videos_path)
        return self._load_curated_video_file(path)

    def _load_curated_experiment_videos(self, curated_experiment_videos_path: str | Path | None) -> dict[str, list[dict]]:
        if not curated_experiment_videos_path:
            return {}
        path = Path(curated_experiment_videos_path)
        return self._load_curated_video_file(path)

    def _load_curated_video_file(self, path: Path) -> dict[str, list[dict]]:
        if not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(data, dict):
            return {}
        return {
            str(kp_id): [item for item in items if isinstance(item, dict)]
            for kp_id, items in data.items()
            if isinstance(items, list)
        }

    def _curated_experiment_items(self, kp_id: str, curated_experiment_videos: dict[str, list[dict]] | None = None) -> list[dict]:
        source_items = curated_experiment_videos if curated_experiment_videos is not None else self.curated_experiment_videos
        results = []
        for idx, item in enumerate(source_items.get(kp_id, [])):
            url = self._compact(item.get("url") or "")
            if "bilibili.com/video" not in url:
                continue
            results.append({
                "id": item.get("id") or f"{kp_id}-teacher-experiment-{idx + 1}",
                "title": self._compact(item.get("title") or "教师精选实验视频"),
                "url": url,
                "uploader": item.get("uploader") or "物理演示",
                "duration": item.get("duration"),
                "cover_url": item.get("cover_url"),
                "source": "teacher_experiment_curated",
                "category": item.get("category") or "演示实验",
                "play_count": item.get("play_count"),
                "reason": item.get("reason") or "用真实实验现象帮助学生建立物理图像。",
                "match_focus": item.get("match_focus") or "教师精选实验",
            })
        return results

    def _curated_items(self, kp_id: str, curated_videos: dict[str, list[dict]] | None = None) -> list[dict]:
        items = []
        source_items = curated_videos if curated_videos is not None else self.curated_videos
        for idx, item in enumerate(source_items.get(kp_id, [])):
            url = self._compact(item.get("url") or "")
            if "bilibili.com/video" not in url:
                continue
            items.append({
                "id": item.get("id") or f"{kp_id}-teacher-curated-{idx + 1}",
                "title": self._compact(item.get("title") or "教师精选 B站讲解"),
                "url": url,
                "uploader": item.get("uploader"),
                "duration": item.get("duration"),
                "cover_url": item.get("cover_url"),
                "source": item.get("source") or "teacher_curated",
                "category": item.get("category") or "教师精选",
                "play_count": item.get("play_count"),
                "reason": item.get("reason") or "教师精选视频，优先推荐给当前知识点。",
                "match_focus": item.get("match_focus") or "教师精选",
            })
        return items
