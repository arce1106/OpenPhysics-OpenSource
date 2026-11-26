package cn.openphysics.androidapp.ui

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import cn.openphysics.androidapp.BuildConfig
import cn.openphysics.androidapp.data.api.StudentRecordParsers
import cn.openphysics.androidapp.domain.ReviewMistake
import cn.openphysics.androidapp.data.api.PaperBatchParsers
import cn.openphysics.androidapp.data.session.PrivateImageStore
import cn.openphysics.androidapp.data.api.parsePracticeQuestionJson
import cn.openphysics.androidapp.data.api.LearningCatalogParsers
import cn.openphysics.androidapp.data.api.processGradingToTutorJson
import cn.openphysics.androidapp.domain.ChapterGroup
import cn.openphysics.androidapp.domain.DirectoryData
import cn.openphysics.androidapp.domain.DirectoryRelation
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.domain.LocalImageFile
import cn.openphysics.androidapp.domain.LearningCatalogTopicLayer
import cn.openphysics.androidapp.domain.MasteryUpdateValue
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSelfReviewDraft
import cn.openphysics.androidapp.domain.PracticeSelfReviewItem
import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.domain.RenderedRichContent
import cn.openphysics.androidapp.domain.StudentSession
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.ui.draft.DraftBackgroundImage
import cn.openphysics.androidapp.ui.draft.DraftCanvasSnapshot
import cn.openphysics.androidapp.ui.draft.DraftCanvasTransform
import cn.openphysics.androidapp.ui.draft.DraftImageTransform
import cn.openphysics.androidapp.ui.draft.DraftNoPressure
import cn.openphysics.androidapp.ui.draft.DraftPoint
import cn.openphysics.androidapp.ui.draft.DraftStroke
import cn.openphysics.androidapp.ui.draft.DraftViewport
import java.io.File
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

internal data class PracticeRecoverySnapshot(
    val screen: Screen.PracticeQuestionScreen,
    val drafts: List<PracticeAnswerDraftSnapshot>,
    val completedItems: List<PracticeReviewItem>,
    val canvasSnapshots: Map<String, DraftCanvasSnapshot> = emptyMap(),
    val savedAtMs: Long = System.currentTimeMillis(),
    val reviewRetry: Screen.ReviewRetryQuestion? = null,
)

internal const val PracticeRecoveredMessage = "已恢复上次未完成的练习。"

