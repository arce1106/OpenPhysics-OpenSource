package cn.openphysics.androidapp.ui

import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import cn.openphysics.androidapp.data.session.FontSizeStore
import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.StudentAccessPolicy
import cn.openphysics.androidapp.domain.PracticeSessionTypes
import cn.openphysics.androidapp.domain.LearningCatalogTopicLayer
import cn.openphysics.androidapp.ui.screens.DirectoryScreen
import cn.openphysics.androidapp.ui.screens.ErrorScreen
import cn.openphysics.androidapp.ui.screens.TabletShellHost
import cn.openphysics.androidapp.ui.screens.PhoneLearnHubScreen
import cn.openphysics.androidapp.ui.screens.HomeScreen
import cn.openphysics.androidapp.ui.screens.GaokaoReviewScreen
import cn.openphysics.androidapp.ui.screens.HistoryScreen
import cn.openphysics.androidapp.ui.screens.HomeworkHistoryScreen
import cn.openphysics.androidapp.ui.screens.HistoryDetailScreen
import cn.openphysics.androidapp.ui.screens.LearnScreen
import cn.openphysics.androidapp.ui.screens.PhoneAppPresentation
import cn.openphysics.androidapp.ui.screens.LocalPhonePresentation
import cn.openphysics.androidapp.ui.screens.PhoneColors
import cn.openphysics.androidapp.ui.screens.LoginScreen
import cn.openphysics.androidapp.ui.screens.PracticeQuestionSubmitMode
import cn.openphysics.androidapp.ui.screens.PracticeQuestionPresentationMode
import cn.openphysics.androidapp.ui.screens.PracticeQuestionScreen
import cn.openphysics.androidapp.ui.screens.PracticeResultScreen
import cn.openphysics.androidapp.ui.screens.PracticeReviewScreen
import cn.openphysics.androidapp.ui.screens.PracticeSummaryAction
import cn.openphysics.androidapp.ui.screens.ReinforcementChapterPathScreen
import cn.openphysics.androidapp.ui.screens.ReinforcementDiagnosticAttemptDetailScreen
import cn.openphysics.androidapp.ui.screens.ReinforcementDiagnosticHistoryScreen
import cn.openphysics.androidapp.ui.screens.ReinforcementHomeScreen
import cn.openphysics.androidapp.ui.screens.ReinforcementLearningTraceScreen
import cn.openphysics.androidapp.ui.screens.ReinforcementReportHistoryScreen
import cn.openphysics.androidapp.ui.screens.ReinforcementReportScreen
import cn.openphysics.androidapp.ui.screens.ReinforcementRetestResultScreen
import cn.openphysics.androidapp.ui.screens.ReinforcementScopeResultScreen
import cn.openphysics.androidapp.ui.screens.ReinforcementTaskCompleteScreen
import cn.openphysics.androidapp.ui.screens.ReviewDetailScreen
import cn.openphysics.androidapp.ui.screens.ReviewNotebookScreen
import cn.openphysics.androidapp.ui.screens.SettingsScreen
import cn.openphysics.androidapp.ui.screens.SyncKpActionKind
import cn.openphysics.androidapp.ui.screens.buildReinforcementChapterPlans
import cn.openphysics.androidapp.ui.screens.reviewRetryGuidanceText
import cn.openphysics.androidapp.ui.screens.reviewRetryPracticePresentationPolicy
import cn.openphysics.androidapp.ui.theme.OpenPhysicsTheme

