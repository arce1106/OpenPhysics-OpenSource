package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.BuildConfig
import cn.openphysics.androidapp.domain.AnswerHistoryRecord
import cn.openphysics.androidapp.domain.DashboardData
import cn.openphysics.androidapp.domain.ReviewCompletion
import cn.openphysics.androidapp.domain.DailyLearningLoop
import cn.openphysics.androidapp.domain.DailyLearningLoopHistory
import cn.openphysics.androidapp.domain.DiagnosticFeedback
import cn.openphysics.androidapp.domain.DirectoryData
import cn.openphysics.androidapp.domain.DirectoryRelation
import cn.openphysics.androidapp.domain.DiagnosisSummary
import cn.openphysics.androidapp.domain.ImprovementPlan
import cn.openphysics.androidapp.domain.GrowthReportData
import cn.openphysics.androidapp.domain.ImprovementReport
import cn.openphysics.androidapp.domain.ImprovementReportListResponse
import cn.openphysics.androidapp.domain.ImprovementRetestResult
import cn.openphysics.androidapp.domain.ImprovementRetestSession
import cn.openphysics.androidapp.domain.LearnCompleteRequest
import cn.openphysics.androidapp.domain.LearningTraceResponse
import cn.openphysics.androidapp.domain.LearningCatalogData
import cn.openphysics.androidapp.domain.LearningCatalogTopicLayer
import cn.openphysics.androidapp.domain.LearningCatalogTopicOverview
import cn.openphysics.androidapp.domain.LocalImageFile
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.domain.KnowledgeMasteryEvidence
import cn.openphysics.androidapp.domain.KnowledgeMasteryJudgment
import cn.openphysics.androidapp.domain.LearnBundle
import cn.openphysics.androidapp.domain.MotivationPanel
import cn.openphysics.androidapp.domain.PaperBatchGradeResponse
import cn.openphysics.androidapp.domain.PlanRecommendation
import cn.openphysics.androidapp.domain.PracticeSessionTypes
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSelfReviewItem
import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.ProcessGrading
import cn.openphysics.androidapp.domain.RenderedRichContent
import cn.openphysics.androidapp.domain.ReviewData
import cn.openphysics.androidapp.domain.ReviewMistake
import cn.openphysics.androidapp.domain.RecommendedKp
import cn.openphysics.androidapp.domain.ReviewVariationQuestion
import cn.openphysics.androidapp.domain.ScopeDiagnosticAttemptDetail
import cn.openphysics.androidapp.domain.ScopeDiagnosticAttemptListResponse
import cn.openphysics.androidapp.domain.ScopeDiagnosticKpResult
import cn.openphysics.androidapp.domain.ScopeDiagnosticResult
import cn.openphysics.androidapp.domain.StudentSession
import cn.openphysics.androidapp.domain.MasteryUpdateValue
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.domain.SubmittedDiagnosticAnswer
import cn.openphysics.androidapp.domain.TutorChatMessage
import cn.openphysics.androidapp.domain.TrainStartData
import cn.openphysics.androidapp.domain.VideoItem
import cn.openphysics.androidapp.domain.WeakPoint
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStream
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

internal fun improvementTaskStatusHttpMethod(): String = "PATCH"

internal fun parseStudentSession(
    student: JSONObject,
    token: String,
    fallbackUsername: String = "",
): StudentSession = StudentSession(
    token = token,
    studentId = student.optNullableText("id", fallbackUsername),
    username = student.optNullableText("username", fallbackUsername),
    displayName = student.optNullableText("display_name", fallbackUsername),
    accountStatus = student.optNullableText("status", "active"),
)

private fun JSONObject.optNullableText(key: String, fallback: String = ""): String {
    if (!has(key) || isNull(key)) return fallback
    val value = optString(key, fallback)
    return if (value == "null") fallback else value
}

private fun JSONObject.growthReportText(key: String): String {
    val value = opt(key)
    return if (value == null || value == JSONObject.NULL) "" else value.toString()
}

internal fun parseGrowthReportJson(json: JSONObject): GrowthReportData? {
    val report = json.optJSONObject("report") ?: return null
    val id = report.growthReportText("id")
    if (id.isBlank()) return null
    return GrowthReportData(
        id = id,
        summary = report.growthReportText("summary"),
        totalAnswers = report.optJSONObject("metrics")?.optInt("total_answers", 0) ?: 0,
        startDate = report.growthReportText("start_date"),
        endDate = report.growthReportText("end_date"),
    )
}

class ApiHttpException(
    val statusCode: Int,
    val responseBody: String,
    message: String,
) : Exception(message) {
    var captchaRequired: Boolean = false
    var retryAfterSeconds: Int = 0
}

internal fun apiHttpException(statusCode: Int, responseBody: String): ApiHttpException {
    val detail = runCatching {
        when (val value = JSONObject(responseBody).opt("detail")) {
            null, JSONObject.NULL -> ""
            is String -> value
            else -> value.toString()
        }
    }.getOrDefault("")
    val message = if (statusCode == 401) cn.openphysics.androidapp.domain.StudentAccessPolicy.accountRequiredMessage()
        else detail.ifBlank { responseBody.ifBlank { "API error: $statusCode" } }
    return ApiHttpException(statusCode, responseBody, message)
}

internal fun notifyUnauthorized(
    statusCode: Int,
    requestToken: String?,
    onUnauthorized: (String) -> Unit,
) {
    if (statusCode == HttpURLConnection.HTTP_UNAUTHORIZED && !requestToken.isNullOrBlank()) {
        onUnauthorized(requestToken)
    }
}


internal fun withRenderedContent(path: String): String {
    if (Regex("""([?&])include_rendered=""").containsMatchIn(path)) {
        return path
    }
    val separator = if (path.contains("?")) "&" else "?"
    return "$path${separator}include_rendered=1"
}

private fun renderedContentToJsonOrNull(rendered: RenderedRichContent?): Any {
    if (rendered == null) return JSONObject.NULL
    return JSONObject()
        .put("html", rendered.html)
        .put("plain_text", rendered.plainText)
        .put("renderer", rendered.renderer)
        .put("renderer_version", rendered.rendererVersion)
        .put("content_hash", rendered.contentHash)
        .put("has_math", rendered.hasMath)
        .put("has_image", rendered.hasImage)
        .put("has_markdown_table", rendered.hasMarkdownTable)
        .put(
            "errors",
            JSONArray().apply {
                rendered.errors.forEach { error ->
                    put(
                        JSONObject()
                            .put("type", error.type)
                            .put("message", error.message)
                            .put("latex", error.latex)
                            .put("position", error.position ?: JSONObject.NULL),
                    )
                }
            },
        )
}