internal class PracticeRecoveryStore(
    private val prefs: SharedPreferences,
    private val imageStore: PrivateImageStore,
) {
    constructor(context: Context) : this(
        context.getSharedPreferences(PrefsName, Context.MODE_PRIVATE),
        PrivateImageStore(context),
    )

    /**
     * Each question's strokes live in their own file (like iOS's per-question drafts), so a pen
     * stroke rewrites only that question's file instead of the whole practice. Last-written
     * snapshots are remembered per file so a full save skips canvases that did not change.
     * Called only on the recovery executor.
     */
    private val writtenCanvases = HashMap<String, DraftCanvasSnapshot>()

    fun save(snapshot: PracticeRecoverySnapshot) {
        val studentDirectory = imageStore.studentDirectory(snapshot.screen.session.studentId)
        val encoded = PracticeRecoveryCodec.encode(snapshot, studentDirectory)
        check(prefs.edit().putString(snapshotKey(snapshot.screen.session.studentId), encoded.toString()).commit()) {
            "练习保存失败，请检查设备剩余空间后重试"
        }
        val questionIds = snapshot.screen.practice.questions.map { it.id }
        questionIds.forEach { questionId -> writeCanvas(studentDirectory, questionId, snapshot.canvasSnapshots[questionId]) }
        // Strokes of questions that are no longer in the saved practice go with it.
        val keep = questionIds.mapTo(HashSet()) { PracticeCanvasFiles.fileName(it) }
        PracticeCanvasFiles.directory(studentDirectory).listFiles()?.forEach { file ->
            if (file.name !in keep) {
                file.delete()
                writtenCanvases.remove(file.path)
            }
        }
    }

    /** One stroke: rewrite only this question's canvas file. Null or blank removes it. */
    fun saveCanvas(studentId: String, questionId: String, canvas: DraftCanvasSnapshot?) {
        writeCanvas(imageStore.studentDirectory(studentId), questionId, canvas)
    }

    private fun writeCanvas(studentDirectory: File, questionId: String, canvas: DraftCanvasSnapshot?) {
        val file = PracticeCanvasFiles.file(studentDirectory, questionId)
        val blank = canvas == null || canvas.strokes.isEmpty()
        if (blank) {
            if (writtenCanvases.remove(file.path) != null || file.exists()) file.delete()
            return
        }
        if (writtenCanvases[file.path] === canvas) return
        PracticeCanvasFiles.write(file, questionId, requireNotNull(canvas))
        writtenCanvases[file.path] = canvas
    }

    fun restore(session: StudentSession): PracticeRecoverySnapshot? {
        val key = snapshotKey(session.studentId)
        val legacy = prefs.getString(SnapshotKey, null)
            ?.takeIf { runCatching { JSONObject(it).optString("student_id") == session.studentId }.getOrDefault(false) }
        val raw = prefs.getString(key, null) ?: legacy ?: return null
        val studentDirectory = imageStore.studentDirectory(session.studentId)
        val restored = PracticeRecoveryCodec.decode(raw, session, studentDirectory)?.let { saved ->
            // Per-question files are newer than strokes embedded by older app versions.
            val fromFiles = saved.screen.practice.questions.mapNotNull { question ->
                PracticeCanvasFiles.read(PracticeCanvasFiles.file(studentDirectory, question.id), question.id)
                    ?.let { question.id to it }
            }.toMap()
            saved.copy(canvasSnapshots = saved.canvasSnapshots + fromFiles)
        }
        if (restored == null) {
            prefs.edit { remove(key); if (legacy != null) remove(SnapshotKey) }
            imageStore.clearStudent(session.studentId)
        } else if (legacy != null) {
            prefs.edit(commit = true) { putString(key, raw); remove(SnapshotKey) }
        }
        return restored
    }

    fun clear(studentId: String) {
        val storedStudentId = prefs.getString(SnapshotKey, null)?.let { raw ->
            runCatching { JSONObject(raw).optString("student_id") }.getOrNull()
        }
        prefs.edit {
            remove(snapshotKey(studentId))
            if (storedStudentId == studentId) remove(SnapshotKey)
        }
        val canvasDirectory = PracticeCanvasFiles.directory(imageStore.studentDirectory(studentId)).path
        writtenCanvases.keys.removeAll { it.startsWith(canvasDirectory) }
        imageStore.clearStudent(studentId)
    }

    /**
     * The practice to reopen on launch or sign-in. A practice the student left by choice is already
     * cleared, so whatever is saved was interrupted: by Android recreating the activity, by the
     * process being killed in the background, or by an expired sign-in. Submitted paper receipts
     * resume only on recreation; otherwise they stay saved for grading reconciliation.
     */
    fun restoreVisit(session: StudentSession?, recreatedStudentId: String?): PracticeRecoverySnapshot? {
        if (session == null) return null
        val saved = restore(session) ?: return null
        if (recreatedStudentId == session.studentId) return saved
        return saved.takeIf { it.screen.practice.teacherPaper?.status !in SubmittedPaperStatuses }
    }

    fun startVisit(session: StudentSession?): Screen {
        if (session == null) return Screen.Login()
        val saved = restore(session)
        // Submitted paper receipts may still be needed to reconcile grading.
        // They never choose the startup page.
        if (saved?.screen?.practice?.teacherPaper?.status !in SubmittedPaperStatuses) {
            clear(session.studentId)
        }
        return Screen.Home(session)
    }

    private fun snapshotKey(studentId: String): String = "$SnapshotKey:${imageStore.studentDirectory(studentId).name}"

    private companion object {
        const val PrefsName = "openphysics_practice_recovery"
        const val SnapshotKey = "current_practice"
        val SubmittedPaperStatuses = setOf("grading", "completed")
    }
}

internal object PracticeRecoveryCodec {
    private const val Version = 7
    private const val MinimumSupportedVersion = 2
    private const val MaxAgeMs = 7L * 24L * 60L * 60L * 1_000L
    private const val MaxMediaBytes = 32 * 1024 * 1024
    private val MediaFilePattern = Regex("[0-9a-f]{64}\\.img")

    /** Strokes are stored per question by [PracticeRecoveryStore]; [embedCanvases] reproduces the old format. */
    fun encode(snapshot: PracticeRecoverySnapshot, studentDirectory: File, embedCanvases: Boolean = false): JSONObject {
        val screen = snapshot.screen
        val referencedMedia = mutableSetOf<String>()
        val draftJson = JSONArray().apply {
            snapshot.drafts.forEach { draft ->
                put(draft.toJson(studentDirectory, referencedMedia))
            }
        }
        val paperBatchJson = JSONArray().apply {
            screen.paperBatchImages.forEach { image ->
                val encoded = writeMedia(studentDirectory, image, referencedMedia)
                if (encoded is JSONObject) put(encoded)
            }
        }
        return JSONObject()
            .put("version", Version)
            .put("review_retry", snapshot.reviewRetry?.toRecoveryJson() ?: JSONObject.NULL)
            .put("student_id", screen.session.studentId)
            .put("saved_at_ms", snapshot.savedAtMs)
            .put("question_ids", JSONArray().apply { screen.practice.questions.forEach { put(it.id) } })
            .put("directory", screen.data.toJson())
            .put("chapter_volume", screen.chapter.volume)
            .put("chapter_name", screen.chapter.chapter)
            .put("kp_id", screen.kp.id)
            .put("practice", screen.practice.toJson())
            .put("index", screen.index)
            .put("return_to_home", screen.returnToHome)
            .put("return_to_reinforcement", screen.returnToReinforcement)
            .put("reinforcement_context", screen.reinforcementContext.toJson())
            .put("learning_catalog_context", screen.learningCatalogContext.toJson())
            .put("paper_batch_images", paperBatchJson)
            .put("paper_batch_submission", screen.paperBatchSubmission?.let {
                JSONObject().put("key", it.key).put("submission_id", it.submissionId)
            } ?: JSONObject.NULL)
            .put("drafts", draftJson)
            .put(
                "draft_canvas_snapshots",
                JSONArray().apply {
                    if (embedCanvases) snapshot.canvasSnapshots.forEach { (questionId, canvasSnapshot) ->
                        if (canvasSnapshot.strokes.isNotEmpty()) {
                            put(
                                JSONObject()
                                    .put("question_id", questionId)
                                    .put("snapshot", canvasSnapshot.toJson()),
                            )
                        }
                    }
                },
            )
            .put(
                "completed_items",
                JSONArray().apply { snapshot.completedItems.forEach { put(it.toJson()) } },
            )
    }

