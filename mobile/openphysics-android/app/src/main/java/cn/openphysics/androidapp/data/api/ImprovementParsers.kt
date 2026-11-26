package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.BuildConfig
import cn.openphysics.androidapp.domain.ImprovementPlan
import cn.openphysics.androidapp.domain.ImprovementReport
import cn.openphysics.androidapp.domain.ImprovementReportListItem
import cn.openphysics.androidapp.domain.ImprovementReportListResponse
import cn.openphysics.androidapp.domain.ImprovementReportRetestAttempt
import cn.openphysics.androidapp.domain.ImprovementReportSummary
import cn.openphysics.androidapp.domain.ImprovementReportTask
import cn.openphysics.androidapp.domain.ImprovementRetestResult
import cn.openphysics.androidapp.domain.ImprovementRetestSession
import cn.openphysics.androidapp.domain.ImprovementRetestTaskResult
import cn.openphysics.androidapp.domain.ImprovementTask
import cn.openphysics.androidapp.domain.LearningTraceEvent
import cn.openphysics.androidapp.domain.LearningTraceResponse
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.ScopeDiagnosticAttemptListItem
import cn.openphysics.androidapp.domain.ScopeDiagnosticAttemptListResponse
import cn.openphysics.androidapp.domain.ScopeDiagnosticAttemptDetail
import cn.openphysics.androidapp.domain.ScopeDiagnosticKpResult
import cn.openphysics.androidapp.domain.ScopeDiagnosticResult
import org.json.JSONArray
import org.json.JSONObject

object ImprovementParsers {
    fun parseScopeDiagnosticResult(json: JSONObject): ScopeDiagnosticResult {
        return ScopeDiagnosticResult(
            diagnosticAttemptId = json.optText("diagnostic_attempt_id"),
            scopeType = json.optText("scope_type"),
            scopeId = json.optText("scope_id"),
            scopeName = json.optText("scope_name", json.optText("scope_id")),
            kpResults = json.optJSONArray("kp_results").mapObjects { item ->
                ScopeDiagnosticKpResult(
                    id = item.optText("id"),
                    kpId = item.optText("kp_id"),
                    kpName = item.optText("kp_name"),
                    groupId = item.optText("group_id"),
                    groupName = item.optText("group_name"),
                    correctCount = item.optInt("correct_count", 0),
                    totalCount = item.optInt("total_count", 0),
                    masteryBefore = item.optDouble("mastery_before", 0.0),
                    masteryAfter = item.optDouble("mastery_after", 0.0),
                    isWeak = item.optBoolean("is_weak", false),
                )
            },
            correctCount = json.optInt("correct_count", 0),
            totalCount = json.optInt("total_count", 0),
            weakKpIds = json.optJSONArray("weak_kp_ids").mapStrings(),
            recommendation = json.optText("recommendation"),
            feedback = json.optText("feedback"),
        )
    }

    fun parseImprovementPlan(json: JSONObject): ImprovementPlan {
        return ImprovementPlan(
            id = json.optText("id"),
            studentId = json.optText("student_id"),
            diagnosticAttemptId = json.optText("diagnostic_attempt_id"),
            scopeType = json.optText("scope_type"),
            scopeId = json.optText("scope_id"),
            scopeName = json.optText("scope_name", json.optText("scope_id")),
            createdAt = json.optText("created_at"),
            updatedAt = json.optText("updated_at"),
            completedAt = json.optText("completed_at"),
            correctCount = json.optInt("correct_count", 0),
            totalCount = json.optInt("total_count", 0),
            weakCount = json.optInt("weak_count", 0),
            status = json.optText("status", "pending"),
            currentTaskId = json.optText("current_task_id"),
            sourceResult = json.optJSONObject("source_result")?.let { parseScopeDiagnosticResult(it) },
            tasks = json.optJSONArray("tasks").mapObjects { parseImprovementTask(it) },
        )
    }

    fun parseImprovementRetestSession(json: JSONObject): ImprovementRetestSession {
        return ImprovementRetestSession(
            attemptId = json.optText("attempt_id"),
            plan = parseImprovementPlan(json.optJSONObject("plan") ?: JSONObject()),
            session = parsePracticeSession(json.optJSONObject("session") ?: JSONObject()),
        )
    }

