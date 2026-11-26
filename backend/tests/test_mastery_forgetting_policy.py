from datetime import datetime, timedelta, timezone

from app.services.student_service import StudentService


def test_effective_mastery_does_not_decay_while_forgetting_is_disabled(monkeypatch):
    from app.services import student_service

    monkeypatch.setattr(student_service.settings, "mastery_forgetting_enabled", False)
    mastery = StudentService.get_effective_mastery(
        0.8,
        datetime.now(timezone.utc) - timedelta(days=30),
    )

    assert mastery == 0.8


def test_effective_mastery_can_be_enabled_for_future_calibration(monkeypatch):
    from app.services import student_service

    monkeypatch.setattr(student_service.settings, "mastery_forgetting_enabled", True)
    mastery = StudentService.get_effective_mastery(
        0.8,
        datetime.now(timezone.utc) - timedelta(days=30),
    )

    assert mastery < 0.8