    fun decode(
        raw: String,
        session: StudentSession,
        studentDirectory: File,
        nowMs: Long = System.currentTimeMillis(),
    ): PracticeRecoverySnapshot? = runCatching {
        val root = JSONObject(raw)
        if (root.optInt("version") !in MinimumSupportedVersion..Version) return null
        if (root.optString("student_id") != session.studentId) return null
        val savedAtMs = root.optLong("saved_at_ms", 0L)
        if (savedAtMs <= 0L || savedAtMs > nowMs || nowMs - savedAtMs > MaxAgeMs) return null

        val directory = root.getJSONObject("directory").toDirectoryData()
        val practice = root.getJSONObject("practice").toPracticeSession()
        val expectedQuestionIds = root.optJSONArray("question_ids").strings()
        val actualQuestionIds = practice.questions.map { it.id }
        if (
            actualQuestionIds.isEmpty() || actualQuestionIds.any { it.isBlank() } ||
            actualQuestionIds.distinct().size != actualQuestionIds.size || expectedQuestionIds != actualQuestionIds
        ) {
            return null
        }
        val index = root.optInt("index", -1)
        if (index !in practice.questions.indices) return null
        val kp = directory.kps.firstOrNull { it.id == root.optString("kp_id") } ?: return null
        val chapterVolume = root.optString("chapter_volume")
        val chapterName = root.optString("chapter_name")
        val chapterKps = directory.kps.filter { it.volume == chapterVolume && it.chapter == chapterName }
        if (chapterKps.none { it.id == kp.id }) return null

        val validQuestionIds = actualQuestionIds.toSet()
        val drafts = root.optJSONArray("drafts").objects()
            .mapNotNull { it.toDraft(studentDirectory) }
            .filter { it.questionId in validQuestionIds }
            .distinctBy { it.questionId }
        val paperBatchImages = root.optJSONArray("paper_batch_images").objects()
            .mapNotNull { readMedia(studentDirectory, it) }
            .distinctBy { it.contentHash }
            .take(6)
        val paperBatchSubmission = root.optJSONObject("paper_batch_submission")?.let {
            val key = it.optString("key")
            val submissionId = it.optString("submission_id")
            if (paperBatchImages.isEmpty() || key != paperBatchSubmissionKey(actualQuestionIds, paperBatchImages) ||
                submissionId.isBlank() || submissionId.length > 128 || submissionId == "null"
            ) null else PracticePaperBatchSubmission(key, submissionId)
        }
        val questionsById = practice.questions.associateBy { it.id }
        val completedItems = root.optJSONArray("completed_items").objects().mapNotNull { item ->
            val question = questionsById[item.optString("question_id")] ?: return@mapNotNull null
            val result = PaperBatchParsers.parseSubmitResult(item.getJSONObject("result"), BuildConfig.API_BASE_URL)
            if (result.answerId == null) return@mapNotNull null
            PracticeReviewItem(question, item.optString("answer"), result)
        }.distinctBy { it.question.id }
        val canvasSnapshots = root.optJSONArray("draft_canvas_snapshots").objects()
            .mapNotNull { item ->
                val questionId = item.optString("question_id")
                if (questionId !in validQuestionIds) return@mapNotNull null
                item.optJSONObject("snapshot")?.toDraftCanvasSnapshot()?.let { questionId to it }
            }
            .distinctBy { it.first }
            .toMap()

        PracticeRecoverySnapshot(
            screen = Screen.PracticeQuestionScreen(
                session = session,
                data = directory,
                chapter = ChapterGroup(chapterVolume, chapterName, chapterKps),
                kp = kp,
                practice = practice,
                index = index,
                returnToHome = root.optBoolean("return_to_home", false),
                returnToReinforcement = root.optBoolean("return_to_reinforcement", false),
                reinforcementContext = root.optJSONObject("reinforcement_context").toReinforcementContext(),
                learningCatalogContext = root.optJSONObject("learning_catalog_context").toLearningCatalogContext(),
                paperBatchImages = paperBatchImages,
                paperBatchSubmission = paperBatchSubmission,
                submissionState = PracticeSetSubmissionState(error = PracticeRecoveredMessage),
                questionStartedAtMs = nowMs,
            ),
            drafts = drafts,
            completedItems = completedItems,
            canvasSnapshots = canvasSnapshots,
            savedAtMs = savedAtMs,
            reviewRetry = root.optJSONObject("review_retry")?.let { retry ->
                val data = StudentRecordParsers.parseReview(retry.getJSONObject("data"), BuildConfig.API_BASE_URL, false)
                val mistake = StudentRecordParsers.parseReviewMistake(retry.getJSONObject("mistake"), BuildConfig.API_BASE_URL, false)
                require(mistake.answerId > 0 && practice.questions.size == 1)
                Screen.ReviewRetryQuestion(session, data, mistake, practice.questions.single(),
                    title = retry.optString("title", "做变式题"), reason = retry.optString("reason"), retryStartedAtMs = nowMs)
            },
        )
    }.getOrNull()

