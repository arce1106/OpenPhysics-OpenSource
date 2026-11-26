"""Question video metadata and private, validated teacher uploads."""

import asyncio
import hashlib
import json
import math
import os
import tempfile
import uuid
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.question import Question
from app.models.question_video import QuestionVideo

MEDIA_DIR = Path(__file__).resolve().parents[2] / "static" / "uploads" / "question-videos"
MAX_UPLOAD_BYTES = 512 * 1024 * 1024


def video_summary(video: QuestionVideo) -> dict:
    """Safe metadata: never includes a private filename or playback URL."""
    return {"id": video.id, "title": video.title, "duration_seconds": video.duration_seconds}


def admin_video_summary(video: QuestionVideo) -> dict:
    return {**video_summary(video), "question_id": video.question_id, "status": video.status}


async def approved_videos(db: AsyncSession, question_ids: list[str]) -> dict[str, QuestionVideo]:
    if not question_ids:
        return {}
    rows = (await db.scalars(select(QuestionVideo).where(
        QuestionVideo.question_id.in_(set(question_ids)), QuestionVideo.status == "approved",
    ))).all()
    return {row.question_id: row for row in rows}


async def approved_video_summaries(db: AsyncSession, question_ids: list[str]) -> dict[str, dict]:
    return {qid: video_summary(video) for qid, video in (await approved_videos(db, question_ids)).items()}


async def all_video_summaries(db: AsyncSession, question_ids: list[str]) -> dict[str, dict]:
    if not question_ids:
        return {}
    rows = (await db.scalars(select(QuestionVideo).where(QuestionVideo.question_id.in_(set(question_ids))))).all()
    return {row.question_id: admin_video_summary(row) for row in rows}


async def probe_mp4(path: Path) -> int:
    """Check the actual container and cross-client codecs, not the supplied MIME type."""
    with path.open("rb") as handle:
        header = handle.read(32)
    if len(header) < 12 or header[4:8] != b"ftyp":
        raise ValueError("请选择有效的 MP4 视频文件")
    try:
        process = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe",
            "-show_streams", "-show_format", "-of", "json", str(path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        raise RuntimeError("视频检查服务暂不可用，请稍后重试") from None
    try:
        stdout, _stderr = await asyncio.wait_for(process.communicate(), timeout=30)
    except (TimeoutError, asyncio.CancelledError):
        process.kill()
        await process.wait()
        raise
    try:
        data = json.loads(stdout)
        streams = data.get("streams", [])
        video_streams = [s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")]
        duration = float(data.get("format", {}).get("duration", 0))
        if (process.returncode or len(video_streams) != 1 or not math.isfinite(duration)
                or duration <= 0 or "mp4" not in data.get("format", {}).get("format_name", "")):
            raise ValueError()
        video = video_streams[0]
        if video.get("codec_name") != "h264" or video.get("pix_fmt") not in {"yuv420p", "yuvj420p"}:
            raise ValueError("请导出 H.264 编码的 MP4 视频，以便网页和安卓播放")
        if any(s.get("codec_name") != "aac" for s in streams if s.get("codec_type") == "audio"):
            raise ValueError("请使用 AAC 音频的 MP4 视频，以便网页和安卓播放")
        if not video.get("width") or not video.get("height"):
            raise ValueError()
        return max(1, round(duration))
    except (ValueError, TypeError, KeyError) as error:
        raise ValueError(str(error) or "视频无法读取，请重新导出 MP4 后上传") from None


async def upload_video(db: AsyncSession, question_id: str, upload: UploadFile, title: str) -> QuestionVideo:
    """Validated uploads start as drafts; physical originals remain immutable."""
    # Lock the existing question as well as its optional video row, so two first
    # uploads cannot race to create the unique question-video association.
    if not await db.scalar(select(Question.id).where(Question.id == question_id).with_for_update()):
        raise LookupError("题目不存在")
    if Path(upload.filename or "").suffix.lower() != ".mp4":
        raise ValueError("请选择 MP4 视频")
    title = title.strip() or "本题视频讲解"
    if len(title) > 160:
        raise ValueError("视频标题不能超过 160 字")
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".upload-", suffix=".mp4", dir=MEDIA_DIR)
    path = Path(temporary)
    try:
        digest = hashlib.sha256()
        size = 0
        with os.fdopen(descriptor, "wb") as handle:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise ValueError("单个视频请控制在 512 MB 以内")
                digest.update(chunk)
                handle.write(chunk)
        duration = await probe_mp4(path)
        sha = digest.hexdigest()
        filename = f"question-video-{sha}.mp4"
        destination = MEDIA_DIR / filename
        if not destination.exists():
            path.replace(destination)
        video = await db.scalar(select(QuestionVideo).where(
            QuestionVideo.question_id == question_id,
        ).with_for_update())
        if video is None:
            video = QuestionVideo(id=str(uuid.uuid4()), question_id=question_id)
            db.add(video)
        video.title, video.filename, video.sha256 = title, filename, sha
        video.duration_seconds, video.status = duration, "draft"
        await db.commit()
        await db.refresh(video)
        return video
    finally:
        path.unlink(missing_ok=True)
        await upload.close()


async def set_video_status(db: AsyncSession, question_id: str, status: str) -> QuestionVideo:
    if status not in {"approved", "draft"}:
        raise ValueError("请选择发布或暂不发布")
    video = await db.scalar(select(QuestionVideo).where(QuestionVideo.question_id == question_id).with_for_update())
    if video is None:
        raise LookupError("题目尚未配视频")
    if status == "approved" and not (MEDIA_DIR / video.filename).is_file():
        raise ValueError("视频文件暂不可用，请重新上传")
    video.status = status
    await db.commit()
    await db.refresh(video)
    return video
