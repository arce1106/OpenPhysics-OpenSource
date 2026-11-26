package cn.openphysics.androidapp

import android.app.Instrumentation
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import cn.openphysics.androidapp.data.session.SessionStore
import cn.openphysics.androidapp.domain.*
import cn.openphysics.androidapp.ui.*
import cn.openphysics.androidapp.ui.draft.DraftCanvasSnapshot
import cn.openphysics.androidapp.ui.draft.DraftSnapshotExport
import cn.openphysics.androidapp.ui.draft.hasAnswerInk

/** Uses only synthetic, local recovery data in the separate .devicetest package. */
internal fun Instrumentation.verifyTeacherPaperRetry(canvas: DraftCanvasSnapshot) {
    val session = StudentSession("local-retry-token", "local-retry-student", "local-retry", "本地重试验收")
    val questions = (1..4).map { PracticeQuestion("retry-$it", "本地题目 $it", "problem_solving", emptyList(), emptyList()) }
    val completed = questions.take(3).mapIndexed { index, question ->
        PracticeReviewItem(question, "已保存作答", SubmitResult(index + 1, true, "答案", "解析", ""))
    }
    val kp = KpNode("retry-kp", "本地验收", "必修", "第一章", "1.1", 0.2, "in_progress")
    val practice = PracticeSession("个性化作业重试验收", questions,
        teacherPaper = TeacherPaper("local-paper", "本地作业", 4, attemptId = "local-attempt", status = "grading"))
    val screen = Screen.PracticeQuestionScreen(session, DirectoryData(listOf(kp), 0, 1, 1),
        ChapterGroup(kp.volume, kp.chapter, listOf(kp)), kp, practice, 3,
        submissionState = PracticeSetSubmissionState(error = "最后一题批改失败", completed = 3, total = 4))
    val sessions = SessionStore(targetContext)
    val recovery = PracticeRecoveryStore(targetContext)
    sessions.save(session)
    recovery.save(PracticeRecoverySnapshot(screen, emptyList(), completed))
    val models = ViewModelStore()
    lateinit var controller: AppController
    runOnMainSync {
        controller = ViewModelProvider(models, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                AppController(targetContext, session.studentId) as T
        })[AppController::class.java]
        check(controller.screen is Screen.PracticeQuestionScreen)
        questions.take(3).forEach { check(controller.isPracticeAnswerEditingLocked(it.id)) }
        check(!controller.isPracticeAnswerEditingLocked(questions.last().id))
        controller.saveDraftCanvasSnapshot(questions.last().id, canvas)
        check(controller.getDraftCanvasSnapshots(listOf(questions.last().id))[questions.last().id]?.hasAnswerInk() == true)
        controller.savePhotoDraft(questions.last().id, DraftSnapshotExport.jpeg(canvas), "image/jpeg")
        check(controller.getPhotoDraft(questions.last().id) != null)
        // A late callback must not replace any already-saved answer.
        controller.savePhotoDraft(questions.first().id, byteArrayOf(1), "image/jpeg")
        check(controller.getPhotoDraft(questions.first().id) == null)
        check(controller.checkpointPracticeForRecreation() == session.studentId)
        check(recovery.restore(session)?.completedItems == completed)
        models.clear()
    }
    recovery.clear(session.studentId)
    sessions.clear()
}