    private fun Screen.ReviewRetryQuestion.toRecoveryJson(): JSONObject = JSONObject()
        .put("title", title).put("reason", reason).put("mistake", mistake.toRecoveryJson())
        .put("data", JSONObject()
            .put("clearance_progress", JSONObject().put("reviewed", data.reviewedCount).put("total", data.totalCount))
            .put("groups", JSONArray().apply {
                data.groups.forEach { group -> put(JSONObject().put("kp_id", group.kpId).put("kp_name", group.kpName)
                    .put("wrong_count", group.wrongCount).put("mistakes", JSONArray().apply {
                        group.mistakes.forEach { put(it.toRecoveryJson()) }
                    })) }
            }))

    private fun ReviewMistake.toRecoveryJson(): JSONObject = JSONObject()
        .put("answer_id", answerId).put("question_id", questionId).put("stem_text", stemText)
        .put("question_type", questionType).put("given_answer", givenAnswer).put("correct_answer", correctAnswer)
        .put("explanation", explanation).put("created_at", createdAt)
        .put("stem_rendered", stemRendered.toJsonOrNull())
        .put("correct_answer_rendered", correctAnswerRendered.toJsonOrNull())
        .put("explanation_rendered", explanationRendered.toJsonOrNull())
        .put("misconception", JSONObject().put("name", misconceptionName))
        .put("lesson_video", cn.openphysics.androidapp.data.api.questionLessonVideoJson(lessonVideo) ?: JSONObject.NULL)
        .put("process_grading", processGrading?.let(::processGradingToTutorJson) ?: JSONObject.NULL)
        .put("images", JSONArray().apply { images.forEach { put(it.toJson()) } })
        .put("options", JSONArray().apply { options.forEach { option ->
            put(JSONObject().put("label", option.label).put("text", option.text).put("text_rendered", option.textRendered.toJsonOrNull()))
        } })

    private fun PracticeAnswerDraftSnapshot.toJson(
        directory: File,
        referencedMedia: MutableSet<String>,
    ): JSONObject {
        return JSONObject()
            .put("question_id", questionId)
            .put("answer", answer)
            .put("submission_id", submissionId ?: JSONObject.NULL)
            .put("photo", writeMedia(directory, photo, referencedMedia))
            .put("handwriting", writeMedia(directory, handwriting, referencedMedia))
            .put("scratch_image", writeMedia(directory, scratchImage, referencedMedia))
            .put(
                "self_review",
                selfReview?.let { review ->
                    JSONObject()
                        .put("time_spent_ms", review.timeSpentMs)
                        .put(
                            "items",
                            JSONArray().apply {
                                review.items.forEach { item ->
                                    put(JSONObject().put("label", item.label).put("status", item.status))
                                }
                            },
                        )
                } ?: JSONObject.NULL,
            )
    }

    private fun JSONObject.toDraft(directory: File): PracticeAnswerDraftSnapshot? {
        val questionId = optString("question_id")
        if (questionId.isBlank()) return null
        val selfReview = optJSONObject("self_review")?.let { review ->
            val items = review.optJSONArray("items").objects().mapNotNull { item ->
                val label = item.optString("label")
                val status = item.optString("status")
                if (label.isBlank() || status.isBlank()) null else PracticeSelfReviewItem(label, status)
            }
            if (items.isEmpty()) null else PracticeSelfReviewDraft(items, review.optLong("time_spent_ms", 0L))
        }
        val photo = readMedia(directory, optJSONObject("photo"))
        val handwriting = readMedia(directory, optJSONObject("handwriting"))
        val scratch = readMedia(directory, optJSONObject("scratch_image"))
        return PracticeAnswerDraftSnapshot(
            questionId = questionId,
            answer = optString("answer"),
            photo = photo,
            handwriting = handwriting,
            scratchImage = scratch,
            selfReview = selfReview,
            submissionId = optString("submission_id").takeIf { it.isNotBlank() && it != "null" },
        )
    }

