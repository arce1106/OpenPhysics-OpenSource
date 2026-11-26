from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock

import pytest

from app.api.student.growth import get_growth_report
from app.services import growth_report_service as reports


@pytest.mark.asyncio
async def test_live_growth_preview_recounts_answers_without_saving(monkeypatch):
    class Clock:
        @staticmethod
        def now(tz):
            return datetime(2026, 10, 16, 13, 45, tzinfo=timezone.utc)

    monkeypatch.setattr(reports, "datetime", Clock)
    db = Mock()
    results = [Mock() for _ in range(6)]
    for result, value in zip(results, [16, 10, 2, 30]):
        result.scalar.return_value = value
    for result in results[4:]:
        result.scalars.return_value.all.return_value = []
    db.execute = AsyncMock(side_effect=results)
    db.flush = AsyncMock()

    report = await reports.GrowthReportService(db).generate_weekly_report("learner", persist=False)

    assert report["metrics"]["total_answers"] == 16
    assert report["metrics"]["correct_answers"] == 10
    assert "16 道题" in report["summary"]
    assert report["start_date"] == "2026-10-09"
    assert report["end_date"] == "2026-10-16"
    # Match the history page's date filter, including the first morning in the window.
    first_query = db.execute.call_args_list[0].args[0].compile().params
    assert "learner" in first_query.values()
    assert datetime(2026, 10, 9, tzinfo=timezone.utc) in first_query.values()
    db.add.assert_not_called()
    db.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_existing_growth_route_keeps_saved_report_contract():
    service = Mock()
    service.get_latest_report = AsyncMock(return_value={"id": "saved", "metrics": {"total_answers": 11}})
    service.generate_weekly_report = AsyncMock()
    response = await get_growth_report(student_id="learner", report_svc=service)
    assert response["report"]["id"] == "saved"
    service.generate_weekly_report.assert_not_awaited()


@pytest.mark.asyncio
async def test_refresh_route_reads_current_report_without_writing():
    service = Mock()
    service.get_latest_report = AsyncMock()
    service.generate_weekly_report = AsyncMock(return_value={"id": "current-week", "metrics": {"total_answers": 16}})
    response = await get_growth_report(student_id="learner", report_svc=service, refresh=True)
    assert response["report"]["metrics"]["total_answers"] == 16
    service.generate_weekly_report.assert_awaited_once_with("learner", persist=False)
    service.get_latest_report.assert_not_awaited()