internal fun processGradingToTutorJson(grading: ProcessGrading): JSONObject {
    return JSONObject()
        .put("feedback", grading.feedback)
        .put("feedback_rendered", renderedContentToJsonOrNull(grading.feedbackRendered))
        .put("first_error", grading.firstError)
        .put("first_error_rendered", renderedContentToJsonOrNull(grading.firstErrorRendered))
        .put("next_action", grading.nextAction)
        .put("next_action_rendered", renderedContentToJsonOrNull(grading.nextActionRendered))
        .put("answer_image_paths", JSONArray().apply { grading.answerImagePaths.forEach { put(it) } })
        .put("confidence_level", grading.confidenceLevel)
        .put("needs_human_review", grading.needsHumanReview)
        .put("process_score", grading.processScore ?: JSONObject.NULL)
        .put("process_score_percent", grading.processScorePercent ?: JSONObject.NULL)
        .put("score", grading.score ?: JSONObject.NULL)
        .put("max_score", grading.maxScore ?: JSONObject.NULL)
        .put("model_correct", grading.modelCorrect ?: JSONObject.NULL)
        .put("equation_correct", grading.equationCorrect ?: JSONObject.NULL)
        .put("calculation_correct", grading.calculationCorrect ?: JSONObject.NULL)
        .put("unit_correct", grading.unitCorrect ?: JSONObject.NULL)
        .put("error_type_name", grading.errorTypeName)
        .put("grading_basis", grading.gradingBasis)
        .put("grading_basis_rendered", renderedContentToJsonOrNull(grading.gradingBasisRendered))
        .put("grading_confidence", grading.gradingConfidence ?: JSONObject.NULL)
        .put(
            "step_scores",
            JSONArray().apply {
                grading.stepScores.forEach { step ->
                    put(
                        JSONObject()
                            .put("name", step.name)
                            .put("score", step.score)
                            .put("max_score", step.maxScore)
                            .put("comment", step.comment),
                    )
                }
            },
        )
}