    internal fun encodeCanvas(canvas: DraftCanvasSnapshot): JSONObject = canvas.toJson()

    internal fun decodeCanvas(json: JSONObject): DraftCanvasSnapshot? = json.toDraftCanvasSnapshot()

    private fun DraftCanvasSnapshot.toJson(): JSONObject = JSONObject()
        .put("canvas_width", canvasWidth)
        .put("canvas_height", canvasHeight)
        .put("has_transform", hasTransform)
        .put(
            "viewport",
            JSONObject()
                .put("offset_x", transform.viewport.offsetX.toDouble())
                .put("offset_y", transform.viewport.offsetY.toDouble())
                .put("scale", transform.viewport.scale.toDouble()),
        )
        .put(
            "image_transform",
            JSONObject()
                .put("x", transform.image.x.toDouble())
                .put("y", transform.image.y.toDouble())
                .put("scale", transform.image.scale.toDouble()),
        )
        .put(
            "background_image",
            backgroundImage?.let { image ->
                JSONObject()
                    .put("image_path", image.imagePath)
                    .put("description", image.description ?: JSONObject.NULL)
                    .put("natural_width", image.naturalWidth)
                    .put("natural_height", image.naturalHeight)
                    .put("x", image.x.toDouble())
                    .put("y", image.y.toDouble())
                    .put("scale", image.scale.toDouble())
            } ?: JSONObject.NULL,
        )
        .put(
            "strokes",
            JSONArray().apply {
                strokes.forEach { stroke ->
                    put(
                        JSONObject()
                            .put("id", stroke.id)
                            .put("color", stroke.colorArgb)
                            .put("width", stroke.widthPx.toDouble())
                            .put("width_canvas", stroke.canvasWidth?.toDouble() ?: JSONObject.NULL)
                            .put(
                                "points",
                                JSONArray().apply {
                                    stroke.points.forEach { point ->
                                        put(
                                            JSONObject()
                                                .put("x", point.x.toDouble())
                                                .put("y", point.y.toDouble())
                                                .put("time_ms", point.timeMs)
                                                .put("pressure", point.pressure.toDouble())
                                                .put("tool_type", point.toolType),
                                        )
                                    }
                                },
                            ),
                    )
                }
            },
        )

    private fun JSONObject.toDraftCanvasSnapshot(): DraftCanvasSnapshot? {
        val canvasWidth = optInt("canvas_width", 0)
        val canvasHeight = optInt("canvas_height", 0)
        if (canvasWidth <= 0 || canvasHeight <= 0 || canvasWidth > MaxCanvasDimension || canvasHeight > MaxCanvasDimension) {
            return null
        }
        var remainingPoints = MaxCanvasPoints
        val strokes = optJSONArray("strokes").objects().take(MaxCanvasStrokes).mapNotNull { stroke ->
            if (remainingPoints <= 0) return@mapNotNull null
            val points = stroke.optJSONArray("points").objects().take(remainingPoints).mapNotNull { point ->
                val x = point.optDouble("x", Double.NaN)
                val y = point.optDouble("y", Double.NaN)
                val pressure = point.optDouble("pressure", Double.NaN)
                if (!x.isFinite() || !y.isFinite() || !pressure.isFinite()) return@mapNotNull null
                DraftPoint(
                    x = x.toFloat(),
                    y = y.toFloat(),
                    timeMs = point.optLong("time_ms", 0L),
                    pressure = if (pressure < 0.0) DraftNoPressure else pressure.toFloat().coerceIn(0f, 2f),
                    toolType = point.optInt("tool_type", 0),
                )
            }
            remainingPoints -= points.size
            val width = stroke.optDouble("width", Double.NaN)
            if (points.isEmpty() || !width.isFinite() || width <= 0.0) return@mapNotNull null
            DraftStroke(
                id = stroke.optLong("id", 0L),
                colorArgb = stroke.optInt("color", android.graphics.Color.BLACK),
                widthPx = width.toFloat().coerceIn(1f, 200f),
                points = points,
                canvasWidth = stroke.optDouble("width_canvas", Double.NaN)
                    .takeIf { it.isFinite() && it > 0.0 }?.toFloat()?.coerceIn(0.05f, 600f),
            )
        }
        if (strokes.isEmpty()) return null
        val viewportJson = optJSONObject("viewport")
        val imageTransformJson = optJSONObject("image_transform")
        val viewport = DraftViewport(
            offsetX = viewportJson.finiteFloat("offset_x", 0f),
            offsetY = viewportJson.finiteFloat("offset_y", 0f),
            scale = viewportJson.finiteFloat("scale", 1f).coerceIn(0.1f, 6f),
        )
        val imageTransform = DraftImageTransform(
            x = imageTransformJson.finiteFloat("x", 0f),
            y = imageTransformJson.finiteFloat("y", 0f),
            scale = imageTransformJson.finiteFloat("scale", 1f).coerceIn(0.1f, 6f),
        )
        val background = optJSONObject("background_image")?.let { image ->
            val imagePath = image.optString("image_path")
            val naturalWidth = image.optInt("natural_width", 0)
            val naturalHeight = image.optInt("natural_height", 0)
            if (imagePath.isBlank() || naturalWidth <= 0 || naturalHeight <= 0) return@let null
            DraftBackgroundImage(
                imagePath = imagePath,
                description = image.optString("description").takeIf { it.isNotBlank() && it != "null" },
                naturalWidth = naturalWidth,
                naturalHeight = naturalHeight,
                x = image.finiteFloat("x", imageTransform.x),
                y = image.finiteFloat("y", imageTransform.y),
                scale = image.finiteFloat("scale", imageTransform.scale).coerceIn(0.1f, 6f),
            )
        }
        return DraftCanvasSnapshot(
            strokes = strokes,
            transform = DraftCanvasTransform(viewport = viewport, image = imageTransform),
            hasTransform = optBoolean("has_transform", true),
            canvasWidth = canvasWidth,
            canvasHeight = canvasHeight,
            backgroundImage = background,
        )
    }