@Composable
fun OpenPhysicsApp(controller: AppController, onExit: () -> Unit) {
    val context = LocalContext.current
    val fontSizeStore = remember { FontSizeStore(context.applicationContext) }
    var fontSize by remember { mutableStateOf(fontSizeStore.read()) }
    val lifecycleOwner = LocalLifecycleOwner.current

    fun openAccountUnavailable() {
        controller.logout()
    }

    DisposableEffect(lifecycleOwner, controller) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                controller.refreshStudentSession()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        if (lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
            controller.refreshStudentSession()
        }
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    BackHandler {
        if (!controller.goBack()) onExit()
    }

    OpenPhysicsTheme(fontScale = fontSize.scale) {
        PhoneAppPresentation(controller, fontSize.scale) {
        OpenPhysicsAppViewport {
            if (controller.pendingPracticeExit != null) {
                val dropsKpSummary = controller.pendingPracticeExitDropsKpSummary()
                AlertDialog(
                    onDismissRequest = controller::cancelPracticeExit,
                    title = { Text(if (dropsKpSummary) "退出评估？" else "退出作答？") },
                    text = { Text(if (dropsKpSummary) {
                        "三题已批改，但评估总结尚未加载成功。留在此页可重试获取总结；退出后需重新评估。已提交的作答记录仍会保留。"
                    } else {
                        "本组练习尚未完成，退出将放弃未提交的答案和草稿。已提交、已批改的记录仍会保留。关闭应用后重新打开也不会恢复未提交作答。"
                    }) },
                    confirmButton = { TextButton(onClick = controller::confirmPracticeExit) { Text("放弃并退出") } },
                    dismissButton = { TextButton(onClick = controller::cancelPracticeExit) { Text(if (dropsKpSummary) "返回评估" else "继续作答") } },
                )
            }
            if (controller.loginClassNotice.isNotBlank() && controller.screen !is Screen.Login) {
                AlertDialog(
                    onDismissRequest = { controller.loginClassNotice = "" },
                    title = { Text("班级") },
                    text = { Text(controller.loginClassNotice) },
                    confirmButton = { TextButton(onClick = { controller.loginClassNotice = "" }) { Text("知道了") } },
                )
            }
            TabletShellHost(controller) { when (val screen = controller.screen) {
                is Screen.Login -> LoginScreen(message = screen.message, busy = controller.loginBusy,
                    captchaRequired = screen.captchaRequired, onLogin = controller::login,
                    loadCaptcha = controller::loadLoginCaptcha)
                is Screen.Home -> {
                    HomeDashboardLoader(screen, controller)
                    HomeScreen(
                        session = screen.session,
                        dashboard = screen.dashboard,
                        dailyLoop = screen.dailyLoop,
                        dailyLoopHistory = screen.dailyLoopHistory,
                        growthReport = screen.growthReport,
                        dashboardLoading = screen.dashboardLoading,
                        dashboardError = screen.dashboardError,
                        onRefreshDashboard = { controller.refreshHomeDashboard(screen.session) },
                        onDirectory = { controller.loadDirectory(screen.session) },
                        onReinforcement = { controller.loadReinforcementHome(screen.session) },
                        onGaokao = { controller.loadGaokaoReview(screen.session) },
                        onHistory = { controller.loadHistory(screen.session) },
                        onGrowthHistory = { report -> controller.loadGrowthReportHistory(screen.session, report) },
                        onReview = { controller.loadReview(screen.session) },
                        onSettings = { controller.showSettings(screen.session) },
                        onTodayTask = { task -> controller.openHomeTask(screen.session, task) },
                        teacherHomework = screen.teacherHomework,
                        onTeacherHomework = { homework -> controller.startTeacherHomework(screen.session, homework) },
                        onHomeworkHistory = { controller.loadHomeworkHistory(screen.session) },
                    )
                }
            is Screen.LearnHub -> PhoneLearnHubScreen(
                onHome = { controller.showHome(screen.session) },
                onReview = { controller.loadReview(screen.session, asRoot = true) },
                onMe = { controller.showSettings(screen.session) },
                onSync = { controller.loadDirectory(screen.session) },
                onReinforcement = { controller.loadReinforcementHome(screen.session) },
                onGaokao = { controller.loadGaokaoReview(screen.session) },
            )
            is Screen.Settings -> SettingsScreen(
                session = screen.session,
                onHome = { controller.showHome(screen.session) },
                onLearn = { controller.loadDirectory(screen.session, asRoot = true) },
                onPractice = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onReview = { controller.loadReview(screen.session, asRoot = true) },
                onBack = { controller.goBack() },
                loadSettings = controller::loadAccountSettings,


                request = controller::updateAccountSecurity,
                classActions = remember(controller) { cn.openphysics.androidapp.ui.screens.StudentClassActions(
                    controller::loadStudentClasses, controller::previewClassInvitation,
                    controller::joinStudentClass, controller::leaveStudentClass, controller::renameStudent) },

                onHistory = { controller.loadHistory(screen.session) },

                deleteAccount = controller::deleteAccount,
                fontSize = fontSize,
                onFontSizeChange = { next ->
                    fontSize = next
                    fontSizeStore.save(next)
                },
                onLogout = controller::logout,
            )
            is Screen.Loading -> LoadingScreen(screen.title, screen.message)
            is Screen.Error -> {
                val unavailableSession = screen.unavailableSession
                ErrorScreen(
                    title = screen.title,
                    message = screen.message,
                    onBack = { if (!controller.goBack()) controller.leaveRootError() },
                    actionLabel = if (screen.retryable && screen.actionLabel.isBlank()) "重试" else screen.actionLabel,
                    onAction = when {
                        screen.retryable && screen.actionLabel.isBlank() -> { { controller.retryFailedLoad() } }
                        unavailableSession != null -> { { controller.logout() } }
                        screen.actionUrl.isNotBlank() -> {
                            {
                                runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(screen.actionUrl)))
                                }
                            }
                        }
                        else -> null
                    },
                )
            }
            is Screen.Directory -> DirectoryScreen(
                session = screen.session,
                data = screen.data,
                focusedKpId = screen.focusedKpId,
                judgmentsByKpId = screen.judgmentsByKpId,
                grouped = controller.groupByVolume(screen.data.kps),
                onHome = { controller.showHome(screen.session) },
                onPractice = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onReview = { controller.loadReview(screen.session, asRoot = true) },
                onMe = { controller.showSettings(screen.session) },
                // An unavailable account returns to login; active accounts can use every point.
                onStartLearn = { chapter, kp, startWithVideo ->
                    if (!StudentAccessPolicy.canAccessKp(screen.session, kp)) openAccountUnavailable()
                    else controller.loadLearn(screen.session, screen.data, chapter, kp, startWithVideo = startWithVideo)
                },
                onStartCheck = { chapter, kp ->
                    if (!StudentAccessPolicy.canAccessKp(screen.session, kp)) openAccountUnavailable()
                    else controller.loadKpCheck(screen.session, screen.data, chapter, kp)
                },
                onStartTrain = { chapter, kp ->
                    if (!StudentAccessPolicy.canAccessKp(screen.session, kp)) openAccountUnavailable()
                    else controller.loadKpTrain(screen.session, screen.data, chapter, kp)
                },
                assessmentProgressFor = { kpId -> controller.kpAssessmentProgress(screen.session, kpId) },
                onKpAction = { chapter, kp, action ->
                    if (action != SyncKpActionKind.Improvement && !StudentAccessPolicy.canAccessKp(screen.session, kp)) {
                        openAccountUnavailable()
                    } else when (action) {
                        SyncKpActionKind.Learn -> controller.loadLearn(screen.session, screen.data, chapter, kp)
                        SyncKpActionKind.Check -> controller.loadKpCheck(screen.session, screen.data, chapter, kp)
                        SyncKpActionKind.Train -> controller.loadKpTrain(screen.session, screen.data, chapter, kp)
                        SyncKpActionKind.Improvement -> controller.loadReinforcementHome(screen.session, asRoot = true)
                    }
                },
                canAccessKp = { kp -> StudentAccessPolicy.canAccessKp(screen.session, kp) },
                onAccountUnavailable = { openAccountUnavailable() },
            )
            is Screen.GaokaoReview -> {
                LaunchedEffect(screen.session.studentId, screen.selectedTopicId, screen.autoLoadOverview) {
                    if (screen.autoLoadOverview) controller.refreshGaokaoTopic(screen)
                }
                GaokaoReviewScreen(
                screen = screen,
                onHome = { controller.showHome(screen.session) },
                onLearn = { controller.loadDirectory(screen.session, asRoot = true) },
                onPractice = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onReview = { controller.loadReview(screen.session, asRoot = true) },
                onMe = { controller.showSettings(screen.session) },
                onToggleBlock = { controller.toggleGaokaoBlock(screen, it) },
                onSelectTopic = { controller.selectGaokaoTopic(screen, it) },
                onStartLayer = { topic, layer -> controller.startGaokaoTopicSession(screen, topic, layer) },

                onRefreshTopic = { controller.refreshGaokaoTopic(screen) },
                onAccountUnavailable = {
                    openAccountUnavailable()
                },
                )
            }
            is Screen.ReinforcementHome -> ReinforcementHomeScreen(
                accessRequired = !StudentAccessPolicy.hasFullLearningAccess(screen.session),
                onAccountUnavailable = { openAccountUnavailable() },
                data = screen.data,
                trainStart = screen.trainStart,
                latestPlan = screen.latestPlan,
                latestCompletedReport = screen.latestCompletedReport,
                judgmentsByKpId = screen.judgmentsByKpId,
                onHome = { controller.showHome(screen.session) },
                onLearn = { controller.loadDirectory(screen.session, asRoot = true) },
                onReview = { controller.loadReview(screen.session, asRoot = true) },
                onMe = { controller.showSettings(screen.session) },
                onScopeDiagnostic = {
                    if (!StudentAccessPolicy.hasFullLearningAccess(screen.session)) {
                        openAccountUnavailable()
                    } else controller.loadReinforcementScopeDiagnostic(
                        session = screen.session,
                        data = screen.data,
                        volume = it.volume,
                        chapterName = it.chapter,
                    )
                },
                onWeakPractice = {
                    controller.loadReinforcementKpPractice(screen.session, screen.data, it)
                },
                onMixedPractice = { plan ->
                    if (!StudentAccessPolicy.hasFullLearningAccess(screen.session)) {
                        openAccountUnavailable()
                    } else if (plan == null) {
                        controller.loadReinforcementPractice(screen.session, screen.data)
                    } else {
                        controller.loadReinforcementChapterMixedPractice(
                            session = screen.session,
                            data = screen.data,
                            volume = plan.volume,
                            chapterName = plan.chapter,
                            recommendedKpIds = plan.recommendedKps.map { it.id },
                        )
                    }
                },
                onLearnKp = {
                    controller.loadReinforcementLearn(screen.session, screen.data, it)
                },
                onChapterPath = {
                    controller.showReinforcementChapterPath(
                        session = screen.session,
                        data = screen.data,
                        trainStart = screen.trainStart,
                        volume = it.volume,
                        chapter = it.chapter,
                        judgmentsByKpId = screen.judgmentsByKpId,
                    )
                },
                onReportHistory = { controller.showImprovementReportHistory(screen.session, screen.data) },
                onDiagnosticHistory = { controller.showScopeDiagnosticHistory(screen.session, screen.data) },
                onLearningTrace = { controller.showLearningTrace(screen.session, screen.data) },
                onOpenLatestPlan = { controller.showImprovementPlan(screen.session, screen.data, it) },
                onContinueLatestPlan = { plan ->
                    val task = plan.currentTask()
                    when {
                        task != null -> controller.startImprovementTaskPractice(screen.session, screen.data, plan, task)
                        plan.readyForRetest() -> controller.startImprovementRetest(screen.session, screen.data, plan)
                        else -> controller.showImprovementPlan(screen.session, screen.data, plan)
                    }
                },
                onRediagnoseLatestPlan = { plan ->
                    if (plan.scopeType == "section") {
                        val chapterName = plan.scopeId.substringBefore("||")
                        val sectionName = plan.scopeId.substringAfter("||", "")
                        val kp = screen.data.kps.firstOrNull { item ->
                            item.chapter == chapterName && item.section == sectionName
                        }
                        if (kp != null) controller.loadReinforcementSectionDiagnostic(
                            session = screen.session,
                            data = screen.data,
                            volume = kp.volume,
                            chapterName = chapterName,
                            sectionName = sectionName,
                        )
                    } else {
                        controller.loadReinforcementScopeDiagnostic(
                            session = screen.session,
                            data = screen.data,
                            volume = screen.data.kps.firstOrNull { kp -> kp.chapter == plan.scopeId || kp.chapter == plan.scopeName }?.volume.orEmpty(),
                            chapterName = plan.scopeId.ifBlank { plan.scopeName },
                        )
                    }
                },
                onOpenLatestReport = { controller.showImprovementReport(screen.session, screen.data, it.summary.planId) },
            )
            is Screen.ReinforcementChapterPath -> {
                val plan = remember(screen.data, screen.trainStart, screen.volume, screen.chapter, screen.judgmentsByKpId) {
                    buildReinforcementChapterPlans(screen.data, screen.trainStart, emptyMap())
                        .firstOrNull { it.volume == screen.volume && it.chapter == screen.chapter }
                }
                if (plan == null) {
                    ErrorScreen(
                        title = "章节路径不存在",
                        message = "当前章节数据已变化，请返回巩固提升重新选择。",
                        onBack = { controller.goBack() },
                    )
                } else {
                    ReinforcementChapterPathScreen(
                        plan = plan,
                        judgmentsByKpId = screen.judgmentsByKpId,
                        accessRequired = !StudentAccessPolicy.hasFullLearningAccess(screen.session),
                        onBack = { controller.goBack() },
                        onHome = { controller.showHome(screen.session) },
                        onLearnTab = { controller.loadDirectory(screen.session, asRoot = true) },
                        onPracticeTab = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                        onReview = { controller.loadReview(screen.session, asRoot = true) },
                        onMe = { controller.showSettings(screen.session) },
                        onScopeDiagnostic = {
                            if (!StudentAccessPolicy.hasFullLearningAccess(screen.session)) {
                                openAccountUnavailable()
                            } else controller.loadReinforcementScopeDiagnostic(
                                session = screen.session,
                                data = screen.data,
                                volume = it.volume,
                                chapterName = it.chapter,
                            )
                        },
                        onDiagnosticHistory = { controller.showScopeDiagnosticHistory(screen.session, screen.data) },
                        onAccountUnavailable = { openAccountUnavailable() },
                        onWeakPractice = {
                            controller.loadReinforcementKpPractice(screen.session, screen.data, it)
                        },
                        onMixedPractice = {
                            controller.loadReinforcementChapterMixedPractice(
                                session = screen.session,
                                data = screen.data,
                                volume = it.volume,
                                chapterName = it.chapter,
                                recommendedKpIds = it.recommendedKps.map { kp -> kp.id },
                            )
                        },
                        onLearn = { controller.loadReinforcementLearn(screen.session, screen.data, it) },
                    )
                }
            }
            is Screen.ReinforcementScopeResult -> ReinforcementScopeResultScreen(
                result = screen.result,
                plan = screen.plan,
                onAccountUnavailable = { openAccountUnavailable() },
                onBack = { controller.goBack() },
                onHome = { controller.showHome(screen.session) },
                onLearn = { controller.loadDirectory(screen.session, asRoot = true) },
                onPractice = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onReview = { controller.loadReview(screen.session, asRoot = true) },
                onMe = { controller.showSettings(screen.session) },
                onLearnTask = { controller.loadImprovementTaskLearn(screen.session, screen.data, it) },
                onStartTask = { task -> screen.plan?.let { plan -> controller.startImprovementTaskPractice(screen.session, screen.data, plan, task) } },
                onStartRetest = { screen.plan?.let { plan -> controller.startImprovementRetest(screen.session, screen.data, plan) } },
                onViewReport = { screen.plan?.let { plan -> controller.showImprovementReport(screen.session, screen.data, plan.id) } },
            )
            is Screen.ReinforcementRetestResult -> ReinforcementRetestResultScreen(
                result = screen.result,
                onBackToPlan = { controller.showImprovementPlan(screen.session, screen.data, screen.result.plan) },
                onContinueWeak = { controller.startImprovementTaskPractice(screen.session, screen.data, screen.result.plan, it) },
                onViewReport = { controller.showImprovementReport(screen.session, screen.data, screen.result.plan.id) },
                onHome = { controller.showHome(screen.session) },
                onLearn = { controller.loadDirectory(screen.session, asRoot = true) },
                onPractice = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onReview = { controller.loadReview(screen.session, asRoot = true) },
                onMe = { controller.showSettings(screen.session) },
            )
            is Screen.ReinforcementTaskComplete -> ReinforcementTaskCompleteScreen(
                plan = screen.plan,
                review = screen.review,
                onBackToPlan = { controller.showImprovementPlan(screen.session, screen.data, screen.plan) },
                onContinueNextTask = { controller.continueAfterImprovementTaskComplete(screen) },
                onBackToEntry = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onHome = { controller.showHome(screen.session) },
                onLearn = { controller.loadDirectory(screen.session, asRoot = true) },
                onPractice = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onReview = { controller.loadReview(screen.session, asRoot = true) },
                onMe = { controller.showSettings(screen.session) },
            )
            is Screen.ReinforcementReport -> ReinforcementReportScreen(
                report = screen.report,
                onBack = { controller.goBack() },
                onBackToPlan = { controller.showImprovementPlan(screen.session, screen.data, it) },
                onHome = { controller.showHome(screen.session) },
                onLearn = { controller.loadDirectory(screen.session, asRoot = true) },
                onPractice = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onReview = { controller.loadReview(screen.session, asRoot = true) },
                onMe = { controller.showSettings(screen.session) },
            )
            is Screen.ReinforcementReportHistory -> ReinforcementReportHistoryScreen(
                reports = screen.reports,
                onBack = { controller.goBack() },
                onHome = { controller.showHome(screen.session) },
                onLearn = { controller.loadDirectory(screen.session, asRoot = true) },
                onPractice = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onReview = { controller.loadReview(screen.session, asRoot = true) },
                onMe = { controller.showSettings(screen.session) },
                onOpenReport = { controller.showImprovementReport(screen.session, screen.data, it) },
                onLoadMore = { controller.loadMoreImprovementReportHistory(screen) },
            )
            is Screen.ReinforcementDiagnosticHistory -> ReinforcementDiagnosticHistoryScreen(
                attempts = screen.attempts,
                onBack = { controller.goBack() },
                onHome = { controller.showHome(screen.session) },
                onLearn = { controller.loadDirectory(screen.session, asRoot = true) },
                onPractice = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onReview = { controller.loadReview(screen.session, asRoot = true) },
                onMe = { controller.showSettings(screen.session) },
                onOpenAttempt = { controller.showScopeDiagnosticAttemptDetail(screen.session, screen.data, it) },
                onOpenLinkedPlan = { controller.showImprovementPlan(screen.session, screen.data, it) },
                onLoadMore = { controller.loadMoreScopeDiagnosticHistory(screen) },
            )
            is Screen.ReinforcementDiagnosticAttemptDetail -> ReinforcementDiagnosticAttemptDetailScreen(
                detail = screen.detail,
                onBackToHistory = { controller.goBack() },
                onBackToEntry = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onViewPlan = { controller.showImprovementPlan(screen.session, screen.data, it) },
                onViewReport = { controller.showImprovementReport(screen.session, screen.data, it) },
                onRediagnose = { controller.rediagnoseFromAttempt(screen.session, screen.data, screen.detail) },
                onHome = { controller.showHome(screen.session) },
                onLearn = { controller.loadDirectory(screen.session, asRoot = true) },
                onPractice = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onReview = { controller.loadReview(screen.session, asRoot = true) },
                onMe = { controller.showSettings(screen.session) },
            )
            is Screen.ReinforcementLearningTrace -> ReinforcementLearningTraceScreen(
                trace = screen.trace,
                onBack = { controller.goBack() },
                onHome = { controller.showHome(screen.session) },
                onLearn = { controller.loadDirectory(screen.session, asRoot = true) },
                onPractice = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onReview = { controller.loadReview(screen.session, asRoot = true) },
                onMe = { controller.showSettings(screen.session) },
                onOpenDiagnosticAttempt = { controller.showScopeDiagnosticAttemptDetail(screen.session, screen.data, it) },
                onOpenPlan = { controller.showImprovementPlan(screen.session, screen.data, it) },
                onOpenReport = { controller.showImprovementReport(screen.session, screen.data, it) },
                onLoadMore = { controller.loadMoreLearningTrace(screen) },
            )
            is Screen.History -> HistoryScreen(
                studentToken = screen.session.token,
                records = screen.records,
                onBack = { controller.goBack() },
                onRecord = { controller.showHistoryDetail(screen.session, it) },
                onOpenReview = { record -> controller.openReviewFromHistory(screen.session, record) },
            )
            is Screen.HomeworkHistory -> HomeworkHistoryScreen(
                items = screen.items,
                onBack = { controller.goBack() },
                onOpen = { homework -> controller.startTeacherHomework(screen.session, homework) },
            )
            is Screen.Review -> ReviewNotebookScreen(
                review = screen.data,
                onHome = { controller.showHome(screen.session) },
                onLearn = { controller.loadDirectory(screen.session, asRoot = true) },
                onPractice = { controller.loadReinforcementHome(screen.session, asRoot = true) },
                onMe = { controller.showSettings(screen.session) },
                onMistake = { controller.showReviewDetail(screen.session, screen.data, it) },
            )
            is Screen.HistoryDetail -> HistoryDetailScreen(
                studentToken = screen.session.token,
                record = screen.record,
                onBack = { controller.goBack() },
                onOpenReview = { record -> controller.openReviewFromHistory(screen.session, record) },
            )
            is Screen.ReviewDetail -> ReviewDetailScreen(
                studentToken = screen.session.token,
                mistake = screen.mistake,
                chatMessages = screen.tutorMessages,
                requestState = screen.tutorRequest,
                retryMessage = screen.retryMessage,
                onBack = { controller.goBack() },
                onAskTutor = { message -> controller.askReviewTutor(screen, message) },
                onStartRetry = { controller.startReviewRetry(screen) },
            )
            is Screen.ReviewRetryQuestion -> {
                val policy = reviewRetryPracticePresentationPolicy()
                val practice = remember(screen.question, screen.title) {
                    reviewRetryPractice(screen.question, screen.title)
                }
                val retryGuidance = reviewRetryGuidanceText(screen.reason)
                PracticeQuestionScreen(
                    question = screen.question,
                    index = 0,
                    total = 1,
                    draftAnswer = controller.getDraft(screen.question.id),
                    hasSavedPhoto = controller.getPhotoDraft(screen.question.id) != null ||
                        controller.getHandwritingDraft(screen.question.id) != null,
                    savedPhotoFile = controller.getPhotoDraft(screen.question.id),
                    onClearSavedPhoto = { controller.clearPhotoDraft(screen.question.id) },
                    selfReviewDraft = controller.getSelfReviewDraft(screen.question.id),
                    initialDraftCanvasSnapshots = controller.getDraftCanvasSnapshots(listOf(screen.question.id)),
                    answeredIndexes = if (controller.getDraft(screen.question.id).isNotBlank()) setOf(0) else emptySet(),
                    answeredCount = controller.getAnsweredCount(listOf(screen.question.id)),
                    submissionState = PracticeSetSubmissionState(error = screen.retryMessage),
                    pageTitle = policy.pageTitle,
                    guidanceText = retryGuidance,
                    submitMode = PracticeQuestionSubmitMode.SingleQuestion,
                    submitLabel = policy.submitLabel,
                    submitConfirmTitle = "提交变式题？",
                    submitConfirmText = "$retryGuidance\n\n提交后会按错题复盘规则判定。",
                    submitConfirmActionText = policy.submitLabel,
                    onBack = { controller.goBack() },
                    onDraftAnswerChange = { questionId, answer ->
                        controller.saveDraft(questionId, answer)
                    },
                    onSavePhoto = { imageBytes, mimeType ->
                        controller.savePhotoDraft(screen.question.id, imageBytes, mimeType)
                    },
                    onSaveHandwriting = { imageBytes, mimeType ->
                        controller.saveHandwritingDraft(screen.question.id, imageBytes, mimeType)
                    },
                    onSaveScratchImage = { imageBytes, mimeType ->
                        controller.saveScratchImageDraft(screen.question.id, imageBytes, mimeType)
                    },
                    onDraftCanvasSnapshotChange = { questionId, snapshot ->
                        controller.saveDraftCanvasSnapshot(questionId, snapshot)
                    },
                    onSaveSelfReview = { items ->
                        controller.saveSelfReviewDraft(screen.question.id, items)
                    },
                    onSubmitSelfReview = { items ->
                        controller.submitReviewRetrySelfReview(screen, items)
                    },
                    onPrintSet = {
                        startPracticePrintJob(
                            context = context,
                            title = "错题变式题",
                            questions = practice.questions,
                            subtitle = practice.objective.takeUnless { it == "错题变式题" }.orEmpty(),
                        )
                    },
                    onSubmitPaperBatch = {},
                    onPrevious = {},
                    onNext = {},
                    onQuestionSelect = {},
                    onSubmitSet = { controller.submitReviewRetry(screen) },
                )
            }
            is Screen.Learn -> LearnScreen(
                kp = screen.kp,
                bundle = screen.bundle,
                assessmentProgress = controller.kpAssessmentProgress(screen.session, screen.kp.id),
                startWithVideo = screen.startWithVideo,
                onBack = { controller.goBack() },
                onPractice = {
                    controller.completeLearningThenPractice(
                        screen.session,
                        screen.data,
                        screen.chapter,
                        screen.kp,
                        screen.bundle,
                    )
                },
                chatMessages = screen.chatMessages,
                requestState = screen.tutorRequest,
                onAskTutor = { message -> controller.askLearningTutor(screen, message) },
                onVideo = { url -> openLessonVideo(context, url) },
            )
            is Screen.PracticeQuestionScreen -> PracticeQuestionScreen(
                wholePaper = screen.learningCatalogContext?.layer == LearningCatalogTopicLayer.Paper,
                answerEditingLocked = controller.isPracticeAnswerEditingLocked(screen.practice.questions[screen.index].id),
                guidanceText = if (screen.learningCatalogContext != null &&
                    !StudentAccessPolicy.hasFullLearningAccess(screen.session))
                    "账号状态已变化，当前作答和草稿已保留；账号恢复后可继续提交。" else "",
                question = screen.practice.questions[screen.index],
                index = screen.index,
                total = screen.practice.questions.size,
                preloadQuestions = screen.practice.questions,
                draftAnswersByQuestionId = screen.practice.questions.associate { question ->
                    question.id to controller.getDraft(question.id)
                },
                draftAnswer = controller.getDraft(screen.practice.questions[screen.index].id),
                hasSavedPhoto = controller.getPhotoDraft(screen.practice.questions[screen.index].id) != null ||
                    controller.getHandwritingDraft(screen.practice.questions[screen.index].id) != null,
                savedPhotoFile = controller.getPhotoDraft(screen.practice.questions[screen.index].id),
                onClearSavedPhoto = { controller.clearPhotoDraft(screen.practice.questions[screen.index].id) },
                selfReviewDraft = controller.getSelfReviewDraft(screen.practice.questions[screen.index].id),
                initialDraftCanvasSnapshots = controller.getDraftCanvasSnapshots(
                    screen.practice.questions.map { it.id },
                ),
                answeredIndexes = screen.practice.questions.mapIndexedNotNull { questionIndex, question ->
                    if (controller.isAnsweredOrGraded(question)) questionIndex else null
                }.toSet(),
                answeredCount = screen.practice.questions.count { controller.isAnsweredOrGraded(it) },
                submissionState = screen.submissionState,
                submissionSourceSummary = controller.getSubmissionSourceSummary(
                    screen.practice.questions.map { it.id },
                ),
                pageTitle = practicePageTitle(screen),
                submitMode = practiceQuestionSubmitMode(
                    screen.practice,
                    screen.reinforcementContext,
                    screen.learningCatalogContext,
                ),
                presentationMode = if (screen.reinforcementContext is ReinforcementPracticeContext.ScopeDiagnostic) {
                    PracticeQuestionPresentationMode.UnitDiagnostic
                } else {
                    PracticeQuestionPresentationMode.Standard
                },
                submitLabel = when {
                    screen.learningCatalogContext?.layer == LearningCatalogTopicLayer.Paper -> "提交整卷"
                    screen.practice.teacherPaper != null -> "提交整套批改"
                    screen.learningCatalogContext?.layer == LearningCatalogTopicLayer.Diagnostic -> "提交批改"
                    screen.learningCatalogContext != null -> "提交本题"
                    screen.reinforcementContext is ReinforcementPracticeContext.ScopeDiagnostic -> "提交批改"
                    screen.reinforcementContext is ReinforcementPracticeContext.TaskPractice -> "提交本题"
                    screen.reinforcementContext is ReinforcementPracticeContext.Retest -> "提交复测"
                    else -> ""
                },
                submitConfirmTitle = if (
                    screen.reinforcementContext is ReinforcementPracticeContext.ScopeDiagnostic ||
                    screen.learningCatalogContext?.layer == LearningCatalogTopicLayer.Diagnostic
                ) "提交批改？" else "开始整套 AI 批改？",
                submitConfirmText = if (screen.learningCatalogContext?.layer == LearningCatalogTopicLayer.Paper) {
                    "提交后统一批改整卷，并保存本次作答记录。全部完成后查看整卷结果和逐题解析。"
                } else if (screen.reinforcementContext is ReinforcementPracticeContext.ScopeDiagnostic) {
                    "提交后会统一批改本次单元检测，并生成本章检测结果。"
                } else if (screen.learningCatalogContext?.layer == LearningCatalogTopicLayer.Diagnostic) {
                    "提交后会统一批改本次专题摸底，并更新当前高考专题状态。"
                } else {
                    "批改会在后台进行，当前题页面会保持可见，完成后自动进入本次结果。"
                },
                submitConfirmActionText = if (
                    screen.reinforcementContext is ReinforcementPracticeContext.ScopeDiagnostic ||
                    screen.learningCatalogContext?.layer == LearningCatalogTopicLayer.Diagnostic
                ) "提交批改" else "开始AI批改",
                onBack = { controller.leavePractice(screen) },
                onDraftAnswerChange = { questionId, answer ->
                    controller.saveDraft(questionId, answer)
                },
                onSavePhoto = { imageBytes, mimeType ->
                    controller.savePhotoDraft(screen.practice.questions[screen.index].id, imageBytes, mimeType)
                },
                onSaveHandwriting = { imageBytes, mimeType ->
                    controller.saveHandwritingDraft(screen.practice.questions[screen.index].id, imageBytes, mimeType)
                },
                onSaveScratchImage = { imageBytes, mimeType ->
                    controller.saveScratchImageDraft(screen.practice.questions[screen.index].id, imageBytes, mimeType)
                },
                onDraftCanvasSnapshotChange = { questionId, snapshot ->
                    controller.saveDraftCanvasSnapshot(questionId, snapshot)
                },
                onSaveSelfReview = { items ->
                    controller.saveSelfReviewDraft(screen.practice.questions[screen.index].id, items)
                },
                onSubmitSelfReview = { items ->
                    controller.saveSelfReviewDraft(screen.practice.questions[screen.index].id, items)
                    controller.submitPracticeSet(screen)
                },
                onPrintSet = {
                    val printTitle = practicePageTitle(screen)
                    startPracticePrintJob(
                        context = context,
                        title = printTitle,
                        questions = screen.practice.questions,
                        subtitle = screen.practice.objective.takeUnless { it == printTitle }.orEmpty(),
                    )
                },
                initialPaperBatchImages = screen.paperBatchImages,
                onPreparePaperBatchImage = { bytes, mimeType, fileName ->
                    controller.preparePaperBatchImage(screen.session.studentId, bytes, mimeType, fileName)
                },
                onPaperBatchImagesChange = { images ->
                    controller.savePaperBatchImages(screen, images)
                },
                onSubmitPaperBatch = { images ->
                    controller.submitPracticePaperBatch(screen, images)
                },
                onPrevious = { controller.goToPracticeQuestion(screen, screen.index - 1) },
                onNext = { controller.goToPracticeQuestion(screen, screen.index + 1) },
                onQuestionSelect = { targetIndex -> controller.goToPracticeQuestion(screen, targetIndex) },
                onSubmitSet = { controller.submitPracticeSet(screen) },
            )
            is Screen.PracticeResultScreen -> PracticeResultScreen(
                screen = screen,
                review = controller.practiceReviewFor(screen),
                onBack = { controller.goBack() },
                onCorrectGrading = { correctedAnswer, isCorrect ->
                    controller.correctGrading(screen, correctedAnswer, isCorrect)
                },
                onAskTutor = { message -> controller.askQuestionTutor(screen, message) },
                onPrevious = { controller.goToPracticeResultQuestion(screen, screen.index - 1) },
                onQuestionSelect = { targetIndex -> controller.goToPracticeResultQuestion(screen, targetIndex) },
                onNext = { controller.nextQuestion(screen) },
                onSummaryAction = { action: PracticeSummaryAction ->
                    controller.completePracticeSummary(screen, action)
                },
            )
            is Screen.PracticeReviewScreen -> PracticeReviewScreen(
                screen = screen,
                onBackToReview = { controller.openPracticeReviewQuestion(screen, 0) },
                onOpenQuestion = { itemIndex -> controller.openPracticeReviewQuestion(screen, itemIndex) },
                onDone = { controller.finishPractice(screen) },
                onRefresh = { controller.refreshTeacherPaperProgress(screen) },
                onRestart = if (screen.learningCatalogContext?.isTeacherHomework == true) null else ({ controller.restartTeacherPaper(screen) }),
                onCorrectGrading = { correction -> controller.correctTeacherPaperGrading(screen, correction.questionId, correction.correctedAnswer, correction.correct) },
            )
            }
            }
        }
        }
    }
}