class ApiClient(
    private val onUnauthorized: (rejectedToken: String) -> Unit = {},
    private val baseUrl: String = BuildConfig.API_BASE_URL,
) : PracticeSubmissionApi {
    fun getStudentClasses(token: String): List<StudentClassMembership> {
        val rows = getJsonArray("/classes", token)
        return (0 until rows.length()).map { parseStudentClass(rows.getJSONObject(it)) }
    }

    fun previewClassInvitation(code: String, token: String): StudentClassInvitation =
        parseClassInvitation(postJson("/class-invitations/preview", classInvitationPayload(code), token))

    fun joinStudentClass(code: String, disclosureVersion: String, studentName: String, token: String): StudentClassJoinResult {
        val result = postJson("/classes/join", classInvitationPayload(code, disclosureVersion, studentName), token)
        return StudentClassJoinResult(parseStudentClass(result), result.getString("student_name"))
    }

    fun renameStudent(studentName: String, token: String): String {
        require(validStudentClassName(studentName)) { "请填写学生真实姓名（1—40字）" }
        val conn = open("/student-name", "PUT", token)
        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
        conn.doOutput = true
        BufferedWriter(OutputStreamWriter(conn.outputStream, Charsets.UTF_8)).use {
            it.write(JSONObject().put("student_name", studentName.trim()).toString())
        }
        return readResponse(conn, token).getString("student_name")
    }

    fun leaveStudentClass(classId: String, token: String) {
        val conn = open("/classes/${enc(classId)}", "DELETE", token)
        try {
            val status = conn.responseCode
            val text = readText(if (status in 200..299) conn.inputStream else conn.errorStream)
            if (status !in 200..299) throw httpError(status, text, token)
        } finally { conn.disconnect() }
    }

    fun login(username: String, password: String): StudentSession {
        return login(LoginCredentials(username, password))
    }

    fun login(credentials: LoginCredentials): StudentSession {
        val json = postJson(loginPath(credentials), loginPayload(credentials), null)
        val student = json.getJSONObject("student")
        return parseStudentSession(student, json.getString("access_token"), credentials.identifier)
    }


    fun getAccountSettings(token: String): AccountSettings = parseAccountSettings(getJson("/auth/account-credentials", token))

    fun requestAccountSecurity(action: SecurityAction, fields: Map<String, String>, owner: StudentSession): AccountSecurityResult {
        require(action.authenticated) { "当前账号操作必须登录" }
        val response = postJson("/auth/${action.path}", securityPayload(action, fields, renewSession = true), owner.token)
        return parseAccountSecurityResult(action, response, owner)
    }


    fun deleteAccount(token: String, password: String) {
        require(password.isNotBlank()) { "请填写当前密码" }
        val body = JSONObject().put("confirmed", true).put("current_password", password)
        val json = postJson("/auth/account-deletion", body, token)
        check(json.optBoolean("deleted", false)) { "注销尚未完成，请稍后重试。" }
    }

    fun getLoginCaptcha(): LoginCaptcha {
        val json = getJson("/auth/captcha", null)
        return LoginCaptcha(json.getString("challenge_id"), json.getString("image_base64"))
    }


    fun getCurrentStudent(session: StudentSession): StudentSession {
        return parseStudentSession(
            getJson("/auth/me", session.token),
            session.token,
            session.username,
        )
    }

    /** Trades a still-valid token for a fresh one; a revoked or expired token gets 401. */
    fun refreshStudentToken(session: StudentSession): StudentSession {
        val json = postJson("/auth/refresh-token", JSONObject(), session.token)
        return parseStudentSession(json.getJSONObject("student"), json.getString("access_token"), session.username)
    }

    fun createWebLoginTicket(token: String): String {
        val json = postJson("/auth/web-login-ticket", JSONObject(), token)
        return json.optText("ticket")
    }

    fun getDashboard(token: String, studentId: String): DashboardData {
        val json = getJson("/dashboard?student_id=${enc(studentId)}", token)
        val diagnosis = json.optJSONObject("diagnosis")
        val plan = json.optJSONObject("plan")?.let {
            PlanRecommendation(
                kpId = it.optText("kp_id"),
                kpName = it.optText("kp_name"),
                mastery = it.optDouble("mastery", 0.0),
                reason = it.optText("reason"),
                estimatedQuestions = it.optInt("estimated_questions", 0),
                estimatedMinutes = it.optInt("estimated_minutes", 0),
            )
        }
        val motivation = json.optJSONObject("motivation")
        return DashboardData(
            diagnosis = DiagnosisSummary(
                overallMastery = diagnosis?.optDouble("overall_mastery", 0.0) ?: 0.0,
                masteredCount = diagnosis?.optInt("mastered_count", 0) ?: 0,
                inProgressCount = diagnosis?.optInt("in_progress_count", 0) ?: 0,
                lockedCount = diagnosis?.optInt("locked_count", 0) ?: 0,
                weakPoints = diagnosis?.optJSONArray("weak_points").mapObjects {
                    WeakPoint(
                        kpId = it.optText("kp_id"),
                        kpName = it.optText("kp_name"),
                        mastery = it.optDouble("mastery", 0.0),
                    )
                },
            ),
            plan = plan,
            motivation = MotivationPanel(
                streakDays = motivation?.optInt("streak_days", 0) ?: 0,
                weeklyKpsMastered = motivation?.optInt("weekly_kps_mastered", 0) ?: 0,
                mistakeBacklogCount = motivation?.optInt("mistake_backlog_count", 0) ?: 0,
                nextMilestone = motivation?.optText("next_milestone") ?: "",
            ),
        )
    }

    fun getDailyLearningLoop(token: String, studentId: String): DailyLearningLoop {
        val json = getJson("/reward/daily-loop?student_id=${enc(studentId)}", token)
        return DailyLearningLoopParsers.parseLoop(json)
    }

    fun getDailyLearningLoopHistory(token: String, studentId: String, days: Int = 35): DailyLearningLoopHistory {
        val safeDays = days.coerceIn(1, 62)
        val json = getJson("/reward/daily-loop/history?student_id=${enc(studentId)}&days=$safeDays", token)
        return DailyLearningLoopParsers.parseHistory(json)
    }

    fun getGrowthReport(token: String, studentId: String): GrowthReportData? {
        val json = getJson("/reward/growth-report?student_id=${enc(studentId)}", token)
        return parseGrowthReportJson(json)
    }

    fun generateGrowthReport(token: String, studentId: String): GrowthReportData? {
        val json = postJson(
            "/reward/growth-report?student_id=${enc(studentId)}",
            JSONObject(),
            token,
        )
        return parseGrowthReportJson(json)
    }

    fun getAnswerHistory(
        token: String,
        studentId: String,
        limit: Int = 30,
        fromDate: String = "",
        toDate: String = "",
    ): List<AnswerHistoryRecord> {
        val dateQuery = buildString {
            if (fromDate.isNotBlank()) append("&from_date=${enc(fromDate)}")
            if (toDate.isNotBlank()) append("&to_date=${enc(toDate)}")
        }
        val json = getJsonArray(
            withRenderedContent("/history/answers?student_id=${enc(studentId)}&limit=$limit$dateQuery"),
            token,
        )
        return StudentRecordParsers.parseHistory(json, BuildConfig.API_BASE_URL)
    }

    fun getReview(token: String, studentId: String): ReviewData {
        val json = getJson(
            withRenderedContent("/review?student_id=${enc(studentId)}&group_by=kp&summary_only=1"),
            token,
        )
        return StudentRecordParsers.parseReview(
            json,
            BuildConfig.API_BASE_URL,
            mistakesAreDetailed = false,
        )
    }

    fun getReviewMistake(token: String, answerId: Int): ReviewMistake {
        val json = getJson(withRenderedContent("/review/$answerId"), token)
        return StudentRecordParsers.parseReviewMistake(json, BuildConfig.API_BASE_URL)
    }

    fun getTrainStart(token: String, studentId: String): TrainStartData {
        val json = getJson("/train/start?student_id=${enc(studentId)}", token)
        return TrainStartData(
            isFirstTime = json.optBoolean("is_first_time", false),
            hasDiagnosed = json.optBoolean("has_diagnosed", false),
            recommendedKps = json.optJSONArray("recommended_kps").mapObjects {
                RecommendedKp(
                    kpId = it.optText("kp_id"),
                    kpName = it.optText("kp_name"),
                    mastery = it.optDouble("mastery", 0.0),
                    reason = it.optText("reason"),
                )
            },
        )
    }

    fun getDirectory(token: String, studentId: String): DirectoryData {
        val json = getJson("/directory?student_id=${enc(studentId)}", token)
        val kps = json.optJSONArray("kps").mapObjects { item ->
            KpNode(
                id = item.optText("id"),
                name = item.optText("name"),
                volume = item.optText("volume", "未分类"),
                chapter = item.optText("chapter", "未分类"),
                section = item.optText("section", "未分类"),
                mastery = item.optDouble("mastery", 0.0),
                status = item.optText("status", "upcoming"),
                lastPracticed = item.optText("last_practiced"),
                learningState = item.optText("learning_state"),
                learningStateLabel = item.optText("learning_state_label"),
                learningStateTone = item.optText("learning_state_tone"),
                contentAvailable = item.optBoolean("content_available", true),
                practiceAvailable = item.optBoolean("practice_available", true),
            )
        }
        val stats = json.optJSONObject("stats")
        val relations = json.optJSONArray("relations").mapObjects { item ->
            DirectoryRelation(
                id = item.optInt("id", 0),
                sourceId = item.optText("source_id"),
                targetId = item.optText("target_id"),
                relationType = item.optText("relation_type"),
                reason = item.optText("reason"),
            )
        }
        return DirectoryData(
            kps = kps,
            mastered = stats?.optInt("mastered", 0) ?: 0,
            inProgress = stats?.optInt("in_progress", 0) ?: 0,
            total = stats?.optInt("total", kps.size) ?: kps.size,
            relations = relations,
        )
    }

    fun getLearningCatalog(token: String, catalogCode: String): LearningCatalogData {
        val json = getJson("/learning-catalogs/${enc(catalogCode)}", token)
        return LearningCatalogParsers.parseCatalog(json)
    }

    fun getLearningCatalogResumeTopicId(token: String, catalogCode: String): String {
        val json = getJson("/learning-catalogs/${enc(catalogCode)}/resume", token)
        return LearningCatalogParsers.parseResumeTopicId(json)
    }

    fun getLearningCatalogTopicOverview(
        token: String,
        catalogCode: String,
        nodeId: String,
    ): LearningCatalogTopicOverview {
        val json = getJson(
            "/learning-catalogs/${enc(catalogCode)}/nodes/${enc(nodeId)}/overview",
            token,
        )
        return LearningCatalogParsers.parseOverview(json)
    }

    fun getLearningCatalogTopicSession(
        token: String,
        catalogCode: String,
        nodeId: String,
        layer: LearningCatalogTopicLayer,
        questionCount: Int = layer.questionCount,

        restart: Boolean = false,
    ): PracticeSession {
        val body = JSONObject()
            .put("layer", layer.apiValue)
            .put("question_count", questionCount.coerceIn(1, 10))
        val json = postJson(
            withRenderedContent(
                "/learning-catalogs/${enc(catalogCode)}/nodes/${enc(nodeId)}/session",
            ),
            body,
            token,
        )
        return json.toPracticeSession(
            defaultObjective = "${layer.title}专题训练",
            defaultSessionType = "${catalogCode}_${layer.apiValue}",
        )
    }


    /** The home card's list; [history] keeps every finished homework instead of the last week's. */
    fun getTeacherHomework(token: String, history: Boolean = false): List<cn.openphysics.androidapp.domain.TeacherHomework> =
        getJsonArray(if (history) "/teacher-homework?history=true" else "/teacher-homework", token).mapObjects {
            cn.openphysics.androidapp.domain.TeacherHomework(
                attemptId = it.optText("attempt_id"), assignmentId = it.optText("assignment_id"),
                title = it.optText("title"), className = it.optText("class_name"),
                questionCount = it.optInt("question_count"), gradedCount = it.optInt("graded_count"),
                status = it.optText("status"), publishedAt = it.optText("published_at"),
                delivery = it.optText("delivery"),
                score = LearningCatalogParsers.parseHomeworkScore(it),
            )
        }

    fun getTeacherHomeworkSession(token: String, attemptId: String): PracticeSession =
        postJson(withRenderedContent("/teacher-homework/${enc(attemptId)}/session"), JSONObject(), token)
            .toPracticeSession(defaultObjective = "老师作业", defaultSessionType = "teacher_homework")

    fun submitTeacherPaperAttempt(token: String, attemptId: String) {
        postJson("/teacher-paper-attempts/${enc(attemptId)}/submit", JSONObject(), token)
    }

    fun getQuestionLessonVideo(token: String, questionId: String, answerId: Int): cn.openphysics.androidapp.domain.TeacherPaperQuestionVideo {
        val json = postJson("/questions/${enc(questionId)}/lesson-video", JSONObject().put("answer_id", answerId), token)
        return cn.openphysics.androidapp.domain.TeacherPaperQuestionVideo(
            questionId = json.optText("question_id"), title = json.optText("title"),
            videoUrl = java.net.URI(BuildConfig.API_BASE_URL).resolve(json.optText("video_url")).toString(),
            durationSeconds = json.optInt("duration_seconds"),
        )
    }

    fun recordLearningCatalogTopicEvidence(
        token: String,
        catalogCode: String,
        nodeId: String,
        layer: LearningCatalogTopicLayer,
        answerId: Int,
    ): LearningCatalogTopicOverview {
        val body = JSONObject()
            .put("layer", layer.apiValue)
            .put("answer_id", answerId)
        val json = postJson(
            "/learning-catalogs/${enc(catalogCode)}/nodes/${enc(nodeId)}/evidence",
            body,
            token,
        )
        return LearningCatalogParsers.parseOverview(json)
    }

    fun getKnowledgeMasteryJudgments(
        token: String,
        studentId: String,
        kpIds: List<String>,
    ): List<KnowledgeMasteryJudgment> {
        val ids = kpIds.filter { it.isNotBlank() }.distinct()
        if (ids.isEmpty()) return emptyList()
        val body = JSONObject()
            .put("kp_ids", JSONArray().apply { ids.forEach { put(it) } })
        val json = postJson("/mastery-judgments/kps?student_id=${enc(studentId)}", body, token)
        return json.optJSONArray("items").mapObjects { it.toKnowledgeMasteryJudgment() }
    }

    fun getLearnBundle(token: String, studentId: String, kpId: String): LearnBundle {
        val json = getJson(withRenderedContent("/learn/${enc(kpId)}?student_id=${enc(studentId)}"), token)
        return LearnBundleParsers.parse(
            json = json,
            defaultKpId = kpId,
            videos = getLearnVideos(token, studentId, kpId),
        )
    }

    fun markLearnComplete(token: String, studentId: String, request: LearnCompleteRequest) {
        val body = JSONObject()
            .put("kp_id", request.kpId)
            .put("content_id", request.contentId)
            .put("content_type", request.contentType)
            .put("time_spent_seconds", request.timeSpentSeconds)
        postJson("/learn/${enc(request.kpId)}/complete?student_id=${enc(studentId)}", body, token)
    }

    fun getPracticeSession(token: String, studentId: String, kpId: String?, count: Int): PracticeSession {
        val targetParam = kpId?.takeIf { it.isNotBlank() }?.let { "&target_kp=${enc(it)}" }.orEmpty()
        val json = getJson(withRenderedContent("/practice/session?student_id=${enc(studentId)}$targetParam&count=$count"), token)
        return json.toPracticeSession(defaultObjective = "巩固小练", defaultSessionType = PracticeSessionTypes.Practice)
    }

    fun getKpDiagnosticSession(token: String, studentId: String, kpId: String, questionCount: Int): PracticeSession {
        val body = JSONObject().put("question_count", questionCount)
        val json = postJson(withRenderedContent("/diagnose/kp/${enc(kpId)}?student_id=${enc(studentId)}"), body, token)
        return json.toPracticeSession(defaultObjective = "掌握评估", defaultSessionType = PracticeSessionTypes.KpDiagnostic)
    }

    fun getScopeDiagnosticSession(
        token: String,
        studentId: String,
        scopeType: String,
        scopeId: String,
        questionCount: Int,
    ): PracticeSession {
        val body = JSONObject()
            .put("scope_type", scopeType)
            .put("scope_id", scopeId)
            .put("question_count", questionCount)
        val json = postJson(withRenderedContent("/diagnose/scope?student_id=${enc(studentId)}"), body, token)
        return json.toPracticeSession(defaultObjective = "定位练习", defaultSessionType = PracticeSessionTypes.ScopeDiagnostic)
    }

    fun getKpSubmittedDiagnosticFeedback(
        token: String,
        studentId: String,
        kpId: String,
        answers: List<SubmittedDiagnosticAnswer>,
    ): DiagnosticFeedback {
        val body = JSONObject().put("answers", SubmittedDiagnosticPayload.answersJson(answers))
        val json = postJson("/diagnose/kp/${enc(kpId)}/submitted-feedback?student_id=${enc(studentId)}", body, token)
        return json.toDiagnosticFeedback(titleKey = "kp_name", fallbackTitle = kpId)
    }

    fun getScopeSubmittedDiagnosticFeedback(
        token: String,
        studentId: String,
        scopeType: String,
        scopeId: String,
        answers: List<SubmittedDiagnosticAnswer>,
    ): DiagnosticFeedback {
        val body = JSONObject()
            .put("scope_type", scopeType)
            .put("scope_id", scopeId)
            .put("answers", SubmittedDiagnosticPayload.answersJson(answers))
        val json = postJson("/diagnose/scope/submitted-feedback?student_id=${enc(studentId)}", body, token)
        return json.toDiagnosticFeedback(titleKey = "scope_name", fallbackTitle = scopeId)
    }

    fun getScopeSubmittedDiagnosticResult(
        token: String,
        studentId: String,
        scopeType: String,
        scopeId: String,
        answers: List<SubmittedDiagnosticAnswer>,
    ): ScopeDiagnosticResult {
        val body = JSONObject()
            .put("scope_type", scopeType)
            .put("scope_id", scopeId)
            .put("answers", SubmittedDiagnosticPayload.answersJson(answers))
        val json = postJson("/diagnose/scope/submitted-feedback?student_id=${enc(studentId)}", body, token)
        return ImprovementParsers.parseScopeDiagnosticResult(json)
    }

    fun createImprovementPlanFromScopeResult(
        token: String,
        studentId: String,
        result: ScopeDiagnosticResult,
    ): ImprovementPlan {
        val body = JSONObject().put("diagnostic_result", result.toJson())
        val json = postJson("/improvement/plans/from-scope-result?student_id=${enc(studentId)}", body, token)
        return ImprovementParsers.parseImprovementPlan(json)
    }

    fun getLatestImprovementPlan(
        token: String,
        studentId: String,
        scopeType: String? = null,
        scopeId: String? = null,
    ): ImprovementPlan? {
        val params = buildString {
            append("/improvement/plans/latest?student_id=${enc(studentId)}")
            if (!scopeType.isNullOrBlank()) append("&scope_type=${enc(scopeType)}")
            if (!scopeId.isNullOrBlank()) append("&scope_id=${enc(scopeId)}")
        }
        val json = getOptionalJson(params, token) ?: return null
        return ImprovementParsers.parseImprovementPlan(json)
    }

    fun getImprovementPlan(token: String, studentId: String, planId: String): ImprovementPlan {
        val json = getJson("/improvement/plans/${enc(planId)}?student_id=${enc(studentId)}", token)
        return ImprovementParsers.parseImprovementPlan(json)
    }

    fun updateImprovementTaskStatus(
        token: String,
        studentId: String,
        planId: String,
        taskId: String,
        status: String,
    ): ImprovementPlan {
        val body = JSONObject().put("status", status)
        val json = patchJson(
            "/improvement/plans/${enc(planId)}/tasks/${enc(taskId)}?student_id=${enc(studentId)}",
            body,
            token,
        )
        return ImprovementParsers.parseImprovementPlan(json)
    }

    fun moveToNextImprovementTask(token: String, studentId: String, planId: String): ImprovementPlan {
        val json = postJson("/improvement/plans/${enc(planId)}/next?student_id=${enc(studentId)}", JSONObject(), token)
        return ImprovementParsers.parseImprovementPlan(json)
    }

    fun startImprovementRetest(token: String, studentId: String, planId: String): ImprovementRetestSession {
        val json = postJson(withRenderedContent("/improvement/plans/${enc(planId)}/retest/start?student_id=${enc(studentId)}"), JSONObject(), token)
        return ImprovementParsers.parseImprovementRetestSession(json)
    }

    fun submitImprovementRetestFeedback(
        token: String,
        studentId: String,
        planId: String,
        attemptId: String,
        answers: List<SubmittedDiagnosticAnswer>,
    ): ImprovementRetestResult {
        val body = JSONObject().put("answers", SubmittedDiagnosticPayload.answersJson(answers))
        val json = postJson(
            "/improvement/plans/${enc(planId)}/retest/${enc(attemptId)}/submitted-feedback?student_id=${enc(studentId)}",
            body,
            token,
        )
        return ImprovementParsers.parseImprovementRetestResult(json)
    }

    fun getImprovementReport(token: String, studentId: String, planId: String): ImprovementReport {
        val json = getJson("/improvement/plans/${enc(planId)}/report?student_id=${enc(studentId)}", token)
        return ImprovementParsers.parseImprovementReport(json)
    }

    fun getLatestCompletedImprovementReport(
        token: String,
        studentId: String,
        scopeType: String? = null,
        scopeId: String? = null,
    ): ImprovementReport? {
        val path = buildString {
            append("/improvement/reports/latest-completed?student_id=${enc(studentId)}")
            if (!scopeType.isNullOrBlank()) append("&scope_type=${enc(scopeType)}")
            if (!scopeId.isNullOrBlank()) append("&scope_id=${enc(scopeId)}")
        }
        val json = getOptionalJson(path, token) ?: return null
        return ImprovementParsers.parseImprovementReport(json)
    }

    fun listImprovementReports(
        token: String,
        studentId: String,
        limit: Int = 10,
        offset: Int = 0,
    ): ImprovementReportListResponse {
        val safeLimit = limit.coerceIn(1, 50)
        val safeOffset = offset.coerceAtLeast(0)
        val json = getJson(
            "/improvement/reports?student_id=${enc(studentId)}&limit=$safeLimit&offset=$safeOffset",
            token,
        )
        return ImprovementParsers.parseImprovementReportList(json)
    }

    fun listScopeDiagnosticAttempts(
        token: String,
        studentId: String,
        limit: Int = 10,
        offset: Int = 0,
    ): ScopeDiagnosticAttemptListResponse {
        val safeLimit = limit.coerceIn(1, 50)
        val safeOffset = offset.coerceAtLeast(0)
        val json = getJson(
            "/diagnostics/scope/attempts?student_id=${enc(studentId)}&limit=$safeLimit&offset=$safeOffset",
            token,
        )
        return ImprovementParsers.parseScopeDiagnosticAttemptList(json)
    }

    fun getScopeDiagnosticAttempt(
        token: String,
        studentId: String,
        attemptId: String,
    ): ScopeDiagnosticAttemptDetail {
        val json = getJson(
            "/diagnostics/scope/attempts/${enc(attemptId)}?student_id=${enc(studentId)}",
            token,
        )
        return ImprovementParsers.parseScopeDiagnosticAttemptDetail(json)
    }

    fun listLearningTrace(
        token: String,
        studentId: String,
        limit: Int = 20,
        offset: Int = 0,
    ): LearningTraceResponse {
        val safeLimit = limit.coerceIn(1, 50)
        val safeOffset = offset.coerceAtLeast(0)
        val json = getJson(
            "/learning-trace?student_id=${enc(studentId)}&limit=$safeLimit&offset=$safeOffset",
            token,
        )
        return ImprovementParsers.parseLearningTrace(json)
    }

    override fun submitAnswer(
        token: String,
        studentId: String,
        questionId: String,
        answer: String,
        timeSpentMs: Long,
        targetKnowledgePointId: String?,
        submissionId: String,
        teacherPaperAttemptId: String?,
        topicContext: String?,
    ): SubmitResult {
        val body = JSONObject()
            .put("question_id", questionId)
            .put("given_answer", answer)
            .put("time_spent_ms", timeSpentMs)
            .put("submission_id", submissionId)
        targetKnowledgePointId?.takeIf { it.isNotBlank() }?.let {
            body.put("target_knowledge_point_id", it)
        }
        teacherPaperAttemptId?.takeIf { it.isNotBlank() }?.let { body.put("teacher_paper_attempt_id", it) }
        topicContext?.let { body.put("topic_context", JSONObject(it)) }
        val json = postJson(withRenderedContent("/practice/submit?student_id=${enc(studentId)}"), body, token)
        return json.toSubmitResult()
    }

    override fun submitPhotoAnswer(
        token: String,
        studentId: String,
        questionId: String,
        image: LocalImageFile,
        timeSpentMs: Long,
        targetKnowledgePointId: String?,
        submissionId: String,
        teacherPaperAttemptId: String?,
        topicContext: String?,
    ): SubmitResult {
        val payload = MultipartFormDataBuilder.build(
            fields = buildMap {
                put("question_id", questionId)
                put("student_id", studentId)
                put("time_spent_ms", timeSpentMs.toString())
                put("submission_id", submissionId)
                teacherPaperAttemptId?.takeIf { it.isNotBlank() }?.let { put("teacher_paper_attempt_id", it) }
                topicContext?.let { put("topic_context", it) }
                targetKnowledgePointId?.takeIf { it.isNotBlank() }?.let {
                    put("target_knowledge_point_id", it)
                }
            },
            fileFieldName = "image",
            fileName = image.fileName,
            mimeType = image.mimeType,
            file = image.asFile(),
        )
        val json = postMultipart(withRenderedContent("/practice/submit-photo?student_id=${enc(studentId)}"), payload, token)
        return json.toSubmitResult()
    }

    override fun submitScratchImage(
        token: String,
        studentId: String,
        questionId: String,
        answerId: Int,
        image: LocalImageFile,
        timeSpentMs: Long,
    ): SubmitResult {
        val payload = MultipartFormDataBuilder.build(
            fields = mapOf(
                "question_id" to questionId,
                "answer_id" to answerId.toString(),
                "time_spent_ms" to timeSpentMs.toString(),
                "evidence_kind" to "scratch_image",
            ),
            fileFieldName = "image",
            fileName = image.fileName,
            mimeType = image.mimeType,
            file = image.asFile(),
        )
        val json = postMultipart(withRenderedContent("/practice/process-evidence?student_id=${enc(studentId)}"), payload, token)
        return SubmitResult(
            answerId = json.optNullableInt("answer_id"),
            correct = false,
            correctAnswer = "",
            explanation = "",
            aiFeedback = "",
            processGrading = StudentRecordParsers.parseProcessGrading(json.optJSONObject("process_grading"), BuildConfig.API_BASE_URL),
        )
    }

    override fun submitSelfReview(
        token: String,
        studentId: String,
        questionId: String,
        items: List<PracticeSelfReviewItem>,
        timeSpentMs: Long,
        targetKnowledgePointId: String?,
        submissionId: String,
        teacherPaperAttemptId: String?,
        topicContext: String?,
    ): SubmitResult {
        val body = JSONObject()
            .put("question_id", questionId)
            .put(
                "items",
                JSONArray().apply {
                    items.forEach { item ->
                        put(
                            JSONObject()
                                .put("label", item.label)
                                .put("status", item.status),
                        )
                    }
                },
            )
            .put("time_spent_ms", timeSpentMs)
            .put("submission_id", submissionId)
        targetKnowledgePointId?.takeIf { it.isNotBlank() }?.let {
            body.put("target_knowledge_point_id", it)
        }
        teacherPaperAttemptId?.takeIf { it.isNotBlank() }?.let { body.put("teacher_paper_attempt_id", it) }
        topicContext?.let { body.put("topic_context", JSONObject(it)) }
        val json = postJson(withRenderedContent("/practice/self-review"), body, token)
        return json.toSubmitResult()
    }

    fun submitPaperBatch(
        token: String,
        studentId: String,
        images: List<PaperBatchImageUpload>,
        questionIds: List<String>,
        timeSpentMs: Long = 0L,
        targetKnowledgePointIds: Map<String, String> = emptyMap(),
        submissionId: String,
        teacherPaperAttemptId: String? = null,
        topicContext: String? = null,
    ): PaperBatchGradeResponse {
        val targetKnowledgePointJson = JSONObject().apply {
            targetKnowledgePointIds.forEach { (questionId, kpId) ->
                if (questionId in questionIds && kpId.isNotBlank()) put(questionId, kpId)
            }
        }
        val payload = MultipartFormDataBuilder.build(
            fields = buildMap {
                put("question_ids", JSONArray().apply { questionIds.forEach { put(it) } }.toString())
                put("time_spent_ms", timeSpentMs.toString())
                put("submission_id", submissionId)
                teacherPaperAttemptId?.takeIf { it.isNotBlank() }?.let { put("teacher_paper_attempt_id", it) }
                topicContext?.let { put("topic_context", it) }
                if (targetKnowledgePointJson.length() > 0) {
                    put("target_knowledge_point_ids", targetKnowledgePointJson.toString())
                }
            },
            files = images.mapIndexed { index, image ->
                MultipartFilePart(
                    fieldName = "images",
                    fileName = image.fileName.ifBlank { "paper-page-${index + 1}.jpg" },
                    mimeType = image.mimeType,
                    file = image.asFile(),
                )
            },
        )
        val json = postMultipart(withRenderedContent("/practice/submit-paper-batch?student_id=${enc(studentId)}"), payload, token)
        return PaperBatchParsers.parse(json, BuildConfig.API_BASE_URL)
    }

    fun correctAnswerGrading(
        token: String,
        answerId: Int,
        correctedAnswer: String,
        isCorrect: Boolean,
        correctionReason: String,
    ): SubmitResult {
        val body = JSONObject()
            .put("corrected_answer", correctedAnswer)
            .put("is_correct", isCorrect)
            .put("correction_reason", correctionReason)
        val json = postJson(withRenderedContent("/practice/answers/$answerId/correct"), body, token)
        return json.toSubmitResult()
    }

    fun completeReview(token: String, answerId: Int, retryAnswerId: Int? = null): ReviewCompletion {
        val body = JSONObject().apply { retryAnswerId?.let { put("retry_answer_id", it) } }
        val json = postJson("/review/$answerId/complete", body, token)
        return ReviewCompletion(
            cleared = json.optBoolean("cleared", false),
            detail = json.optString("detail", "").trim(),
        )
    }

    fun getReviewVariations(token: String, answerId: Int): List<ReviewVariationQuestion> {
        val json = getJson(withRenderedContent("/review/variations/$answerId"), token)
        return json.optJSONArray("variations").mapObjects { item ->
            ReviewVariationQuestion(
                variationType = item.optText("variation_type"),
                title = item.optText("title", "变式题"),
                reason = item.optText("reason"),
                question = item.optJSONObject("question").toPracticeQuestion(),
            )
        }
    }

    fun retrySimilarQuestion(token: String, answerId: Int): PracticeQuestion? {
        val json = postJson(withRenderedContent("/review/retry/$answerId"), JSONObject(), token)
        return json.optJSONObject("question")?.toPracticeQuestion()
    }

    fun questionTutorChat(
        token: String,
        questionId: String,
        givenAnswer: String,
        message: String,
        history: List<TutorChatMessage>,
        processGrading: ProcessGrading? = null,
    ): String {
        val body = JSONObject()
            .put("question_id", questionId)
            .put("given_answer", givenAnswer)
            .put("message", message)
            .put(
                "history",
                JSONArray().apply {
                    history.forEach { item ->
                        put(JSONObject().put("role", item.role).put("content", item.content))
                    }
                },
            )
        processGrading?.let {
            body.put("process_grading", processGradingToTutorJson(it))
        }
        val json = postJson("/tutor/question-chat", body, token)
        return json.optText("text")
    }

    fun learnChat(
        token: String,
        kpId: String,
        message: String,
        history: List<TutorChatMessage>,
    ): String {
        val body = JSONObject()
            .put("kp_id", kpId)
            .put("message", message)
            .put(
                "history",
                JSONArray().apply {
                    history.takeLast(8).forEach { item ->
                        put(JSONObject().put("role", item.role).put("content", item.content))
                    }
                },
            )
        return postSseText("/learn/chat", body, token).ifBlank { "这次 AI 助教没有返回内容，请稍后再试。" }
    }

    private fun JSONObject.toSubmitResult(): SubmitResult {
        return SubmitResult(
            answerId = optNullableInt("answer_id"),
            givenAnswer = optText("given_answer"),
            lessonVideo = parseQuestionLessonVideo(optJSONObject("lesson_video")),
            correct = optBoolean("is_correct", false),
            correctAnswer = optText("correct_answer"),
            explanation = optText("explanation"),
            aiFeedback = optText("ai_feedback", optText("feedback")),
            extractedAnswer = optText("extracted_answer"),
            detectedMisconceptionName = optJSONObject("detected_misconception")
                ?.optText("name")
                .orEmpty(),
            processGrading = StudentRecordParsers.parseProcessGrading(optJSONObject("process_grading"), BuildConfig.API_BASE_URL),
            masteryUpdate = parseMasteryUpdate(optJSONObject("mastery_update")),
            cleared = optBoolean("cleared", false),
            correctAnswerRendered = optJSONObject("correct_answer_rendered").toRenderedRichContentOrNull(),
            explanationRendered = optJSONObject("explanation_rendered").toRenderedRichContentOrNull(),
            aiFeedbackRendered = optJSONObject("ai_feedback_rendered").toRenderedRichContentOrNull(),
            extractedAnswerRendered = optJSONObject("extracted_answer_rendered").toRenderedRichContentOrNull(),
        )
    }

    private fun parseMasteryUpdate(json: JSONObject?): Map<String, MasteryUpdateValue> {
        if (json == null) return emptyMap()
        return buildMap {
            val keys = json.keys()
            while (keys.hasNext()) {
                val kpId = keys.next()
                val item = json.optJSONObject(kpId) ?: continue
                put(
                    kpId,
                    MasteryUpdateValue(
                        before = item.optDouble("before", 0.0),
                        after = item.optDouble("after", 0.0),
                        name = item.optText("name", kpId),
                    ),
                )
            }
        }
    }

    private fun JSONObject.toPracticeSession(defaultObjective: String, defaultSessionType: String): PracticeSession {
        return PracticeSession(
            objective = optText("session_objective", defaultObjective),
            sessionType = optText("session_type", defaultSessionType),
            strategy = optText("strategy"),
            teacherPaper = optJSONObject("teacher_paper")?.let(LearningCatalogParsers::parseTeacherPaper),
            questions = optJSONArray("questions").mapObjects { question -> question.toPracticeQuestion() },
            answers = optJSONObject("answers")?.let { answers ->
                answers.keys().asSequence().mapNotNull { id -> answers.optJSONObject(id)?.let { id to it.toSubmitResult() } }.toMap()
            }.orEmpty(),
        )
    }

    private fun JSONObject?.toPracticeQuestion(): PracticeQuestion {
        return parsePracticeQuestionJson(this, BuildConfig.API_BASE_URL)
    }

    private fun JSONObject.toDiagnosticFeedback(titleKey: String, fallbackTitle: String): DiagnosticFeedback {
        return DiagnosticFeedback(
            title = optText(titleKey, fallbackTitle),
            feedback = optText("feedback"),
            recommendation = optText("recommendation"),
            correctCount = optInt("correct_count", 0),
            totalCount = optInt("total_count", 0),
            masteryBefore = optDouble("mastery_before", 0.0),
            masteryAfter = optDouble("mastery_after", 0.0),
        )
    }

    private fun getLearnVideos(token: String, studentId: String, kpId: String): List<VideoItem> {
        return try {
            val json = getJson("/learn/${enc(kpId)}/videos?student_id=${enc(studentId)}", token)
            buildList {
                addVideo(json.optJSONObject("experiment"))
                json.optJSONArray("experiments").forEachObject { addVideo(it) }
                json.optJSONArray("items").forEachObject { addVideo(it) }
            }.distinctBy { it.url }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun MutableList<VideoItem>.addVideo(item: JSONObject?) {
        if (item == null) return
        val title = item.optText("title")
        val url = item.optText("url")
        if (title.isBlank() || url.isBlank()) return
        add(
            VideoItem(
                title = title,
                url = url,
                uploader = item.optText("uploader"),
                category = item.optText("category"),
            ),
        )
    }

    private fun getJson(path: String, token: String?): JSONObject {
        return readResponse(open(path, "GET", token), token)
    }

    private fun getOptionalJson(path: String, token: String): JSONObject? {
        return readOptionalResponse(open(path, "GET", token), token)
    }

    private fun getJsonArray(path: String, token: String): JSONArray {
        return readArrayResponse(open(path, "GET", token), token)
    }

    private fun postJson(path: String, body: JSONObject, token: String?): JSONObject {
        val conn = open(path, "POST", token)
        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
        conn.doOutput = true
        BufferedWriter(OutputStreamWriter(conn.outputStream, Charsets.UTF_8)).use {
            it.write(body.toString())
        }
        return readResponse(conn, token)
    }

    private fun patchJson(path: String, body: JSONObject, token: String?): JSONObject {
        val conn = open(path, improvementTaskStatusHttpMethod(), token)
        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
        conn.doOutput = true
        BufferedWriter(OutputStreamWriter(conn.outputStream, Charsets.UTF_8)).use {
            it.write(body.toString())
        }
        return readResponse(conn, token)
    }

    private fun postMultipart(path: String, payload: MultipartFormData, token: String): JSONObject {
        val conn = open(path, "POST", token)
        conn.setRequestProperty("Content-Type", payload.contentType)
        conn.setFixedLengthStreamingMode(payload.contentLength)
        conn.doOutput = true
        conn.outputStream.use { stream ->
            payload.writeTo(stream)
        }
        return readResponse(conn, token)
    }

    private fun postSseText(path: String, body: JSONObject, token: String): String {
        val conn = open(path, "POST", token)
        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
        conn.doOutput = true
        BufferedWriter(OutputStreamWriter(conn.outputStream, Charsets.UTF_8)).use {
            it.write(body.toString())
        }
        val status = conn.responseCode
        if (status !in 200..299) {
            val text = readText(conn.errorStream)
            throw httpError(status, text, token)
        }
        return BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { reader ->
            buildString {
                while (true) {
                    val line = reader.readLine() ?: break
                    if (!line.startsWith("data: ")) continue
                    val payload = line.removePrefix("data: ").trim()
                    if (payload == "[DONE]") break
                    val chunk = runCatching { JSONObject(payload).optText("content") }.getOrDefault("")
                    append(chunk)
                }
            }
        }
    }

    private fun open(path: String, method: String, token: String?): HttpURLConnection {
        val conn = URL(baseUrl + path).openConnection() as HttpURLConnection
        val timeouts = apiTimeoutsFor(path)
        conn.requestMethod = method
        conn.connectTimeout = timeouts.connectMs
        conn.readTimeout = timeouts.readMs
        conn.setRequestProperty("Accept", "application/json")
        if (!token.isNullOrBlank()) conn.setRequestProperty("Authorization", "Bearer $token")
        return conn
    }

    private fun readResponse(conn: HttpURLConnection, token: String?): JSONObject {
        val status = conn.responseCode
        val text = readText(if (status in 200..299) conn.inputStream else conn.errorStream)
        if (status !in 200..299) {
            throw httpError(status, text, token).also {
                it.captchaRequired = conn.getHeaderField("X-Login-Captcha-Required") == "true"
                it.retryAfterSeconds = conn.getHeaderField("Retry-After")?.toIntOrNull()?.coerceIn(0, 86400) ?: 0
            }
        }
        return JSONObject(text)
    }

    private fun readOptionalResponse(conn: HttpURLConnection, token: String?): JSONObject? {
        val status = conn.responseCode
        val text = readText(if (status in 200..299) conn.inputStream else conn.errorStream)
        if (status == 404) return null
        if (status !in 200..299) {
            throw httpError(status, text, token)
        }
        return JSONObject(text)
    }

    private fun readArrayResponse(conn: HttpURLConnection, token: String?): JSONArray {
        val status = conn.responseCode
        val text = readText(if (status in 200..299) conn.inputStream else conn.errorStream)
        if (status !in 200..299) {
            throw httpError(status, text, token)
        }
        return JSONArray(text)
    }

    private fun httpError(status: Int, responseBody: String, token: String?): ApiHttpException {
        notifyUnauthorized(status, token, onUnauthorized)
        return apiHttpException(status, responseBody)
    }

    private fun readText(stream: InputStream?): String {
        if (stream == null) return ""
        return BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { reader ->
            buildString {
                while (true) {
                    val line = reader.readLine() ?: break
                    append(line)
                }
            }
        }
    }

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")

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

    private fun JSONObject.toKnowledgeMasteryJudgment(): KnowledgeMasteryJudgment {
        return KnowledgeMasteryJudgment(
            kpId = optText("kp_id"),
            kpName = optText("kp_name"),
            masteryScore = optNullableDouble("mastery_score"),
            masteryLevel = optText("mastery_level"),
            interventionStatus = optText("intervention_status"),
            confidence = optText("confidence"),
            nextAction = optText("next_action"),
            reason = optText("reason"),
            evidenceSources = optJSONArray("evidence_sources").stringValues(),
            evidences = optJSONArray("evidences").mapObjects { it.toKnowledgeMasteryEvidence() },
            lastAnsweredAt = optText("last_answered_at"),
            lastDiagnosticAt = optText("last_diagnostic_at"),
            lastRetestAt = optText("last_retest_at"),
            recentCorrectCount = optInt("recent_correct_count", 0),
            recentTotalCount = optInt("recent_total_count", 0),
            recentCorrectRate = optNullableDouble("recent_correct_rate"),
            latestDiagnosticAttemptId = optText("latest_diagnostic_attempt_id"),
            latestDiagnosticCorrectCount = optNullableInt("latest_diagnostic_correct_count"),
            latestDiagnosticTotalCount = optNullableInt("latest_diagnostic_total_count"),
            latestDiagnosticIsWeak = optNullableBoolean("latest_diagnostic_is_weak"),
            activePlanId = optText("active_plan_id"),
            activeTaskId = optText("active_task_id"),
            activeTaskStatus = optText("active_task_status"),
            latestRetestAttemptId = optText("latest_retest_attempt_id"),
            latestRetestPassed = optNullableBoolean("latest_retest_passed"),
            updatedAt = optText("updated_at"),
        )
    }

    private fun JSONObject.toKnowledgeMasteryEvidence(): KnowledgeMasteryEvidence {
        return KnowledgeMasteryEvidence(
            source = optText("source"),
            weight = optDouble("weight", 0.0),
            summary = optText("summary"),
        )
    }

    private inline fun <T> JSONArray?.mapObjects(crossinline transform: (JSONObject) -> T): List<T> {
        if (this == null) return emptyList()
        return List(length()) { index -> transform(getJSONObject(index)) }
    }

    private fun JSONArray?.stringValues(): List<String> {
        if (this == null) return emptyList()
        return buildList {
            for (index in 0 until length()) {
                val value = optString(index)
                if (value.isNotBlank() && value != "null") add(value)
            }
        }
    }

    private inline fun JSONArray?.forEachObject(block: (JSONObject) -> Unit) {
        if (this == null) return
        for (index in 0 until length()) block(getJSONObject(index))
    }

    private fun JSONArray?.forEachString(block: (String) -> Unit) {
        if (this == null) return
        for (index in 0 until length()) {
            val value = optString(index)
            if (value.isNotBlank() && value != "null") block(value)
        }
    }

    private fun ScopeDiagnosticResult.toJson(): JSONObject {
        return JSONObject()
            .put("diagnostic_attempt_id", diagnosticAttemptId)
            .put("scope_type", scopeType)
            .put("scope_id", scopeId)
            .put("scope_name", scopeName)
            .put("kp_results", JSONArray().apply { kpResults.forEach { put(it.toJson()) } })
            .put("correct_count", correctCount)
            .put("total_count", totalCount)
            .put("weak_kp_ids", JSONArray().apply { weakKpIds.forEach { put(it) } })
            .put("recommendation", recommendation)
            .put("feedback", feedback)
    }

    private fun ScopeDiagnosticKpResult.toJson(): JSONObject {
        return JSONObject()
            .put("id", id)
            .put("kp_id", kpId)
            .put("kp_name", kpName)
            .put("group_id", groupId.ifBlank { JSONObject.NULL })
            .put("group_name", groupName.ifBlank { JSONObject.NULL })
            .put("correct_count", correctCount)
            .put("total_count", totalCount)
            .put("mastery_before", masteryBefore)
            .put("mastery_after", masteryAfter)
            .put("is_weak", isWeak)
    }
}