    private fun JSONObject?.finiteFloat(name: String, fallback: Float): Float {
        val value = this?.optDouble(name, Double.NaN) ?: Double.NaN
        return if (value.isFinite()) value.toFloat() else fallback
    }

    private fun writeMedia(
        directory: File,
        image: LocalImageFile?,
        referencedMedia: MutableSet<String>,
    ): Any {
        if (image == null || !isValidMedia(directory, image)) {
            return JSONObject.NULL
        }
        val fileName = image.asFile().name
        referencedMedia += fileName
        return JSONObject()
            .put("file", fileName)
            .put("mime_type", image.mimeType)
            .put("upload_name", image.fileName)
            .put("content_hash", image.contentHash)
            .put("size", image.sizeBytes)
    }

    private fun readMedia(directory: File, json: JSONObject?): LocalImageFile? {
        val value = json ?: return null
        val fileName = value.optString("file")
        val mimeType = value.optString("mime_type")
        val uploadName = value.optString("upload_name")
        val contentHash = value.optString("content_hash")
        val expectedSize = value.optLong("size", -1L)
        if (
            !MediaFilePattern.matches(fileName) || !mimeType.startsWith("image/") ||
            uploadName.isBlank() || contentHash.length != 64 || fileName != "$contentHash.img" ||
            expectedSize !in 1..MaxMediaBytes.toLong()
        ) {
            return null
        }
        val file = File(directory, fileName)
        val image = LocalImageFile(file.absolutePath, mimeType, uploadName, contentHash, expectedSize)
        return image.takeIf { isValidMedia(directory, it) }
    }