    fun parseImprovementRetestResult(json: JSONObject): ImprovementRetestResult {
        return ImprovementRetestResult(
            attemptId = json.optText("attempt_id"),
            plan = parseImprovementPlan(json.optJSONObject("plan") ?: JSONObject()),
            correctCount = json.optInt("correct_count", 0),
            totalCount = json.optInt("total_count", 0),
            passedCount = json.optInt("passed_count", 0),
            needsRetestCount = json.optInt("needs_retest_count", 0),
            taskResults = json.optJSONArray("task_results").mapObjects { item ->
                ImprovementRetestTaskResult(
                    taskId = item.optText("task_id"),
                    kpId = item.optText("kp_id"),
                    kpName = item.optText("kp_name"),
                    correctCount = item.optInt("correct_count", 0),
                    totalCount = item.optInt("total_count", 0),
                    masteryBefore = item.optNullableDouble("mastery_before"),
                    masteryAfter = item.optNullableDouble("mastery_after"),
                    passed = item.optBoolean("passed", false),
                    nextStatus = item.optText("next_status"),
                    feedback = item.optText("feedback"),
                )
            },
        )
    }

    fun parseImprovementReport(json: JSONObject): ImprovementReport {
        val summaryJson = json.optJSONObject("summary") ?: JSONObject()
        return ImprovementReport(
            summary = ImprovementReportSummary(
                planId = summaryJson.optText("plan_id"),
                scopeType = summaryJson.optText("scope_type"),
                scopeId = summaryJson.optText("scope_id"),
                scopeName = summaryJson.optText("scope_name"),
                planStatus = summaryJson.optText("plan_status"),
                diagnosticCorrectCount = summaryJson.optInt("diagnostic_correct_count", 0),
                diagnosticTotalCount = summaryJson.optInt("diagnostic_total_count", 0),
                diagnosticAccuracy = summaryJson.optDouble("diagnostic_accuracy", 0.0),
                taskCount = summaryJson.optInt("task_count", 0),
                weakTaskCount = summaryJson.optInt("weak_task_count", 0),
                passedTaskCount = summaryJson.optInt("passed_task_count", 0),
                needsRetestTaskCount = summaryJson.optInt("needs_retest_task_count", 0),
                practicedTaskCount = summaryJson.optInt("practiced_task_count", 0),
                pendingTaskCount = summaryJson.optInt("pending_task_count", 0),
                retestAttemptCount = summaryJson.optInt("retest_attempt_count", 0),
                latestRetestAccuracy = summaryJson.optNullableDouble("latest_retest_accuracy"),
                completed = summaryJson.optBoolean("completed", false),
            ),
            diagnosticResult = json.optJSONObject("diagnostic_result")?.let { parseScopeDiagnosticResult(it) },
            tasks = json.optJSONArray("tasks").mapObjects { item ->
                ImprovementReportTask(
                    taskId = item.optText("task_id"),
                    kpId = item.optText("kp_id"),
                    kpName = item.optText("kp_name"),
                    priority = item.optInt("priority", 0),
                    status = item.optText("status"),
                    recommendedAction = item.optText("recommended_action"),
                    reason = item.optText("reason"),
                    diagnosticCorrectCount = item.optInt("diagnostic_correct_count", 0),
                    diagnosticTotalCount = item.optInt("diagnostic_total_count", 0),
                    masteryBefore = item.optDouble("mastery_before", 0.0),
                    masteryAfterDiagnostic = item.optDouble("mastery_after_diagnostic", 0.0),
                    latestRetestCorrectCount = item.optNullableInt("latest_retest_correct_count"),
                    latestRetestTotalCount = item.optNullableInt("latest_retest_total_count"),
                    latestRetestPassed = item.optNullableBoolean("latest_retest_passed"),
                    finalLabel = item.optText("final_label"),
                )
            },
            retestAttempts = json.optJSONArray("retest_attempts").mapObjects { item ->
                ImprovementReportRetestAttempt(
                    attemptId = item.optText("attempt_id"),
                    status = item.optText("status"),
                    correctCount = item.optInt("correct_count", 0),
                    totalCount = item.optInt("total_count", 0),
                    passedCount = item.optInt("passed_count", 0),
                    needsRetestCount = item.optInt("needs_retest_count", 0),
                    createdAt = item.optText("created_at"),
                    submittedAt = item.optText("submitted_at"),
                )
            },
            strengths = json.optJSONArray("strengths").mapStrings(),
            remainingWeaknesses = json.optJSONArray("remaining_weaknesses").mapStrings(),
            nextActions = json.optJSONArray("next_actions").mapStrings(),
        )
    }

