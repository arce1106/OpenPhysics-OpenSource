package cn.openphysics.androidapp.ui

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppControllerLifecycleContractTest {
    @Test
    fun `controller is view model owned and no longer disposed by recomposition`() {
        val stateSource = sourceFile("src/main/java/cn/openphysics/androidapp/ui/AppState.kt").readText()
        val appSource = sourceFile("src/main/java/cn/openphysics/androidapp/ui/OpenPhysicsApp.kt").readText()

        assertTrue(stateSource.contains("class AppController(context: Context, recreatedStudentId: String? = null) : ViewModel()"))
        assertTrue(stateSource.contains("override fun onCleared()"))
        val activitySource = sourceFile("src/main/java/cn/openphysics/androidapp/MainActivity.kt").readText()
        assertTrue(activitySource.contains("ViewModelProvider(this, AppController.factory("))
        assertTrue(activitySource.contains("controller.checkpointPracticeForRecreation()"))
        assertTrue(activitySource.contains("super.onSaveInstanceState(outState)"))
        assertFalse(appSource.contains("onDispose { controller.shutdown() }"))
        assertTrue(appSource.contains("Lifecycle.Event.ON_RESUME"))
        assertTrue(appSource.contains("controller.refreshStudentSession()"))
        assertTrue(stateSource.contains("screen.withStudentSession(refreshed)"))
    }

    @Test
    fun `practice home control exits a restored root practice and clears recovery`() {
        val stateSource = sourceFile("src/main/java/cn/openphysics/androidapp/ui/AppState.kt").readText()
        val appSource = sourceFile("src/main/java/cn/openphysics/androidapp/ui/OpenPhysicsApp.kt").readText()
        val practiceScreenBinding = appSource
            .substringAfter("is Screen.PracticeQuestionScreen -> PracticeQuestionScreen(")
            .substringBefore("is Screen.PracticeResultScreen -> PracticeResultScreen(")
        val showHome = stateSource
            .substringAfter("fun showHome(session: StudentSession)")
            .substringBefore("fun loadDirectory(")

        assertTrue(practiceScreenBinding.contains("onBack = { controller.leavePractice(screen) }"))
        assertFalse(practiceScreenBinding.contains("onBack = { controller.goBack() }"))
        assertTrue(stateSource.contains("fun leavePractice(practiceScreen: Screen.PracticeQuestionScreen)"))
        assertTrue(stateSource.contains("showHome(practiceScreen.session)"))
        assertTrue(showHome.contains("clearPracticeRecovery(session.studentId)"))
        assertTrue(showHome.contains("backStack.clear()"))
    }

    @Test
    fun `single question self review saves its draft before starting grading`() {
        val appSource = sourceFile("src/main/java/cn/openphysics/androidapp/ui/OpenPhysicsApp.kt").readText()
        val practiceScreenBinding = appSource
            .substringAfter("is Screen.PracticeQuestionScreen -> PracticeQuestionScreen(")
            .substringBefore("is Screen.PracticeResultScreen -> PracticeResultScreen(")
        val submitBinding = practiceScreenBinding
            .substringAfter("onSubmitSelfReview = { items ->")
            .substringBefore("onPrintSet = {")

        assertTrue(submitBinding.contains("controller.saveSelfReviewDraft("))
        assertTrue(submitBinding.contains("controller.submitPracticeSet(screen)"))
    }

    @Test
    fun `reinforcement finalization clears practice only after result and plan are durable`() {
        val stateSource = sourceFile("src/main/java/cn/openphysics/androidapp/ui/AppState.kt").readText()
        val completion = stateSource
            .substringAfter("private fun reinforcementCompletionScreen(")
            .substringBefore("private fun resolveImprovementPlan(")

        val resultIndex = completion.indexOf("api.getScopeSubmittedDiagnosticResult(")
        val planIndex = completion.indexOf("resolveImprovementPlan(session, result)")
        val clearIndex = completion.indexOf("clearCompletedPracticeState(session, practice)")

        assertTrue(resultIndex >= 0)
        assertTrue(planIndex > resultIndex)
        assertTrue(clearIndex > planIndex)
    }

    @Test
    fun `home recommendation keeps its knowledge point through native navigation`() {
        val stateSource = sourceFile("src/main/java/cn/openphysics/androidapp/ui/AppState.kt").readText()
        val appSource = sourceFile("src/main/java/cn/openphysics/androidapp/ui/OpenPhysicsApp.kt").readText()
        val homeTaskFlow = stateSource
            .substringAfter("fun openHomeTask(session: StudentSession, task: HomeTask)")
            .substringBefore("fun loadDirectory(")

        assertTrue(appSource.contains("controller.openHomeTask(screen.session, task)"))
        assertTrue(homeTaskFlow.contains("it.id == task.kpId"))
        assertTrue(homeTaskFlow.contains("api.getLearnBundle(session.token, session.studentId, kp.id)"))
        assertTrue(homeTaskFlow.contains("api.getPracticeSession(session.token, session.studentId, kp.id, 5)"))
    }

    @Test
    fun `print web view is retained until android print preview takes ownership`() {
        val printSource = sourceFile(
            "src/main/java/cn/openphysics/androidapp/ui/PracticePrintDocument.kt",
        ).readText()

        assertTrue(printSource.contains("activePrintWebViews += webView"))
        assertTrue(printSource.contains("loadFallback = Runnable { launchPrint(webView) }"))
        assertTrue(printSource.contains("mainHandler.postDelayed(loadFallback, PrintPageLoadFallbackMs)"))
        assertTrue(printSource.contains("mainHandler.removeCallbacks(loadFallback)"))
        assertTrue(printSource.contains("if (printStarted) return"))
        assertTrue(printSource.contains("mainHandler.postDelayed(cleanup, PrintWebViewRetentionMs)"))
    }

    private fun sourceFile(relativePath: String): File {
        val candidates = listOf(
            File(relativePath),
            File("app/$relativePath"),
            File("mobile/openphysics-android/app/$relativePath"),
        )
        return candidates.firstOrNull(File::isFile)
            ?: error("Cannot locate Android source file: $relativePath")
    }
}
