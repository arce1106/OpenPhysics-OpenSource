import threading

import pytest

from app.api.student.dependencies import maybe_enrich_rich_content


class _ThreadRecordingRenderer:
    def __init__(self):
        self.thread_id = None

    def enrich(self, payload):
        self.thread_id = threading.get_ident()
        payload["rendered"] = True
        return payload


@pytest.mark.asyncio
async def test_rich_content_enrichment_runs_off_the_event_loop_thread():
    renderer = _ThreadRecordingRenderer()
    event_loop_thread = threading.get_ident()
    payload = {}

    result = await maybe_enrich_rich_content(
        renderer,
        "enrich",
        payload,
        include_rendered=True,
    )

    assert result == {"rendered": True}
    assert renderer.thread_id != event_loop_thread