    fun parseImprovementReportList(json: JSONObject): ImprovementReportListResponse {
        return ImprovementReportListResponse(
            items = json.optJSONArray("items").mapObjects { item ->
                ImprovementReportListItem(
                    planId = item.optText("plan_id"),
                    scopeType = item.optText("scope_type"),
                    scopeId = item.optText("scope_id"),
                    scopeName = item.optText("scope_name"),
                    createdAt = item.optText("created_at"),
                    completedAt = item.optText("completed_at"),
                    diagnosticCorrectCount = item.optInt("diagnostic_correct_count", 0),
                    diagnosticTotalCount = item.optInt("diagnostic_total_count", 0),
                    diagnosticAccuracy = item.optDouble("diagnostic_accuracy", 0.0),
                    taskCount = item.optInt("task_count", 0),
                    passedTaskCount = item.optInt("passed_task_count", 0),
                    needsRetestTaskCount = item.optInt("needs_retest_task_count", 0),
                    latestRetestAccuracy = item.optNullableDouble("latest_retest_accuracy"),
                    summaryLabel = item.optText("summary_label"),
                    highlight = item.optText("highlight"),
                )
            },
            total = json.optInt("total", 0),
            limit = json.optInt("limit", 0),
            offset = json.optInt("offset", 0),
        )
    }

    fun parseScopeDiagnosticAttemptList(json: JSONObject): ScopeDiagnosticAttemptListResponse {
        return ScopeDiagnosticAttemptListResponse(
            items = json.optJSONArray("items").mapObjects { item ->
                ScopeDiagnosticAttemptListItem(
                    attemptId = item.optText("attempt_id"),
                    scopeType = item.optText("scope_type"),
                    scopeId = item.optText("scope_id"),
                    scopeName = item.optText("scope_name"),
                    diagnosticType = item.optText("diagnostic_type"),
                    createdAt = item.optText("created_at"),
                    submittedAt = item.optText("submitted_at"),
                    correctCount = item.optInt("correct_count", 0),
                    totalCount = item.optInt("total_count", 0),
                    weakCount = item.optInt("weak_count", 0),
                    recommendation = item.optText("recommendation"),
                    feedback = item.optText("feedback"),
                    linkedPlanId = item.optText("linked_plan_id"),
                    linkedPlanStatus = item.optText("linked_plan_status"),
                    linkedReportAvailable = item.optBoolean("linked_report_available", false),
                )
            },
            total = json.optInt("total", 0),
            limit = json.optInt("limit", 0),
            offset = json.optInt("offset", 0),
        )
    }

    fun parseScopeDiagnosticAttemptDetail(json: JSONObject): ScopeDiagnosticAttemptDetail {
        return ScopeDiagnosticAttemptDetail(
            attemptId = json.optText("attempt_id"),
            studentId = json.optText("student_id"),
            scopeType = json.optText("scope_type"),
            scopeId = json.optText("scope_id"),
            scopeName = json.optText("scope_name"),
            diagnosticType = json.optText("diagnostic_type"),
            status = json.optText("status"),
            createdAt = json.optText("created_at"),
            submittedAt = json.optText("submitted_at"),
            questionIds = json.optJSONArray("question_ids").mapStrings(),
            answerIds = json.optJSONArray("answer_ids").mapStrings(),
            correctCount = json.optInt("correct_count", 0),
            totalCount = json.optInt("total_count", 0),
            weakCount = json.optInt("weak_count", 0),
            weakKpIds = json.optJSONArray("weak_kp_ids").mapStrings(),
            recommendation = json.optText("recommendation"),
            feedback = json.optText("feedback"),
            kpResults = json.optJSONArray("kp_results").mapObjects { item ->
                ScopeDiagnosticKpResult(
                    id = item.optText("id"),
                    kpId = item.optText("kp_id"),
                    kpName = item.optText("kp_name"),
                    groupId = item.optText("group_id"),
                    groupName = item.optText("group_name"),
                    correctCount = item.optInt("correct_count", 0),
                    totalCount = item.optInt("total_count", 0),
                    masteryBefore = item.optDouble("mastery_before", 0.0),
                    masteryAfter = item.optDouble("mastery_after", 0.0),
                    isWeak = item.optBoolean("is_weak", false),
                )
            },
            linkedPlanId = json.optText("linked_plan_id"),
            linkedPlanStatus = json.optText("linked_plan_status"),
            linkedReportAvailable = json.optBoolean("linked_report_available", false),
        )
    }

