package cn.openphysics.androidapp.data.api

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImprovementParsersTest {
    @Test
    fun `parses scope diagnostic result and improvement plan`() {
        val result = ImprovementParsers.parseScopeDiagnosticResult(scopeResultJson())
        val plan = ImprovementParsers.parseImprovementPlan(planJson())

        assertEquals("attempt-1", result.diagnosticAttemptId)
        assertEquals("chapter", result.scopeType)
        assertEquals("第二章 电磁感应", result.scopeId)
        assertEquals(1, result.weakKpIds.size)
        assertEquals("kp-lenz", result.kpResults.first().kpId)
        assertTrue(result.kpResults.first().isWeak)

        assertEquals("plan-1", plan.id)
        assertEquals("ready_for_retest", plan.status)
        assertEquals("task-1", plan.currentTaskId)
        assertEquals(2, plan.tasks.size)
        assertEquals("楞次定律", plan.tasks.first().kpName)
        assertEquals("practiced", plan.tasks.first().status)
        assertEquals(1, plan.weakCount)
    }

    @Test
    fun `parses retest session result and report`() {
        val session = ImprovementParsers.parseImprovementRetestSession(
            JSONObject()
                .put("attempt_id", "retest-1")
                .put("plan", planJson())
                .put(
                    "session",
                    JSONObject()
                        .put("session_type", "improvement_retest")
                        .put("session_objective", "阶段复测")
                        .put("questions", JSONArray().put(questionJson("q-retest"))),
                ),
        )
        val result = ImprovementParsers.parseImprovementRetestResult(retestResultJson())
        val report = ImprovementParsers.parseImprovementReport(reportJson())

        assertEquals("retest-1", session.attemptId)
        assertEquals("阶段复测", session.session.objective)
        assertEquals("q-retest", session.session.questions.first().id)
        assertEquals("A", session.session.questions.first().correctAnswer)
        assertEquals("按右手定则判断。", session.session.questions.first().explanation)

        assertEquals(1, result.passedCount)
        assertEquals(1, result.needsRetestCount)
        assertFalse(result.plan.isCompleted())
        assertEquals("仍需巩固", result.taskResults.first().feedback)

        assertEquals("plan-1", report.summary.planId)
        assertEquals(2, report.summary.taskCount)
        assertEquals("检测准确率 50%", report.summaryLabel())
        assertEquals("优势保持稳定", report.strengths.first())
        assertEquals("继续补弱楞次定律", report.nextActions.first())
        assertEquals("retest-1", report.retestAttempts.first().attemptId)
        assertEquals(2, report.retestAttempts.first().passedCount)
    }

    @Test
    fun `parses reinforcement histories and learning trace`() {
        val reports = ImprovementParsers.parseImprovementReportList(
            JSONObject()
                .put("total", 1)
                .put("limit", 10)
                .put("offset", 0)
                .put(
                    "items",
                    JSONArray().put(
                        JSONObject()
                            .put("plan_id", "plan-1")
                            .put("scope_type", "chapter")
                            .put("scope_id", "第二章 电磁感应")
                            .put("scope_name", "第二章 电磁感应")
                            .put("completed_at", "2026-07-02T12:00:00Z")
                            .put("summary_label", "本章闭环已完成")
                            .put("highlight", "复测正确率 80%")
                            .put("diagnostic_correct_count", 1)
                            .put("diagnostic_total_count", 2)
                            .put("task_count", 2)
                            .put("passed_task_count", 2)
                            .put("latest_retest_accuracy", 0.8),
                    ),
                ),
        )
        val diagnostics = ImprovementParsers.parseScopeDiagnosticAttemptList(
            JSONObject()
                .put("total", 1)
                .put("limit", 10)
                .put("offset", 0)
                .put(
                    "items",
                    JSONArray().put(
                        JSONObject()
                            .put("attempt_id", "attempt-1")
                            .put("scope_type", "chapter")
                            .put("scope_id", "第二章 电磁感应")
                            .put("scope_name", "第二章 电磁感应")
                            .put("diagnostic_type", "scope")
                            .put("created_at", "2026-07-02T10:00:00Z")
                            .put("submitted_at", "2026-07-02T10:05:00Z")
                            .put("correct_count", 1)
                            .put("total_count", 2)
                            .put("weak_count", 1)
                            .put("feedback", "建议先补弱。")
                            .put("linked_plan_id", "plan-1")
                            .put("linked_plan_status", "completed")
                            .put("linked_report_available", true),
                    ),
                ),
        )
        val trace = ImprovementParsers.parseLearningTrace(
            JSONObject()
                .put("total", 1)
                .put("limit", 20)
                .put("offset", 0)
                .put(
                    "items",
                    JSONArray().put(
                        JSONObject()
                            .put("id", "trace-1")
                            .put("event_type", "improvement_completed")
                            .put("event_time", "2026-07-02T12:00:00Z")
                            .put("student_id", "student-a")
                            .put("scope_type", "chapter")
                            .put("scope_id", "第二章 电磁感应")
                            .put("scope_name", "第二章 电磁感应")
                            .put("title", "完成提升闭环")
                            .put("description", "完成阶段复测并生成报告")
                            .put("plan_id", "plan-1")
                            .put("status_label", "已完成")
                            .put("primary_action", "view_report")
                            .put("report_available", true)
                            .put("metadata", JSONObject().put("source", "test")),
                    ),
                ),
        )

        assertEquals(1, reports.total)
        assertEquals("plan-1", reports.items.first().planId)
        assertEquals("复测正确率 80%", reports.items.first().highlight)
        assertEquals(0.8, reports.items.first().latestRetestAccuracy ?: 0.0, 0.001)

        assertEquals("attempt-1", diagnostics.items.first().attemptId)
        assertEquals("plan-1", diagnostics.items.first().linkedPlanId)
        assertTrue(diagnostics.items.first().linkedReportAvailable)

        assertEquals("trace-1", trace.items.first().id)
        assertEquals("view_report", trace.items.first().primaryAction)
        assertEquals("plan-1", trace.items.first().planId)
        assertTrue(trace.items.first().reportAvailable)
    }

    @Test
    fun `parses scope diagnostic attempt detail`() {
        val detail = ImprovementParsers.parseScopeDiagnosticAttemptDetail(
            JSONObject()
                .put("attempt_id", "attempt-1")
                .put("student_id", "student-a")
                .put("scope_type", "chapter")
                .put("scope_id", "第二章 电磁感应")
                .put("scope_name", "第二章 电磁感应")
                .put("diagnostic_type", "scope")
                .put("status", "submitted")
                .put("created_at", "2026-07-02T10:00:00Z")
                .put("submitted_at", "2026-07-02T10:05:00Z")
                .put("question_ids", JSONArray().put("q1").put("q2"))
                .put("answer_ids", JSONArray().put(101).put("102"))
                .put("correct_count", 1)
                .put("total_count", 2)
                .put("weak_count", 1)
                .put("weak_kp_ids", JSONArray().put("kp-lenz"))
                .put("recommendation", "practice")
                .put("feedback", "建议先补弱。")
                .put("kp_results", scopeResultJson().getJSONArray("kp_results"))
                .put("linked_plan_id", "plan-1")
                .put("linked_plan_status", "completed")
                .put("linked_report_available", true),
        )

        assertEquals("attempt-1", detail.attemptId)
        assertEquals("student-a", detail.studentId)
        assertEquals(2, detail.questionIds.size)
        assertEquals(2, detail.answerIds.size)
        assertEquals("kp-lenz", detail.weakKpIds.first())
        assertEquals("楞次定律", detail.kpResults.first().kpName)
        assertEquals("plan-1", detail.linkedPlanId)
        assertTrue(detail.linkedReportAvailable)
    }

    private fun scopeResultJson(): JSONObject {
        return JSONObject()
            .put("diagnostic_attempt_id", "attempt-1")
            .put("scope_type", "chapter")
            .put("scope_id", "第二章 电磁感应")
            .put("scope_name", "第二章 电磁感应")
            .put(
                "kp_results",
                JSONArray()
                    .put(
                        JSONObject()
                            .put("id", "row-1")
                            .put("kp_id", "kp-lenz")
                            .put("kp_name", "楞次定律")
                            .put("group_name", "感应电流方向")
                            .put("correct_count", 1)
                            .put("total_count", 2)
                            .put("mastery_before", 0.2)
                            .put("mastery_after", 0.45)
                            .put("is_weak", true),
                    ),
            )
            .put("correct_count", 1)
            .put("total_count", 2)
            .put("weak_kp_ids", JSONArray().put("kp-lenz"))
            .put("recommendation", "practice")
            .put("feedback", "建议先补弱。")
    }

    private fun planJson(): JSONObject {
        return JSONObject()
            .put("id", "plan-1")
            .put("student_id", "student-a")
            .put("diagnostic_attempt_id", "attempt-1")
            .put("scope_type", "chapter")
            .put("scope_id", "第二章 电磁感应")
            .put("scope_name", "第二章 电磁感应")
            .put("created_at", "2026-07-02T10:00:00Z")
            .put("updated_at", "2026-07-02T10:10:00Z")
            .put("completed_at", JSONObject.NULL)
            .put("correct_count", 1)
            .put("total_count", 2)
            .put("weak_count", 1)
            .put("status", "ready_for_retest")
            .put("current_task_id", "task-1")
            .put("source_result", scopeResultJson())
            .put(
                "tasks",
                JSONArray()
                    .put(taskJson("task-1", "kp-lenz", "楞次定律", "practiced", true))
                    .put(taskJson("task-2", "kp-flux", "磁通量", "passed", false)),
            )
    }

    private fun taskJson(id: String, kpId: String, kpName: String, status: String, weak: Boolean): JSONObject {
        return JSONObject()
            .put("id", id)
            .put("plan_id", "plan-1")
            .put("student_id", "student-a")
            .put("kp_id", kpId)
            .put("kp_name", kpName)
            .put("group_name", "感应电流方向")
            .put("correct_count", if (weak) 1 else 2)
            .put("total_count", 2)
            .put("mastery_before", 0.2)
            .put("mastery_after", if (weak) 0.45 else 0.8)
            .put("is_weak", weak)
            .put("priority", if (weak) 1 else 2)
            .put("status", status)
            .put("recommended_action", "practice")
            .put("reason", "检测暴露不稳定")
    }

    private fun retestResultJson(): JSONObject {
        return JSONObject()
            .put("attempt_id", "retest-1")
            .put("plan", planJson().put("status", "needs_retest"))
            .put("correct_count", 1)
            .put("total_count", 2)
            .put("passed_count", 1)
            .put("needs_retest_count", 1)
            .put(
                "task_results",
                JSONArray()
                    .put(
                        JSONObject()
                            .put("task_id", "task-1")
                            .put("kp_id", "kp-lenz")
                            .put("kp_name", "楞次定律")
                            .put("correct_count", 0)
                            .put("total_count", 1)
                            .put("mastery_before", 0.45)
                            .put("mastery_after", 0.5)
                            .put("passed", false)
                            .put("next_status", "needs_retest")
                            .put("feedback", "仍需巩固"),
                    )
                    .put(
                        JSONObject()
                            .put("task_id", "task-2")
                            .put("kp_id", "kp-flux")
                            .put("kp_name", "磁通量")
                            .put("correct_count", 1)
                            .put("total_count", 1)
                            .put("mastery_before", 0.8)
                            .put("mastery_after", 0.9)
                            .put("passed", true)
                            .put("next_status", "passed")
                            .put("feedback", "已通过"),
                    ),
            )
    }

    private fun reportJson(): JSONObject {
        return JSONObject()
            .put(
                "summary",
                JSONObject()
                    .put("plan_id", "plan-1")
                    .put("scope_type", "chapter")
                    .put("scope_id", "第二章 电磁感应")
                    .put("scope_name", "第二章 电磁感应")
                    .put("plan_status", "completed")
                    .put("diagnostic_correct_count", 1)
                    .put("diagnostic_total_count", 2)
                    .put("diagnostic_accuracy", 0.5)
                    .put("task_count", 2)
                    .put("weak_task_count", 1)
                    .put("passed_task_count", 2)
                    .put("needs_retest_task_count", 0)
                    .put("practiced_task_count", 2)
                    .put("pending_task_count", 0)
                    .put("retest_attempt_count", 1)
                    .put("latest_retest_accuracy", 0.8)
                    .put("completed", true),
            )
            .put("diagnostic_result", scopeResultJson())
            .put(
                "tasks",
                JSONArray()
                    .put(
                        JSONObject()
                            .put("task_id", "task-1")
                            .put("kp_id", "kp-lenz")
                            .put("kp_name", "楞次定律")
                            .put("priority", 1)
                            .put("status", "passed")
                            .put("recommended_action", "practice")
                            .put("reason", "检测暴露不稳定")
                            .put("diagnostic_correct_count", 1)
                            .put("diagnostic_total_count", 2)
                            .put("mastery_before", 0.2)
                            .put("mastery_after_diagnostic", 0.45)
                            .put("latest_retest_correct_count", 1)
                            .put("latest_retest_total_count", 1)
                            .put("latest_retest_passed", true)
                            .put("final_label", "已通过"),
                    ),
            )
            .put(
                "retest_attempts",
                JSONArray().put(
                    JSONObject()
                        .put("attempt_id", "retest-1")
                        .put("status", "submitted")
                        .put("correct_count", 2)
                        .put("total_count", 2)
                        .put("passed_count", 2)
                        .put("needs_retest_count", 0)
                        .put("created_at", "2026-07-02T11:00:00Z")
                        .put("submitted_at", "2026-07-02T11:10:00Z"),
                ),
            )
            .put("strengths", JSONArray().put("优势保持稳定"))
            .put("remaining_weaknesses", JSONArray())
            .put("next_actions", JSONArray().put("继续补弱楞次定律"))
    }

    private fun questionJson(id: String): JSONObject {
        return JSONObject()
            .put("id", id)
            .put("stem_text", "判断感应电流方向。")
            .put("question_type", "single_choice")
            .put("correct_answer", "A")
            .put("explanation", "按右手定则判断。")
            .put("options", JSONArray().put(JSONObject().put("label", "A").put("text", "向上")))
            .put("images", JSONArray())
    }
}
