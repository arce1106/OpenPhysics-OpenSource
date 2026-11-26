package cn.openphysics.androidapp.ui

import android.content.SharedPreferences
import cn.openphysics.androidapp.data.session.PrivateImageStore
import cn.openphysics.androidapp.domain.ChapterGroup
import cn.openphysics.androidapp.domain.DirectoryData
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.domain.LocalImageFile
import cn.openphysics.androidapp.domain.LearningCatalogTopicLayer
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSelfReviewDraft
import cn.openphysics.androidapp.domain.PracticeSelfReviewItem
import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.PracticeSessionTypes
import cn.openphysics.androidapp.domain.TeacherPaper
import cn.openphysics.androidapp.domain.RenderedRichContent
import cn.openphysics.androidapp.domain.StudentSession
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.ui.draft.DraftCanvasSnapshot
import cn.openphysics.androidapp.ui.draft.DraftCanvasTransform
import cn.openphysics.androidapp.ui.draft.DraftPoint
import cn.openphysics.androidapp.ui.draft.DraftStroke
import cn.openphysics.androidapp.ui.draft.DraftViewport
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PracticeRecoveryStoreTest {
    @Test
    fun `camera process recreation restores question drafts photos and submission identity`() = withTempDirectory { root ->
        val prefs = MemoryPreferences()
        val images = PrivateImageStore(root)
        val original = practiceScreen()
        val photo = images.save(original.session.studentId, byteArrayOf(1, 2, 3), "image/jpeg", "answer.jpg")
        PracticeRecoveryStore(prefs, images).save(PracticeRecoverySnapshot(original,
            listOf(PracticeAnswerDraftSnapshot("q-1", "A", photo = photo, submissionId = "same-request")), emptyList()))
        // A new store represents a new process.
        val recreated = PracticeRecoveryStore(prefs, PrivateImageStore(root))
        val restored = recreated.restoreVisit(original.session, original.session.studentId)!!
        assertEquals(original.index, restored.screen.index)
        assertEquals(original.practice.questions.map { it.id }, restored.screen.practice.questions.map { it.id })
        assertEquals("A", restored.drafts.single().answer)
        assertEquals("same-request", restored.drafts.single().submissionId)
        assertTrue(restored.drafts.single().photo!!.asFile().exists())
        assertNull(recreated.restoreVisit(null, original.session.studentId))
        assertEquals(Screen.Home(original.session), recreated.startVisit(original.session))
        assertNull(recreated.restore(original.session))
    }

    @Test
    fun `review variation camera recovery retains its original mistake and draft`() = withTempDirectory { root ->
        val base = practiceScreen().let { it.copy(index = 0, practice = it.practice.copy(questions = it.practice.questions.take(1))) }
        val mistake = cn.openphysics.androidapp.domain.ReviewMistake(answerId = 88, questionId = "original",
            stemText = "原错题", questionType = "single_choice", options = emptyList(), images = emptyList(),
            givenAnswer = "A", correctAnswer = "B", explanation = "解析", misconceptionName = "受力分析", createdAt = "today")
        val data = cn.openphysics.androidapp.domain.ReviewData(listOf(
            cn.openphysics.androidapp.domain.ReviewGroup("kp-1", "质点", 1, listOf(mistake))), 0, 1)
        val retry = Screen.ReviewRetryQuestion(base.session, data, mistake, base.practice.questions.single(), reason = "同类练习")
        val store = PracticeRecoveryStore(MemoryPreferences(), PrivateImageStore(root))
        store.save(PracticeRecoverySnapshot(base, listOf(PracticeAnswerDraftSnapshot("q-1", "B")), emptyList(), reviewRetry = retry))
        val restored = store.restoreVisit(base.session, base.session.studentId)!!
        assertEquals(88, restored.reviewRetry!!.mistake.answerId)
        assertEquals("q-1", restored.reviewRetry!!.question.id)
        assertEquals("同类练习", restored.reviewRetry!!.reason)
        assertEquals("B", restored.drafts.single().answer)
        assertEquals(1, restored.reviewRetry!!.data.totalCount)
    }

    @Test
    fun `a killed process or expired sign-in resumes this student's unfinished practice`() = withTempDirectory { root ->
        val prefs = MemoryPreferences()
        val images = PrivateImageStore(root)
        val original = practiceScreen()
        val other = original.copy(session = original.session.copy(studentId = "student-2"))
        val photo = images.save(original.session.studentId, byteArrayOf(4, 5), "image/jpeg", "answer.jpg")
        PracticeRecoveryStore(prefs, images).save(PracticeRecoverySnapshot(original,
            listOf(PracticeAnswerDraftSnapshot("q-1", "A", photo = photo)), emptyList()))

        // No saved activity state: the OEM killed the task, or the student signed in again.
        val relaunched = PracticeRecoveryStore(prefs, PrivateImageStore(root))
        val restored = relaunched.restoreVisit(original.session, recreatedStudentId = null)!!
        assertEquals(original.index, restored.screen.index)
        assertEquals("A", restored.drafts.single().answer)
        assertTrue(restored.drafts.single().photo!!.asFile().exists())
        assertNull(relaunched.restoreVisit(other.session, recreatedStudentId = null))
        assertNotNull(relaunched.restore(original.session))
    }

    @Test
    fun `a fresh launch keeps submitted paper receipts closed but recreation reopens them`() = withTempDirectory { root ->
        val store = PracticeRecoveryStore(MemoryPreferences(), PrivateImageStore(root))
        val base = practiceScreen()
        val paper = TeacherPaper("fixed", "运动", 2, attemptId = "submitted-attempt", status = "grading")
        store.save(PracticeRecoverySnapshot(base.copy(practice = base.practice.copy(teacherPaper = paper)), emptyList(), emptyList()))

        assertNull(store.restoreVisit(base.session, recreatedStudentId = null))
        assertNotNull(store.restoreVisit(base.session, base.session.studentId))
        assertEquals(Screen.Home(base.session), store.startVisit(base.session))
        assertNotNull(store.restore(base.session))
    }

    @Test
    fun `a resumed practice opens at the next unanswered question`() {
        val base = practiceScreen().copy(index = 0)
        val questions = base.practice.questions
        val answered = PracticeReviewItem(questions[0], "A", SubmitResult(7, true, "A", "解析", ""))
        val resumed = resumedPracticeScreen(PracticeRecoverySnapshot(base, emptyList(), listOf(answered)))
        assertEquals(1, (resumed as Screen.PracticeQuestionScreen).index)

        val ids = questions.map { it.id }
        assertEquals(1, practiceResumeIndex(questions, setOf(ids[0]), 0))
        assertEquals(0, practiceResumeIndex(questions, setOf(ids[1]), 1))
        assertEquals(1, practiceResumeIndex(questions, ids.toSet(), 1))
        assertEquals(1, practiceResumeIndex(questions, emptySet(), 5))
        assertEquals(0, practiceResumeIndex(emptyList(), emptySet(), 3))
    }

    @Test
    fun `a fully answered practice reopens its last result instead of a spent question`() {
        val base = practiceScreen().copy(index = 0)
        val questions = base.practice.questions
        val items = questions.mapIndexed { index, question ->
            PracticeReviewItem(question, "A", SubmitResult(index + 1, true, "A", "解析", ""))
        }
        val resumed = resumedPracticeScreen(PracticeRecoverySnapshot(base, emptyList(), items))
        resumed as Screen.PracticeResultScreen
        assertEquals(questions.lastIndex, resumed.index)
        assertEquals(questions.last().id, resumed.question.id)
        assertFalse(resumed.openedFromSummary)

        // A KP diagnostic still needs every receipt, so it stays on the question to retry.
        val diagnostic = base.copy(practice = base.practice.copy(sessionType = PracticeSessionTypes.KpDiagnostic))
        val unsaved = items.map { it.copy(result = it.result.copy(answerId = null)) }
        assertTrue(resumedPracticeScreen(PracticeRecoverySnapshot(diagnostic, emptyList(), unsaved)) is Screen.PracticeQuestionScreen)
    }

    @Test
    fun `tutor requests outlive a token renewal`() {
        val practice = practiceScreen()
        val question = practice.practice.questions.first()
        val result = Screen.PracticeResultScreen(practice.session, practice.data, practice.chapter, practice.kp, practice.practice,
            0, question, "A", SubmitResult(7, true, "A", "解析", ""))
        val renewed = result.withStudentSession(practice.session.copy(token = "renewed"))
        assertEquals(result.tutorOwner(), renewed.tutorOwner())
    }

    @Test
    fun `start visit opens home and discards only this student's unfinished work`() = withTempDirectory { root ->
        val images = PrivateImageStore(root)
        val store = PracticeRecoveryStore(MemoryPreferences(), images)
        val first = practiceScreen()
        val second = first.copy(session = first.session.copy(studentId = "student-2"))
        val photo = images.save(first.session.studentId, byteArrayOf(1, 2), "image/jpeg", "answer.jpg")
        store.save(PracticeRecoverySnapshot(first, listOf(PracticeAnswerDraftSnapshot("q-1", "A", photo = photo)), emptyList()))
        store.save(PracticeRecoverySnapshot(second, emptyList(), emptyList()))

        assertEquals(Screen.Home(first.session), store.startVisit(first.session))
        assertNull(store.restore(first.session))
        assertFalse(File(photo.path).exists())
        assertNotNull(store.restore(second.session))
        assertEquals(Screen.Home(first.session), store.startVisit(first.session))
    }

    @Test
    fun `fresh visit keeps submitted paper receipts without opening the paper`() = withTempDirectory { root ->
        val store = PracticeRecoveryStore(MemoryPreferences(), PrivateImageStore(root))
        val base = practiceScreen()
        val paper = TeacherPaper("fixed", "运动", 2, attemptId = "submitted-attempt", status = "grading")
        val practice = base.copy(practice = base.practice.copy(teacherPaper = paper))
        val completed = listOf(PracticeReviewItem(base.practice.questions[0], "A", SubmitResult(42, true, "A", "解析", "")))
        store.save(PracticeRecoverySnapshot(practice, emptyList(), completed))

        assertEquals(Screen.Home(base.session), store.startVisit(base.session))
        assertEquals(42, store.restore(base.session)?.completedItems?.single()?.result?.answerId)
        assertTrue(store.startVisit(null) is Screen.Login)
    }

    @Test
    fun `exiting unfinished work needs confirmation but submitted work does not`() {
        val practice = practiceScreen().practice
        assertTrue(practiceExitNeedsConfirmation(practice, pendingQuestionCount = 2))
        assertTrue(practiceExitNeedsConfirmation(practice, pendingQuestionCount = 1))
        assertFalse(practiceExitNeedsConfirmation(practice, pendingQuestionCount = 0))
        for (status in listOf("grading", "completed")) {
            val paper = TeacherPaper("fixed", "运动", 2, attemptId = "submitted-attempt", status = status)
            assertFalse(practiceExitNeedsConfirmation(practice.copy(teacherPaper = paper), pendingQuestionCount = 1))
        }
    }

    @Test
    fun `completed fixed paper recovers to result while partial submission stays retryable`() {
        val base = practiceScreen()
        val paper = TeacherPaper("fixed", "运动", base.practice.questions.size, attemptId = "attempt-1", status = "grading")
        val screen = base.copy(practice = base.practice.copy(teacherPaper = paper))
        val completed = screen.practice.questions.map { PracticeReviewItem(it, "A", SubmitResult(10, false, "B", "解析", "")) }
        val snapshot = PracticeRecoverySnapshot(screen, emptyList(), completed)
        val recovered = restoredTeacherPaperScreen(snapshot) as Screen.PracticeReviewScreen
        assertEquals("completed", recovered.practice.teacherPaper?.status)
        assertEquals(screen.practice.questions.map { it.id }, recovered.review.items.map { it.question.id })
        assertEquals("A", recovered.review.items.first().answer)
        assertEquals(screen, restoredTeacherPaperScreen(snapshot.copy(completedItems = completed.take(1))))
    }

    @Test
    fun `reauthentication restores only that student and does not delete another student's saved work`() = withTempDirectory { mediaRoot ->
        val imageStore = PrivateImageStore(mediaRoot)
        val store = PracticeRecoveryStore(MemoryPreferences(), imageStore)
        val firstSession = session()
        val secondSession = firstSession.copy(studentId = "student-2", token = "other-token")
        val firstImage = imageStore.save(firstSession.studentId, byteArrayOf(1, 2), "image/jpeg", "answer.jpg")
        store.save(PracticeRecoverySnapshot(
            practiceScreen(),
            listOf(PracticeAnswerDraftSnapshot("q-1", "[图片作答]", photo = firstImage, submissionId = "original-submit")),
            emptyList(),
        ))

        assertNull(store.restore(secondSession))
        assertTrue(firstImage.asFile().exists())
        store.save(PracticeRecoverySnapshot(
            practiceScreen().copy(session = secondSession),
            listOf(PracticeAnswerDraftSnapshot("q-1", "B")),
            emptyList(),
        ))
        val restored = store.restore(firstSession.copy(token = "refreshed-token"))!!
        assertEquals("refreshed-token", restored.screen.session.token)
        assertEquals(firstImage.path, restored.drafts.single().photo?.path)
        assertEquals("original-submit", restored.drafts.single().submissionId)
        assertEquals("B", store.restore(secondSession)?.drafts?.single()?.answer)
        store.clear(secondSession.studentId)
        assertNotNull(store.restore(firstSession))
        assertTrue(firstImage.asFile().exists())
    }

    @Test
    fun `paper submission identity survives process recovery but cannot attach to changed photos`() = withTempDirectory { mediaRoot ->
        val images = listOf(privateImage(mediaRoot, byteArrayOf(4, 5, 6)))
        val screen = practiceScreen().copy(paperBatchImages = images)
        val key = paperBatchSubmissionKey(screen.practice.questions.map { it.id }, images)
        val identity = PracticePaperBatchSubmission.forImages(null, key)
        val snapshot = PracticeRecoverySnapshot(screen.copy(paperBatchSubmission = identity), emptyList(), emptyList(), savedAtMs = 1000L)
        val encoded = PracticeRecoveryCodec.encode(snapshot, mediaRoot)
        val restored = PracticeRecoveryCodec.decode(encoded.toString(), session(), mediaRoot, nowMs = 2000L)!!

        assertEquals(identity, restored.screen.paperBatchSubmission)
        assertEquals(identity, PracticePaperBatchSubmission.forImages(restored.screen.paperBatchSubmission, key))
        assertEquals(identity.submissionId, PracticePaperBatchSubmission.forImages(identity, "different-photo-key").submissionId)
        encoded.getJSONObject("paper_batch_submission").put("key", "foreign-key")
        assertNull(PracticeRecoveryCodec.decode(encoded.toString(), session(), mediaRoot, nowMs = 2000L)?.screen?.paperBatchSubmission)
    }

    @Test
    fun `round trip preserves gaokao topic context`() = withTempDirectory { mediaRoot ->
        val paper = TeacherPaper("synthetic_homework", "运动", 10, true, "signed-attempt", "permanent-attempt", "completed", "submitted", "completed")
        val context = LearningCatalogPracticeContext(
            catalogCode = "gaokao_review",
            nodeId = "topic-1",
            topicTitle = "运动描述",
            layer = LearningCatalogTopicLayer.Diagnostic,
        )
        val encoded = PracticeRecoveryCodec.encode(
            PracticeRecoverySnapshot(
                screen = practiceScreen().let { it.copy(learningCatalogContext = context, practice = it.practice.copy(teacherPaper = paper, answers = mapOf("q-1" to SubmitResult(11, false, "B", "解析", "", givenAnswer = "A")))) },
                drafts = emptyList(),
                completedItems = emptyList(),
                savedAtMs = 1_000L,
            ),
            mediaRoot,
        )

        val restored = PracticeRecoveryCodec.decode(encoded.toString(), session(), mediaRoot, nowMs = 2_000L)

        assertEquals(context, restored?.screen?.learningCatalogContext)
        assertEquals(paper, restored?.screen?.practice?.teacherPaper)
        assertEquals("A", restored?.screen?.practice?.answers?.get("q-1")?.givenAnswer)
    }

    @Test
    fun `round trip keeps teacher homework apart from gaokao topics`() = withTempDirectory { mediaRoot ->
        val context = LearningCatalogPracticeContext(
            catalogCode = "teacher_homework",
            nodeId = "attempt-1",
            topicTitle = "第一章个性化作业",
            layer = LearningCatalogTopicLayer.Paper,
            homeworkAttemptId = "attempt-1",
        )
        val encoded = PracticeRecoveryCodec.encode(
            PracticeRecoverySnapshot(practiceScreen().copy(learningCatalogContext = context), emptyList(), emptyList(), savedAtMs = 1_000L),
            mediaRoot,
        )

        val restored = PracticeRecoveryCodec.decode(encoded.toString(), session(), mediaRoot, nowMs = 2_000L)

        assertEquals(context, restored?.screen?.learningCatalogContext)
        assertTrue(restored?.screen?.learningCatalogContext?.isTeacherHomework == true)
    }

    @Test
    fun `saves from older versions with strokes inside the practice still restore`() = withTempDirectory { mediaRoot ->
        val canvasSnapshot = DraftCanvasSnapshot(
            strokes = listOf(
                DraftStroke(
                    id = 7L,
                    colorArgb = 0xFF0F172A.toInt(),
                    widthPx = 5f,
                    points = listOf(
                        DraftPoint(12f, 18f, 1_000L, 0.45f, 2),
                        DraftPoint(24f, 32f, 1_016L, 0.62f, 2),
                    ),
                    canvasWidth = 4f,
                ),
            ),
            transform = DraftCanvasTransform(viewport = DraftViewport(10f, 20f, 1.25f)),
            hasTransform = true,
            canvasWidth = 1200,
            canvasHeight = 800,
        )
        val encoded = PracticeRecoveryCodec.encode(
            PracticeRecoverySnapshot(
                screen = practiceScreen(),
                drafts = emptyList(),
                completedItems = emptyList(),
                canvasSnapshots = mapOf("q-1" to canvasSnapshot),
                savedAtMs = 1_000L,
            ),
            mediaRoot,
            embedCanvases = true,
        )

        val restored = PracticeRecoveryCodec.decode(encoded.toString(), session(), mediaRoot, nowMs = 2_000L)
        val restoredCanvas = restored?.canvasSnapshots?.get("q-1")

        assertNotNull(restoredCanvas)
        assertEquals(7L, restoredCanvas?.strokes?.single()?.id)
        assertEquals(4f, restoredCanvas?.strokes?.single()?.canvasWidth ?: 0f, 0.001f)
        assertEquals(0.62f, restoredCanvas?.strokes?.single()?.points?.last()?.pressure ?: 0f, 0.001f)
        assertEquals(1.25f, restoredCanvas?.transform?.viewport?.scale ?: 0f, 0.001f)
        assertEquals(1200, restoredCanvas?.canvasWidth)
    }

    @Test
    fun `round trip restores practice drafts private media and confirmed results`() = withTempDirectory { mediaRoot ->
        val screen = practiceScreen()
        val snapshot = PracticeRecoverySnapshot(
            screen = screen,
            drafts = listOf(
                PracticeAnswerDraftSnapshot(
                    questionId = "q-1",
                    answer = "[图片作答]",
                    photo = privateImage(mediaRoot, byteArrayOf(1, 2, 3)),
                    submissionId = "submission-1",
                ),
                PracticeAnswerDraftSnapshot(
                    questionId = "q-2",
                    answer = "[自评作答]",
                    selfReview = PracticeSelfReviewDraft(
                        items = listOf(PracticeSelfReviewItem("整题", "partial")),
                    ),
                ),
            ),
            completedItems = listOf(
                PracticeReviewItem(
                    question = screen.practice.questions[0],
                    answer = "[图片作答]",
                    result = SubmitResult(
                        answerId = 42,
                        correct = true,
                        correctAnswer = "A",
                        explanation = "解析",
                        aiFeedback = "很好",
                    ),
                ),
            ),
            savedAtMs = 1_000L,
        )

        val encoded = PracticeRecoveryCodec.encode(snapshot, mediaRoot)
        val restored = PracticeRecoveryCodec.decode(encoded.toString(), session(), mediaRoot, nowMs = 2_000L)

        assertNotNull(restored)
        val restoredSnapshot = restored ?: error("snapshot should restore")
        assertEquals(1, restoredSnapshot.screen.index)
        assertEquals("含公式", restoredSnapshot.screen.practice.questions.first().stemRendered?.plainText)
        assertEquals(3L, restoredSnapshot.drafts.first().photo?.sizeBytes)
        assertEquals("submission-1", restoredSnapshot.drafts.first().submissionId)
        assertEquals(42, restoredSnapshot.completedItems.single().result.answerId)

        val drafts = PracticeAnswerDrafts().apply { restore(restoredSnapshot.drafts) }
        val review = PracticeReviewState().apply { restore(restoredSnapshot.completedItems) }
        assertEquals("submission-1", drafts.submissionId("q-1"))
        assertEquals(listOf("q-2"), review.pendingQuestions(restoredSnapshot.screen.practice.questions).map { it.id })
        assertEquals(1, mediaRoot.listFiles()?.size)
    }

    @Test
    fun `snapshot is rejected for another student or changed question set`() = withTempDirectory { mediaRoot ->
        val encoded = PracticeRecoveryCodec.encode(
            PracticeRecoverySnapshot(practiceScreen(), emptyList(), emptyList(), savedAtMs = 1_000L),
            mediaRoot,
        )

        assertNull(
            PracticeRecoveryCodec.decode(
                encoded.toString(),
                session().copy(studentId = "student-2"),
                mediaRoot,
                nowMs = 2_000L,
            ),
        )

        val changed = JSONObject(encoded.toString()).put("question_ids", org.json.JSONArray().put("different"))
        assertNull(PracticeRecoveryCodec.decode(changed.toString(), session(), mediaRoot, nowMs = 2_000L))
    }

    @Test
    fun `missing private media does not restore a false answered placeholder`() = withTempDirectory { mediaRoot ->
        val screen = practiceScreen()
        val encoded = PracticeRecoveryCodec.encode(
            PracticeRecoverySnapshot(
                screen,
                drafts = listOf(
                    PracticeAnswerDraftSnapshot(
                        questionId = "q-1",
                        answer = "[图片作答]",
                        photo = privateImage(mediaRoot, byteArrayOf(9)),
                    ),
                ),
                completedItems = emptyList(),
                savedAtMs = 1_000L,
            ),
            mediaRoot,
        )
        mediaRoot.listFiles()?.forEach { it.delete() }

        val restored = PracticeRecoveryCodec.decode(encoded.toString(), session(), mediaRoot, nowMs = 2_000L)
        val drafts = PracticeAnswerDrafts().apply { restore(restored!!.drafts) }

        assertFalse(drafts.hasAnswer("q-1"))
        assertNull(drafts.getPhoto("q-1"))
    }

    @Test
    fun `strokes are stored per question outside the practice snapshot`() = withTempDirectory { root ->
        val prefs = MemoryPreferences()
        val store = PracticeRecoveryStore(prefs, PrivateImageStore(root))
        val screen = practiceScreen()
        store.save(PracticeRecoverySnapshot(screen, emptyList(), emptyList(),
            canvasSnapshots = mapOf("q-1" to canvas(7L), "q-2" to canvas(8L))))

        assertFalse(prefs.all.values.single().toString().contains("\"strokes\""))
        val restored = PracticeRecoveryStore(prefs, PrivateImageStore(root)).restore(screen.session)!!
        assertEquals(7L, restored.canvasSnapshots["q-1"]?.strokes?.single()?.id)
        assertEquals(8L, restored.canvasSnapshots["q-2"]?.strokes?.single()?.id)
        assertEquals(4f, restored.canvasSnapshots["q-1"]?.strokes?.single()?.canvasWidth ?: 0f, 0.001f)
    }

    @Test
    fun `a stroke rewrites only its own question`() = withTempDirectory { root ->
        val prefs = MemoryPreferences()
        val images = PrivateImageStore(root)
        val store = PracticeRecoveryStore(prefs, images)
        val screen = practiceScreen()
        store.save(PracticeRecoverySnapshot(screen, emptyList(), emptyList(),
            canvasSnapshots = mapOf("q-1" to canvas(7L), "q-2" to canvas(8L))))
        val directory = images.studentDirectory(screen.session.studentId)
        val other = PracticeCanvasFiles.file(directory, "q-2")
        val practiceBefore = prefs.all.values.single()
        other.setLastModified(1_000L)

        store.saveCanvas(screen.session.studentId, "q-1", canvas(9L))

        assertEquals(1_000L, other.lastModified())
        assertEquals(practiceBefore, prefs.all.values.single())
        val restored = PracticeRecoveryStore(prefs, PrivateImageStore(root)).restore(screen.session)!!
        assertEquals(9L, restored.canvasSnapshots["q-1"]?.strokes?.single()?.id)
        assertEquals(8L, restored.canvasSnapshots["q-2"]?.strokes?.single()?.id)
    }

    @Test
    fun `clearing a canvas or leaving the practice removes its stroke files`() = withTempDirectory { root ->
        val prefs = MemoryPreferences()
        val images = PrivateImageStore(root)
        val store = PracticeRecoveryStore(prefs, images)
        val screen = practiceScreen()
        val directory = images.studentDirectory(screen.session.studentId)
        store.save(PracticeRecoverySnapshot(screen, emptyList(), emptyList(),
            canvasSnapshots = mapOf("q-1" to canvas(7L), "q-2" to canvas(8L))))

        store.saveCanvas(screen.session.studentId, "q-1", null)
        assertFalse(PracticeCanvasFiles.file(directory, "q-1").exists())

        val onlyFirst = screen.copy(index = 0, practice = screen.practice.copy(questions = screen.practice.questions.take(1)))
        store.save(PracticeRecoverySnapshot(onlyFirst, emptyList(), emptyList()))
        assertFalse(PracticeCanvasFiles.file(directory, "q-2").exists())

        store.saveCanvas(screen.session.studentId, "q-1", canvas(9L))
        store.clear(screen.session.studentId)
        assertFalse(PracticeCanvasFiles.directory(directory).exists())
    }

    @Test
    fun `a damaged or foreign stroke file is ignored`() = withTempDirectory { root ->
        val prefs = MemoryPreferences()
        val images = PrivateImageStore(root)
        val store = PracticeRecoveryStore(prefs, images)
        val screen = practiceScreen()
        store.save(PracticeRecoverySnapshot(screen, emptyList(), emptyList(),
            canvasSnapshots = mapOf("q-1" to canvas(7L), "q-2" to canvas(8L))))
        val directory = images.studentDirectory(screen.session.studentId)
        PracticeCanvasFiles.file(directory, "q-1").writeText("{not json")
        // A file whose recorded question does not match its name must not be applied.
        PracticeCanvasFiles.file(directory, "q-2").writeText(
            PracticeCanvasFiles.file(directory, "q-2").readText().replace("\"q-2\"", "\"q-9\""),
        )

        val restored = PracticeRecoveryStore(prefs, PrivateImageStore(root)).restore(screen.session)!!
        assertNull(restored.canvasSnapshots["q-1"])
        assertNull(restored.canvasSnapshots["q-2"])
        assertEquals(screen.practice.questions.map { it.id }, restored.screen.practice.questions.map { it.id })
    }

    private fun canvas(strokeId: Long) = DraftCanvasSnapshot(
        strokes = listOf(DraftStroke(strokeId, 0xFF0F172A.toInt(), 5f,
            listOf(DraftPoint(12f, 18f, 1_000L, 0.45f, 2), DraftPoint(24f, 32f, 1_016L, 0.62f, 2)), canvasWidth = 4f)),
        transform = DraftCanvasTransform(viewport = DraftViewport(10f, 20f, 1.25f)),
        hasTransform = true,
        canvasWidth = 1200,
        canvasHeight = 800,
    )

    private fun practiceScreen(): Screen.PracticeQuestionScreen {
        val kp = KpNode(
            id = "kp-1",
            name = "质点",
            volume = "必修 第一册",
            chapter = "第一章",
            section = "1.1",
            mastery = 0.2,
            status = "in_progress",
        )
        val questions = listOf(
            PracticeQuestion(
                id = "q-1",
                stem = "题干 1",
                questionType = "single_choice",
                options = emptyList(),
                images = emptyList(),
                stemRendered = RenderedRichContent(html = "<p>含公式</p>", plainText = "含公式", hasMath = true),
            ),
            PracticeQuestion(
                id = "q-2",
                stem = "题干 2",
                questionType = "problem_solving",
                options = emptyList(),
                images = emptyList(),
            ),
        )
        val data = DirectoryData(listOf(kp), mastered = 0, inProgress = 1, total = 1)
        return Screen.PracticeQuestionScreen(
            session = session(),
            data = data,
            chapter = ChapterGroup(kp.volume, kp.chapter, listOf(kp)),
            kp = kp,
            practice = PracticeSession("练习", questions),
            index = 1,
        )
    }

    private fun privateImage(directory: File, bytes: ByteArray): LocalImageFile {
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val file = File(directory, "$hash.img").apply { writeBytes(bytes) }
        return LocalImageFile(file.absolutePath, "image/jpeg", "answer.jpg", hash, bytes.size.toLong())
    }

    private fun session(): StudentSession = StudentSession(
        token = "token",
        studentId = "student-1",
        username = "student",
        displayName = "学生",
    )

    private fun withTempDirectory(block: (File) -> Unit) {
        val directory = File(System.getProperty("java.io.tmpdir"), "openphysics-recovery-${UUID.randomUUID()}")
        directory.mkdirs()
        try {
            block(directory)
        } finally {
            directory.deleteRecursively()
        }
    }
}

