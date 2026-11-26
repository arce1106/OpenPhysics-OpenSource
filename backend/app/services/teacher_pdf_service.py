"""Download the same teacher paper the browser prints, with vector text and formulas.

The renderer receives an already-authorized snapshot, never a teacher token or
user-supplied HTML/URL. Its isolated browser can only fetch this Web origin's
assets; API calls and off-origin requests are blocked.
"""
import asyncio
import json
import logging
import shutil
from urllib.parse import urlsplit

from fastapi.encoders import jsonable_encoder

from app.core.config import settings
from app.services.teacher_service import TeacherServiceError

logger = logging.getLogger(__name__)
_slots = asyncio.Semaphore(2)


def allowed_asset(url: str, frontend_url: str, method: str) -> bool:
    target, origin = urlsplit(url), urlsplit(frontend_url)
    return (
        method == "GET"
        and target.scheme in ("http", "https")
        and (target.scheme, target.netloc) == (origin.scheme, origin.netloc)
        and not target.path.startswith("/api/")
    )


async def render_pdf(snapshot: dict) -> bytes:
    try:
        from playwright.async_api import Error as PlaywrightError, async_playwright
    except ImportError as exc:
        raise TeacherServiceError(503, "PDF 下载服务尚未就绪，请稍后重试；也可使用打印") from exc
    executable = shutil.which("chromium") or shutil.which("chromium-browser")
    if not executable:
        raise TeacherServiceError(503, "PDF 下载服务尚未就绪，请稍后重试；也可使用打印")
    try:
        await asyncio.wait_for(_slots.acquire(), timeout=10)
    except TimeoutError as exc:
        raise TeacherServiceError(503, "PDF 正在生成中，请稍后重试") from exc
    try:
        async with asyncio.timeout(90):
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(executable_path=executable)
                try:
                    context = await browser.new_context(viewport={"width": 1100, "height": 900}, service_workers="block")

                    async def guard(route):
                        if allowed_asset(route.request.url, settings.teacher_pdf_frontend_url, route.request.method):
                            await route.continue_()
                        else:
                            await route.abort()

                    await context.route("**/*", guard)
                    page = await context.new_page()
                    # JSON is injected directly into the isolated runtime, not interpolated in HTML.
                    await page.add_init_script("window.__OPENPHYSICS_PRINT__ = " + json.dumps(jsonable_encoder(snapshot)))
                    await page.emulate_media(media="print")
                    response = await page.goto(settings.teacher_pdf_frontend_url, wait_until="domcontentloaded", timeout=30000)
                    if response is None or not response.ok:
                        raise TeacherServiceError(503, "PDF 下载服务暂时不可用，请稍后重试；也可使用打印")
                    await page.locator('.print-paper[data-pdf-ready="true"]').wait_for(timeout=45000)
                    broken = await page.locator(".print-sheet img").evaluate_all(
                        "images => images.some(image => !image.complete || image.naturalWidth === 0)"
                    )
                    if broken:
                        raise TeacherServiceError(502, "题图未能完整加载，PDF 未生成，请稍后重试")
                    return await page.pdf(format="A4", print_background=True, prefer_css_page_size=True)
                finally:
                    await browser.close()
    except (PlaywrightError, TimeoutError) as exc:
        logger.warning("Teacher PDF rendering failed: %s", exc)
        raise TeacherServiceError(503, "PDF 生成失败，请稍后重试；也可使用打印") from exc
    finally:
        _slots.release()