    private fun isValidMedia(directory: File, image: LocalImageFile): Boolean {
        val file = image.asFile()
        val inside = runCatching {
            val parentPath = directory.canonicalFile.path.trimEnd(File.separatorChar) + File.separator
            file.canonicalFile.path.startsWith(parentPath)
        }.getOrDefault(false)
        if (!inside || !file.isFile || file.length() != image.sizeBytes) return false
        if (image.sizeBytes !in 1..MaxMediaBytes.toLong() || !image.mimeType.startsWith("image/")) return false
        if (!MediaFilePattern.matches(file.name) || file.name != "${image.contentHash}.img") return false
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) } == image.contentHash
    }

    private const val MaxCanvasDimension = 12_000
    private const val MaxCanvasStrokes = 2_000
    private const val MaxCanvasPoints = 60_000

    private fun DirectoryData.toJson(): JSONObject = JSONObject()
        .put("mastered", mastered)
        .put("in_progress", inProgress)
        .put("total", total)
        .put("kps", JSONArray().apply { kps.forEach { put(it.toJson()) } })
        .put("relations", JSONArray().apply { relations.forEach { put(it.toJson()) } })

    private fun JSONObject.toDirectoryData(): DirectoryData = DirectoryData(
        kps = optJSONArray("kps").objects().map { it.toKpNode() },
        mastered = optInt("mastered", 0),
        inProgress = optInt("in_progress", 0),
        total = optInt("total", 0),
        relations = optJSONArray("relations").objects().map { it.toDirectoryRelation() },
    )

    private fun KpNode.toJson(): JSONObject = JSONObject()
        .put("id", id).put("name", name).put("volume", volume).put("chapter", chapter)
        .put("section", section).put("mastery", mastery).put("status", status)
        .put("last_practiced", lastPracticed).put("learning_state", learningState)
        .put("learning_state_label", learningStateLabel).put("learning_state_tone", learningStateTone)

    private fun JSONObject.toKpNode(): KpNode = KpNode(
        id = optString("id"), name = optString("name"), volume = optString("volume"),
        chapter = optString("chapter"), section = optString("section"), mastery = optDouble("mastery", 0.0),
        status = optString("status"), lastPracticed = optString("last_practiced"),
        learningState = optString("learning_state"), learningStateLabel = optString("learning_state_label"),
        learningStateTone = optString("learning_state_tone"),
    )

    private fun DirectoryRelation.toJson(): JSONObject = JSONObject()
        .put("id", id).put("source_id", sourceId).put("target_id", targetId)
        .put("relation_type", relationType).put("reason", reason)

    private fun JSONObject.toDirectoryRelation(): DirectoryRelation = DirectoryRelation(
        id = optInt("id", 0), sourceId = optString("source_id"), targetId = optString("target_id"),
        relationType = optString("relation_type"), reason = optString("reason"),
    )

    private fun PracticeSession.toJson(): JSONObject = JSONObject()
        .put("session_objective", objective).put("session_type", sessionType).put("strategy", strategy)
        .put("teacher_paper", teacherPaper?.let(LearningCatalogParsers::teacherPaperJson) ?: JSONObject.NULL)
        .put("answers", JSONObject().apply { answers.forEach { (id, result) -> put(id, result.toJson()) } })
        .put("questions", JSONArray().apply { questions.forEach { put(it.toJson()) } })

    private fun JSONObject.toPracticeSession(): PracticeSession = PracticeSession(
        objective = optString("session_objective"), sessionType = optString("session_type"),
        strategy = optString("strategy"),
        teacherPaper = optJSONObject("teacher_paper")?.let(LearningCatalogParsers::parseTeacherPaper),
        questions = optJSONArray("questions").objects().map { parsePracticeQuestionJson(it) },
        answers = optJSONObject("answers")?.let { entries -> entries.keys().asSequence()
            .mapNotNull { id -> entries.optJSONObject(id)?.let { id to PaperBatchParsers.parseSubmitResult(it, BuildConfig.API_BASE_URL) } }.toMap() }.orEmpty(),
    )

    private fun PracticeQuestion.toJson(): JSONObject = JSONObject()
        .put("id", id).put("stem", stem).put("question_type", questionType)
        .put("target_knowledge_point_id", targetKnowledgePointId)
        .put("lesson_video", cn.openphysics.androidapp.data.api.questionLessonVideoJson(lessonVideo) ?: JSONObject.NULL)
        .put(
            "options",
            JSONArray().apply {
                options.forEach { option ->
                    put(
                        JSONObject().put("label", option.label).put("text", option.text)
                            .put("rendered", option.rendered.toJsonOrNull())
                            .put("text_rendered", option.textRendered.toJsonOrNull()),
                    )
                }
            },
        )
        .put("images", JSONArray().apply { images.forEach { put(it.toJson()) } })
        .put("correct_answer", correctAnswer).put("explanation", explanation)
        .put("stem_rendered", stemRendered.toJsonOrNull())
        .put("correct_answer_rendered", correctAnswerRendered.toJsonOrNull())
        .put("explanation_rendered", explanationRendered.toJsonOrNull())

    private fun QuestionImage.toJson(): JSONObject = JSONObject()
        .put("id", id).put("image_path", imagePath.ifBlank { imageUrl })
        .put("image_type", imageType).put("description", description)

    private fun RenderedRichContent?.toJsonOrNull(): Any = this?.let { rendered ->
        JSONObject().put("html", rendered.html).put("plain_text", rendered.plainText)
            .put("renderer", rendered.renderer).put("renderer_version", rendered.rendererVersion)
            .put("content_hash", rendered.contentHash).put("has_math", rendered.hasMath)
            .put("has_image", rendered.hasImage).put("has_markdown_table", rendered.hasMarkdownTable)
            .put(
                "errors",
                JSONArray().apply {
                    rendered.errors.forEach { error ->
                        put(
                            JSONObject().put("type", error.type).put("message", error.message)
                                .put("latex", error.latex).put("position", error.position ?: JSONObject.NULL),
                        )
                    }
                },
            )
    } ?: JSONObject.NULL

    private fun PracticeReviewItem.toJson(): JSONObject = JSONObject()
        .put("question_id", question.id).put("answer", answer).put("result", result.toJson())

    private fun SubmitResult.toJson(): JSONObject = JSONObject()
        .put("answer_id", answerId ?: JSONObject.NULL).put("is_correct", correct)
        .put("given_answer", givenAnswer)
        .put("lesson_video", cn.openphysics.androidapp.data.api.questionLessonVideoJson(lessonVideo) ?: JSONObject.NULL)
        .put("correct_answer", correctAnswer).put("explanation", explanation).put("ai_feedback", aiFeedback)
        .put("extracted_answer", extractedAnswer)
        .put("process_grading", processGrading?.let(::processGradingToTutorJson) ?: JSONObject.NULL)
        .put(
            "mastery_update",
            JSONObject().apply {
                masteryUpdate.forEach { (kpId, value) -> put(kpId, value.toJson()) }
            },
        )
        .put("cleared", cleared).put("correct_answer_rendered", correctAnswerRendered.toJsonOrNull())
        .put("explanation_rendered", explanationRendered.toJsonOrNull())
        .put("ai_feedback_rendered", aiFeedbackRendered.toJsonOrNull())
        .put("extracted_answer_rendered", extractedAnswerRendered.toJsonOrNull())

    private fun MasteryUpdateValue.toJson(): JSONObject = JSONObject()
        .put("before", before).put("after", after).put("name", name)

    private fun ReinforcementPracticeContext?.toJson(): Any = when (this) {
        is ReinforcementPracticeContext.ScopeDiagnostic -> JSONObject()
            .put("type", "scope_diagnostic").put("scope_type", scopeType)
            .put("scope_id", scopeId).put("scope_name", scopeName)
        is ReinforcementPracticeContext.TaskPractice -> JSONObject()
            .put("type", "task_practice").put("plan_id", planId).put("task_id", taskId)
        is ReinforcementPracticeContext.Retest -> JSONObject()
            .put("type", "retest").put("plan_id", planId).put("attempt_id", attemptId)
        null -> JSONObject.NULL
    }

    private fun JSONObject?.toReinforcementContext(): ReinforcementPracticeContext? = when (this?.optString("type")) {
        "scope_diagnostic" -> ReinforcementPracticeContext.ScopeDiagnostic(
            scopeType = optString("scope_type"), scopeId = optString("scope_id"), scopeName = optString("scope_name"),
        )
        "task_practice" -> ReinforcementPracticeContext.TaskPractice(
            planId = optString("plan_id"), taskId = optString("task_id"),
        )
        "retest" -> ReinforcementPracticeContext.Retest(
            planId = optString("plan_id"), attemptId = optString("attempt_id"),
        )
        else -> null
    }

    private fun LearningCatalogPracticeContext?.toJson(): Any = this?.let { context ->
        JSONObject()
            .put("catalog_code", context.catalogCode)
            .put("node_id", context.nodeId)
            .put("topic_title", context.topicTitle)
            .put("layer", context.layer.apiValue)

            .put("homework_attempt_id", context.homeworkAttemptId)
    } ?: JSONObject.NULL

    private fun JSONObject?.toLearningCatalogContext(): LearningCatalogPracticeContext? {
        if (this == null) return null
        val catalogCode = optString("catalog_code")
        val nodeId = optString("node_id")
        val topicTitle = optString("topic_title")
        val layer = optString("layer")
        if (catalogCode.isBlank() || nodeId.isBlank() || topicTitle.isBlank() || layer.isBlank()) return null
        return LearningCatalogPracticeContext(
            catalogCode = catalogCode,
            nodeId = nodeId,
            topicTitle = topicTitle,
            layer = LearningCatalogTopicLayer.fromApi(layer),

            homeworkAttemptId = optString("homework_attempt_id", ""),
        )
    }

    private fun JSONArray?.objects(): List<JSONObject> {
        if (this == null) return emptyList()
        return buildList { for (index in 0 until length()) optJSONObject(index)?.let(::add) }
    }

    private fun JSONArray?.strings(): List<String> {
        if (this == null) return emptyList()
        return buildList { for (index in 0 until length()) add(optString(index)) }
    }

}