    fun parseLearningTrace(json: JSONObject): LearningTraceResponse {
        return LearningTraceResponse(
            items = json.optJSONArray("items").mapObjects { item ->
                LearningTraceEvent(
                    id = item.optText("id"),
                    eventType = item.optText("event_type"),
                    eventTime = item.optText("event_time"),
                    studentId = item.optText("student_id"),
                    scopeType = item.optText("scope_type"),
                    scopeId = item.optText("scope_id"),
                    scopeName = item.optText("scope_name"),
                    title = item.optText("title"),
                    description = item.optText("description"),
                    attemptId = item.optText("attempt_id"),
                    planId = item.optText("plan_id"),
                    taskId = item.optText("task_id"),
                    retestAttemptId = item.optText("retest_attempt_id"),
                    kpId = item.optText("kp_id"),
                    kpName = item.optText("kp_name"),
                    statusLabel = item.optText("status_label"),
                    primaryAction = item.optText("primary_action"),
                    reportAvailable = item.optBoolean("report_available", false),
                )
            },
            total = json.optInt("total", 0),
            limit = json.optInt("limit", 0),
            offset = json.optInt("offset", 0),
        )
    }

    private fun parseImprovementTask(json: JSONObject): ImprovementTask {
        return ImprovementTask(
            id = json.optText("id"),
            planId = json.optText("plan_id"),
            kpId = json.optText("kp_id"),
            kpName = json.optText("kp_name"),
            groupId = json.optText("group_id"),
            groupName = json.optText("group_name"),
            correctCount = json.optInt("correct_count", 0),
            totalCount = json.optInt("total_count", 0),
            masteryBefore = json.optDouble("mastery_before", 0.0),
            masteryAfter = json.optDouble("mastery_after", 0.0),
            isWeak = json.optBoolean("is_weak", false),
            priority = json.optInt("priority", 0),
            status = json.optText("status", "pending"),
            recommendedAction = json.optText("recommended_action"),
            reason = json.optText("reason"),
        )
    }

    private fun parsePracticeSession(json: JSONObject): PracticeSession {
        return PracticeSession(
            objective = json.optText("session_objective", "阶段复测"),
            sessionType = json.optText("session_type", "improvement_retest"),
            strategy = json.optText("strategy"),
            questions = json.optJSONArray("questions").mapObjects { parsePracticeQuestion(it) },
        )
    }

    private fun parsePracticeQuestion(json: JSONObject): PracticeQuestion {
        return parsePracticeQuestionJson(json, BuildConfig.API_BASE_URL)
    }

    private fun JSONObject.optText(key: String, fallback: String = ""): String {
        if (!has(key) || isNull(key)) return fallback
        val value = optString(key, fallback)
        return if (value == "null") fallback else value
    }

    private fun JSONObject.optNullableInt(key: String): Int? {
        if (!has(key) || isNull(key)) return null
        return optInt(key)
    }

    private fun JSONObject.optNullableDouble(key: String): Double? {
        if (!has(key) || isNull(key)) return null
        return optDouble(key)
    }

    private fun JSONObject.optNullableBoolean(key: String): Boolean? {
        if (!has(key) || isNull(key)) return null
        return optBoolean(key)
    }

    private inline fun <T> JSONArray?.mapObjects(crossinline transform: (JSONObject) -> T): List<T> {
        if (this == null) return emptyList()
        return List(length()) { index -> transform(getJSONObject(index)) }
    }

    private fun JSONArray?.mapStrings(): List<String> {
        if (this == null) return emptyList()
        return buildList {
            for (index in 0 until length()) {
                val value = optString(index)
                if (value.isNotBlank() && value != "null") add(value)
            }
        }
    }
}