@Composable
internal fun OpenPhysicsAppViewport(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .imePadding(),
    ) {
        content()
    }
}

internal fun practiceQuestionSubmitMode(
    practice: PracticeSession,
    context: ReinforcementPracticeContext?,
    learningCatalogContext: LearningCatalogPracticeContext? = null,
): PracticeQuestionSubmitMode =
    when {
        practice.teacherPaper != null -> PracticeQuestionSubmitMode.FinalPhotoBatch
        learningCatalogContext?.layer?.defersGrading() == true ->
            PracticeQuestionSubmitMode.FinalPhotoBatch
        learningCatalogContext != null -> PracticeQuestionSubmitMode.SingleQuestion
        else -> when (context) {
        is ReinforcementPracticeContext.ScopeDiagnostic -> PracticeQuestionSubmitMode.FinalPhotoBatch
        is ReinforcementPracticeContext.TaskPractice -> PracticeQuestionSubmitMode.SingleQuestion
        else -> when (practice.sessionType) {
            PracticeSessionTypes.KpDiagnostic,
            PracticeSessionTypes.ScopeDiagnostic -> PracticeQuestionSubmitMode.FinalPhotoBatch
            else -> PracticeQuestionSubmitMode.Batch
        }
        }
    }

internal fun practicePageTitle(screen: Screen.PracticeQuestionScreen): String = screen.learningCatalogContext?.let { context ->
    if (context.isTeacherHomework) "老师作业 · ${context.topicTitle}"
    else "${if (screen.practice.teacherPaper != null) "教师作业" else context.layer.title} · ${context.topicTitle}"
} ?: when (val reinforcementContext = screen.reinforcementContext) {
    is ReinforcementPracticeContext.ScopeDiagnostic ->
        if (reinforcementContext.scopeType == "section") "本节检测" else "单元检测"
    is ReinforcementPracticeContext.TaskPractice -> "专项练"
    is ReinforcementPracticeContext.Retest -> "阶段复测"
    null -> when (screen.practice.sessionType) {
        PracticeSessionTypes.KpDiagnostic -> "掌握评估"
        PracticeSessionTypes.ScopeDiagnostic -> "单元检测"
        PracticeSessionTypes.Practice -> when {
            screen.practice.strategy == "chapter_mixed" -> screen.practice.objective.ifBlank { "混合提升" }
            screen.kp.id == "reinforcement" -> "巩固提升"
            else -> "巩固小练"
        }
        else -> screen.practice.objective.ifBlank { "做题" }
    }
}

@Composable
private fun HomeDashboardLoader(screen: Screen.Home, controller: AppController) {
    LaunchedEffect(screen.session.studentId, screen.dashboard, screen.dashboardLoading) {
        if (screen.dashboard == null && !screen.dashboardLoading && screen.dashboardError.isBlank()) {
            controller.refreshHomeDashboard(screen.session)
        }
    }
}

@Composable
private fun LoadingScreen(title: String, message: String) {
    if (LocalPhonePresentation.current) {
        Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.White), contentAlignment = Alignment.Center) {
            Column(Modifier.fillMaxWidth().padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                CircularProgressIndicator(color = PhoneColors.Primary)
                Text(title, style = MaterialTheme.typography.titleLarge, color = PhoneColors.Ink,
                    textAlign = TextAlign.Center)
                if (message.isNotBlank()) Text(message, style = MaterialTheme.typography.bodyMedium, color = PhoneColors.Muted,
                    textAlign = TextAlign.Center)
            }
        }
        return
    }
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        androidx.compose.foundation.layout.Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator()
            Text(title, style = MaterialTheme.typography.titleLarge)
            Text(message, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
