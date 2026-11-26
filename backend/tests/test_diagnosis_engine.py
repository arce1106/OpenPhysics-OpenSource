"""Tests for DiagnosisEngine — misconception detection and intervention."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta


class TestDiagnosisEngine:
    @pytest.mark.asyncio
    async def test_direct_option_mapping(self):
        """When option has targets_misconception set, use it directly."""
        from app.services.diagnosis_engine import DiagnosisEngine

        db = AsyncMock()
        engine = DiagnosisEngine(db)

        q = MagicMock()
        opt = MagicMock()
        opt.label = "A"
        opt.targets_misconception = "misc_test"
        opt.text = "test option text"
        q.options = [opt]
        q.labels = []

        # Mock DB to return misconception
        mc = MagicMock()
        mc.id = "misc_test"
        mc.name = "测试误区"

        async def mock_get_mc(mc_id):
            return mc if mc_id == "misc_test" else None
        engine._get_misconception_by_id = AsyncMock(side_effect=mock_get_mc)

        results = await engine.diagnose(q, "A")
        assert len(results) >= 1
        assert results[0]["id"] == "misc_test"
        assert results[0]["source"] == "option"

    @pytest.mark.asyncio
    async def test_no_misconception_when_correct(self):
        """Diagnosis only triggers on wrong answers, but engine doesn't filter
        — it just looks at the selected option's targets_misconception."""
        from app.services.diagnosis_engine import DiagnosisEngine

        db = AsyncMock()
        engine = DiagnosisEngine(db)

        q = MagicMock()
        opt = MagicMock()
        opt.label = "B"
        opt.targets_misconception = None
        opt.text = "test"
        q.options = [opt]
        q.labels = []

        engine._get_confused_kp_ids = AsyncMock(return_value=set())

        results = await engine.diagnose(q, "B")
        assert results == []

    @pytest.mark.asyncio
    async def test_intervention_threshold(self):
        """Intervention triggered when misconception appears >= 3 times."""
        from app.services.diagnosis_engine import DiagnosisEngine, INTERVENTION_THRESHOLD

        db = AsyncMock()
        engine = DiagnosisEngine(db)

        # Mock answer history with 3 occurrences of same misconception
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [
            ["misc_test"],
            ["misc_test", "misc_other"],
            ["misc_test"],
        ]
        db.execute = AsyncMock(return_value=mock_result)

        async def mock_get_mc(mc_id):
            mc = MagicMock()
            mc.id = mc_id
            mc.name = f"Name_{mc_id}"
            return mc
        engine._get_misconception_by_id = AsyncMock(side_effect=mock_get_mc)

        result = await engine.should_intervene("student1")
        assert result is not None
        assert result["misconception_id"] == "misc_test"
        assert result["count"] >= INTERVENTION_THRESHOLD

    @pytest.mark.asyncio
    async def test_no_intervention_below_threshold(self):
        """No intervention when count < threshold."""
        from app.services.diagnosis_engine import DiagnosisEngine

        db = AsyncMock()
        engine = DiagnosisEngine(db)

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [
            ["misc_test"],
            ["misc_other"],
        ]
        db.execute = AsyncMock(return_value=mock_result)

        result = await engine.should_intervene("student1")
        assert result is None

    def test_keyword_match(self):
        from app.services.diagnosis_engine import DiagnosisEngine

        assert DiagnosisEngine._keyword_match(["速度", "矢量"], "速度是矢量，有方向")
        assert DiagnosisEngine._keyword_match(["速率"], "关于速率的问题")
        assert not DiagnosisEngine._keyword_match(["摩擦力"], "速度是矢量")
        assert not DiagnosisEngine._keyword_match([], "text")
        assert not DiagnosisEngine._keyword_match(["速度"], "")