private class MemoryPreferences : SharedPreferences {
    private val values = mutableMapOf<String, Any?>()
    override fun getAll(): MutableMap<String, *> = values.toMutableMap()
    override fun getString(key: String?, defValue: String?): String? = values[key] as? String ?: defValue
    @Suppress("UNCHECKED_CAST")
    override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? =
        values[key] as? MutableSet<String> ?: defValues
    override fun getInt(key: String?, defValue: Int): Int = values[key] as? Int ?: defValue
    override fun getLong(key: String?, defValue: Long): Long = values[key] as? Long ?: defValue
    override fun getFloat(key: String?, defValue: Float): Float = values[key] as? Float ?: defValue
    override fun getBoolean(key: String?, defValue: Boolean): Boolean = values[key] as? Boolean ?: defValue
    override fun contains(key: String?): Boolean = key in values
    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        private val updates = mutableMapOf<String, Any?>()
        private var cleared = false
        private fun put(key: String?, value: Any?): SharedPreferences.Editor = apply { updates[requireNotNull(key)] = value }
        override fun putString(key: String?, value: String?) = put(key, value)
        override fun putStringSet(key: String?, values: MutableSet<String>?) = put(key, values)
        override fun putInt(key: String?, value: Int) = put(key, value)
        override fun putLong(key: String?, value: Long) = put(key, value)
        override fun putFloat(key: String?, value: Float) = put(key, value)
        override fun putBoolean(key: String?, value: Boolean) = put(key, value)
        override fun remove(key: String?) = put(key, null)
        override fun clear(): SharedPreferences.Editor = apply { cleared = true }
        override fun commit(): Boolean {
            if (cleared) values.clear()
            updates.forEach { (key, value) -> if (value == null) values.remove(key) else values[key] = value }
            return true
        }
        override fun apply() { commit() }
    }
}