/** Per-question stroke files inside the student's private directory. */
internal object PracticeCanvasFiles {
    fun directory(studentDirectory: File): File = File(studentDirectory, "canvas")

    // Question ids come from the server; hash them into safe, fixed-length file names.
    fun fileName(questionId: String): String =
        MessageDigest.getInstance("SHA-256").digest(questionId.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) } + ".json"

    fun file(studentDirectory: File, questionId: String): File = File(directory(studentDirectory), fileName(questionId))

    /** Written to a temporary file first, so a process killed mid-write keeps the previous strokes. */
    fun write(file: File, questionId: String, canvas: DraftCanvasSnapshot) {
        file.parentFile?.mkdirs()
        val json = JSONObject().put("question_id", questionId).put("snapshot", PracticeRecoveryCodec.encodeCanvas(canvas))
        val temporary = File(file.parentFile, file.name + ".tmp")
        java.io.FileOutputStream(temporary).use { output ->
            output.write(json.toString().toByteArray(Charsets.UTF_8))
            output.fd.sync()
        }
        check(temporary.renameTo(file)) { "草稿保存失败，请检查设备剩余空间后重试" }
    }

    fun read(file: File, questionId: String): DraftCanvasSnapshot? = runCatching {
        if (!file.isFile) return null
        val json = JSONObject(file.readText(Charsets.UTF_8))
        if (json.optString("question_id") != questionId) return null
        json.optJSONObject("snapshot")?.let(PracticeRecoveryCodec::decodeCanvas)
    }.getOrNull()
}
