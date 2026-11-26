package cn.openphysics.androidapp.ui.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.material3.HorizontalDivider
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.zIndex
import cn.openphysics.androidapp.domain.DashboardData
import cn.openphysics.androidapp.domain.TeacherHomework
import cn.openphysics.androidapp.domain.DailyLearningLoop
import cn.openphysics.androidapp.domain.DailyLearningLoopDay
import cn.openphysics.androidapp.domain.DailyLearningLoopHistory
import cn.openphysics.androidapp.domain.DailyLearningLoopHistorySummary
import cn.openphysics.androidapp.domain.DailyLoopRing
import cn.openphysics.androidapp.domain.DailyLoopRings
import cn.openphysics.androidapp.domain.GrowthReportData
import cn.openphysics.androidapp.domain.StudentSession
import cn.openphysics.androidapp.domain.WeakPoint
import cn.openphysics.androidapp.ui.components.LearningCard
import cn.openphysics.androidapp.ui.components.PrimaryActionButton
import cn.openphysics.androidapp.ui.components.SecondaryActionButton
import cn.openphysics.androidapp.ui.components.SectionHeader
import cn.openphysics.androidapp.ui.components.StatusChip
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone
import kotlinx.coroutines.delay

private object TabletHomeColors {
    val cardGradientStart = Color(0xFFF8FEFF)
    val cardGradientMid = Color(0xFFEAF8F9)
    val cardBorder = Color(0xFFD5EEF2)
    val goalBackground = Color(0xFFEFFCFD)
    val danger = Color(0xFFDC2626)
    val warm = Color(0xFFD97706)
    val success = Color(0xFF16A34A)
    val practiceTrack = Color(0x2B14919B)
    val reviewTrack = Color(0x2669B81F)
    val practicePalette = listOf(
        Color(0xFF087F87),
        Color(0xFF0FA4AD),
        Color(0xFF25C8C7),
        Color(0xFF68DDD1),
        Color(0xFF0FA4AD),
        Color(0xFF087F87),
    )
    val reviewPalette = listOf(
        Color(0xFF4D941B),
        Color(0xFF69B81F),
        Color(0xFF91D632),
        Color(0xFFB7E54B),
        Color(0xFF69B81F),
        Color(0xFF4D941B),
    )
    val practiceShadow = Color(0x2907595F)
    val reviewShadow = Color(0x2B448214)
    val practice = Color(0xFF0EA5A8)
    val practiceOverflow = Color(0xFF83D7D0)
    val review = Color(0xFF88DCA0)
    val ringTrack = Color(0xFFE7EEF0)
    val topBar = Color(0xFF171B22)
    val topBarBorder = Color(0xFF2D3440)
    val topBarText = Color(0xFFE5E7EB)
    val topBarMuted = Color(0xFFB7C0CC)
    val topBarChip = Color(0xFF242B36)
}

private val homeGrowthCanonicalNames = mapOf(
    "v1c1s3k02" to "平均速度与瞬时速度",
    "v1c1s2k01" to "时刻与时间间隔",
    "v1c2s3k02" to "速度与位移的关系",
    "v1c2s2k01" to "速度与时间的关系",
    "v1c1s1k02" to "参考系",
)

enum class HomeEntryTone {
    Sync,
    Train,
    Gaokao,
    Review,
}

private data class HomeEntryPalette(
    val accent: Color,
    val background: Color,
    val border: Color,
)

private fun homeEntryPalette(tone: HomeEntryTone): HomeEntryPalette {
    return when (tone) {
        HomeEntryTone.Sync -> HomeEntryPalette(
            accent = Color(0xFF148A97),
            background = Color(0xFFEDF9FA),
            border = Color(0x47148A97),
        )
        HomeEntryTone.Train -> HomeEntryPalette(
            accent = Color(0xFF9A681B),
            background = Color(0xFFFFF8E9),
            border = Color(0x4DBA7F1F),
        )
        HomeEntryTone.Gaokao -> HomeEntryPalette(
            accent = Color(0xFF526AA0),
            background = Color(0xFFF2F5FC),
            border = Color(0x47526AA0),
        )
        HomeEntryTone.Review -> HomeEntryPalette(
            accent = Color(0xFFAD514D),
            background = Color(0xFFFFF2F1),
            border = Color(0x47B54F4A),
        )
    }
}

fun tabletHomeBrandSegments(): List<String> {
    return listOf("Open", "Physics")
}

fun tabletHomePrimaryNavItems(): List<String> {
    return listOf("同步学习", "巩固提升", "高考复习", "错题复盘")
}

fun tabletHomeLoopMetricLabels(): List<String> {
    return listOf("连续学习天数", "本周掌握知识点", "待复盘错题")
}

fun homeGrowthRecordTitle(): String {
    return "学习成长记录"
}

fun homeGrowthRecordDescription(streakDays: Int): String {
    return if (streakDays > 0) {
        "最近连续 ${streakDays} 天有学习记录，系统会根据作答、订正和知识点掌握变化持续更新反馈。"
    } else {
        "完成学习、练习或订正后，系统会记录知识点掌握变化，并给出下一步建议。"
    }
}

fun homeGrowthRecordStreakDays(dailyLoop: DailyLearningLoop?, dashboard: DashboardData?): Int {
    return dailyLoop?.streakDays ?: dashboard?.motivation?.streakDays ?: 0
}

fun homeGrowthAdviceDescription(): String {
    return "先按今日推荐完成最关键任务，再根据错题、掌握度和知识点状态选择入口。系统会用练习、订正和复盘数据更新下一步建议。"
}

fun homeGrowthReportSummary(report: GrowthReportData?): String {
    return report?.summary?.takeIf { it.isNotBlank() }
        ?.let { summary ->
            homeGrowthCanonicalNames.entries.fold(summary) { text, (id, name) -> text.replace(id, name) }
        }
        ?: "完成一段连续学习后，这里会整理近期掌握提升、错因变化和下一步复习重点。"
}

fun homeGrowthReportHistoryLabel(report: GrowthReportData?): String {
    return if (report != null && report.totalAnswers > 0) {
        "查看这 ${report.totalAnswers} 题记录"
    } else {
        "查看练习记录"
    }
}

data class MobileDailyLoopCalendarCellSpec(
    val aspectRatio: Float,
    val showsCellBorder: Boolean,
    val highlightsToday: Boolean,
    val compactRingSizeDp: Int,
    val ringGapDp: Float,
)

fun mobileDailyLoopCalendarCellSpec(): MobileDailyLoopCalendarCellSpec {
    return MobileDailyLoopCalendarCellSpec(
        aspectRatio = 0.72f,
        showsCellBorder = false,
        highlightsToday = true,
        compactRingSizeDp = 40,
        ringGapDp = 0f,
    )
}

fun tabletDailyLoopCalendarOverlayWidthDp(): Int {
    return 520
}

fun tabletHomeMissionCardWeight(): Float {
    return 2f
}

fun tabletHomeLoopCardWeight(): Float {
    return 1f
}

fun tabletDailyLoopCalendarOverlaysContent(): Boolean {
    return true
}

fun tabletDailyLoopCalendarOverlayTopOffsetDp(): Int {
    return 232
}

@Composable
fun HomeScreen(
    session: StudentSession,
    dashboard: DashboardData?,
    dailyLoop: DailyLearningLoop?,
    dailyLoopHistory: DailyLearningLoopHistory?,
    growthReport: GrowthReportData?,
    dashboardLoading: Boolean,
    dashboardError: String,
    onRefreshDashboard: () -> Unit,
    onDirectory: () -> Unit,
    onReinforcement: () -> Unit,
    onGaokao: () -> Unit,
    onHistory: () -> Unit,
    onGrowthHistory: (GrowthReportData) -> Unit,
    onReview: () -> Unit,
    onSettings: () -> Unit,
    onTodayTask: (HomeTask) -> Unit,
    teacherHomework: List<TeacherHomework> = emptyList(),
    onTeacherHomework: (TeacherHomework) -> Unit = {},
    onHomeworkHistory: () -> Unit = {},
) {
    val task = buildTodayTask(dashboard)
    MainPage(
        activeTab = MainTab.Home,
        onHome = {},
        onLearn = onDirectory,
        onPractice = onReinforcement,
        onReview = onReview,
        onMe = onSettings,
        onHistory = onHistory,
        onSettings = onSettings,
        showTabletTopBar = false,
    ) {
        if (LocalPhonePresentation.current) {
            PhoneHomeContent(task, dashboard, dailyLoop, dailyLoopHistory, growthReport,
                dashboardLoading, dashboardError, onRefreshDashboard, onDirectory,
                onReinforcement, onGaokao, onHistory, onGrowthHistory, onReview, onSettings, onTodayTask,
                studentName = session.displayLabel(), teacherHomework = teacherHomework,
                onTeacherHomework = onTeacherHomework, onHomeworkHistory = onHomeworkHistory)
            return@MainPage
        }
        TabletHomeContent(
            session = session,
            task = task,
            dashboard = dashboard,
            dailyLoop = dailyLoop,
            dailyLoopHistory = dailyLoopHistory,
            growthReport = growthReport,
            dashboardLoading = dashboardLoading,
            dashboardError = dashboardError,
            onRefreshDashboard = onRefreshDashboard,
            onDirectory = onDirectory,
            onReinforcement = onReinforcement,
            onGaokao = onGaokao,
            onHistory = onHistory,
            onGrowthHistory = onGrowthHistory,
            onReview = onReview,
            onSettings = onSettings,
            onTodayTask = onTodayTask,
            teacherHomework = teacherHomework,
            onTeacherHomework = onTeacherHomework,
            onHomeworkHistory = onHomeworkHistory,
        )
    }
}

@Composable
private fun TabletHomeContent(
    session: StudentSession,
    task: HomeTask,
    dashboard: DashboardData?,
    dailyLoop: DailyLearningLoop?,
    dailyLoopHistory: DailyLearningLoopHistory?,
    growthReport: GrowthReportData?,
    dashboardLoading: Boolean,
    dashboardError: String,
    onRefreshDashboard: () -> Unit,
    onDirectory: () -> Unit,
    onReinforcement: () -> Unit,
    onGaokao: () -> Unit,
    onHistory: () -> Unit,
    onGrowthHistory: (GrowthReportData) -> Unit,
    onReview: () -> Unit,
    onSettings: () -> Unit,
    onTodayTask: (HomeTask) -> Unit,
    teacherHomework: List<TeacherHomework>,
    onTeacherHomework: (TeacherHomework) -> Unit,
    onHomeworkHistory: () -> Unit,
) {
    var tabletLoopHistoryOpen by remember(dailyLoop?.date) { mutableStateOf(false) }
    Box(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val sidebar = LocalTabletShell.current.sidebarAvailable
            if (sidebar) {
                // iPad 首页: the sidebar carries navigation, so the page opens with its own headline.
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TabletSidebarRestoreButton()
                    Column(Modifier.padding(top = 4.dp, bottom = 2.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("今天怎么学", color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold)
                        Text("${session.displayLabel()}，先完成最值得做的一件事，再选择学习入口。",
                            color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            } else {
                TabletHomeTopNav(
                    session = session,
                    dashboard = dashboard,
                    dashboardLoading = dashboardLoading,
                    onDirectory = onDirectory,
                    onReinforcement = onReinforcement,
                    onGaokao = onGaokao,
                    onReview = onReview,
                    onHistory = onHistory,
                    onSettings = onSettings,
                )
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(IntrinsicSize.Min).heightIn(min = 214.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                TabletTodayMissionCard(
                    task = task,
                    dashboard = dashboard,
                    dashboardLoading = dashboardLoading,
                    dashboardError = dashboardError,
                    onRefreshDashboard = onRefreshDashboard,
                    onTodayTask = onTodayTask,
                    teacherHomework = teacherHomework,
                    onTeacherHomework = onTeacherHomework,
                    modifier = Modifier
                        .weight(tabletHomeMissionCardWeight())
                        .fillMaxHeight(),
                )
                TabletHomeLoopMetricsCard(
                    dashboard = dashboard,
                    dailyLoop = dailyLoop,
                    dashboardLoading = dashboardLoading,
                    onToggleHistory = { tabletLoopHistoryOpen = !tabletLoopHistoryOpen },
                    modifier = Modifier
                        .weight(tabletHomeLoopCardWeight())
                        .fillMaxHeight(),
                )
            }
            if (!sidebar) {
                TabletQuickActionsPanel(
                    dashboard = dashboard,
                    onDirectory = onDirectory,
                    onReinforcement = onReinforcement,
                    onGaokao = onGaokao,
                    onReview = onReview,
                    compact = false,
                )
            }
            HomeGrowthRecordSection(
                streakDays = homeGrowthRecordStreakDays(dailyLoop, dashboard),
                dashboard = dashboard,
                growthReport = growthReport,
                tablet = true,
                onRefresh = onRefreshDashboard,
                onHistory = onHistory,
                onGrowthHistory = onGrowthHistory,
                onHomeworkHistory = onHomeworkHistory,
            )
        }
        if (tabletLoopHistoryOpen && dailyLoop != null && tabletDailyLoopCalendarOverlaysContent()) {
            DailyLoopHistoryPanel(
                history = dailyLoopHistory,
                today = dailyLoop,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(y = tabletDailyLoopCalendarOverlayTopOffsetDp().dp)
                    .zIndex(1f)
                    .width(tabletDailyLoopCalendarOverlayWidthDp().dp),
                compact = false,
                scrollable = true,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TabletHomeTopNav(
    session: StudentSession,
    dashboard: DashboardData?,
    dashboardLoading: Boolean,
    onDirectory: () -> Unit,
    onReinforcement: () -> Unit,
    onGaokao: () -> Unit,
    onReview: () -> Unit,
    onHistory: () -> Unit,
    onSettings: () -> Unit,
) {
    FlowRow(
        modifier = Modifier
            .fillMaxWidth()
            .background(TabletHomeColors.topBar, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, TabletHomeColors.topBarBorder, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(horizontal = 16.dp, vertical = 9.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.align(Alignment.CenterVertically),
            horizontalArrangement = Arrangement.spacedBy(18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TabletHomeBrand()
            tabletHomePrimaryNavItems().forEach { item ->
                val onClick: () -> Unit = when (item) {
                    "同步学习" -> onDirectory
                    "巩固提升" -> onReinforcement
                    "高考复习" -> onGaokao
                    "错题复盘" -> onReview
                    else -> ({})
                }
                TabletHomeNavText(
                    text = item,
                    onClick = onClick,
                )
            }
        }
        Row(
            modifier = Modifier.align(Alignment.CenterVertically),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .background(TabletHomeColors.topBarChip, RoundedCornerShape(999.dp))
                    .border(1.dp, TabletHomeColors.topBarBorder, RoundedCornerShape(999.dp))
                    .clickable(onClick = onHistory)
                    .padding(horizontal = 12.dp, vertical = 5.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (dashboardLoading) "成长记录 · 读取中" else "成长记录 · 连续 ${dashboard?.motivation?.streakDays ?: 0} 天",
                    color = TabletHomeColors.topBarText,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Normal,
                )
            }
            Text(
                text = session.displayLabel(),
                modifier = Modifier.widthIn(max = 140.dp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = TabletHomeColors.topBarText,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
            )
            TabletHomeNavText(text = "个人中心", onClick = onSettings)
        }
    }
}

@Composable
private fun TabletHomeBrand() {
    val segments = tabletHomeBrandSegments()
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = segments.getOrNull(0).orEmpty(),
            color = OpenPhysicsColors.PrimaryDeep,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = segments.getOrNull(1).orEmpty(),
            color = TabletHomeColors.topBarText,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun TabletHomeNavText(
    text: String,
    active: Boolean = false,
    onClick: () -> Unit,
) {
    Text(
        text = text,
        color = if (active) OpenPhysicsColors.PrimaryDeep else TabletHomeColors.topBarMuted,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
        modifier = Modifier.clickable(onClick = onClick),
    )
}

@Composable
private fun TabletTeacherHomeworkRows(
    items: List<TeacherHomework>,
    onOpen: (TeacherHomework) -> Unit,
) {
    var expanded by remember(items) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        teacherHomeworkHomeRows(items, expanded).forEach { item ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("老师作业", color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold)
                    Text(item.title, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold)
                    Text(item.detail, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.bodyMedium)
                }
                if (item.status == "completed") {
                    SecondaryActionButton(text = item.actionTitle, onClick = { onOpen(item) }, modifier = Modifier.width(140.dp))
                } else {
                    PrimaryActionButton(text = item.actionTitle, onClick = { onOpen(item) }, modifier = Modifier.width(140.dp))
                }
            }
        }
        teacherHomeworkMoreLabel(homeTeacherHomework(items).otherPending.size, expanded)?.let { label ->
            TextButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(0.dp)) {
                Text(label, color = OpenPhysicsColors.PrimaryDeep, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun TabletTodayMissionCard(
    task: HomeTask,
    dashboard: DashboardData?,
    dashboardLoading: Boolean,
    dashboardError: String,
    onRefreshDashboard: () -> Unit,
    onTodayTask: (HomeTask) -> Unit,
    teacherHomework: List<TeacherHomework> = emptyList(),
    onTeacherHomework: (TeacherHomework) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val homeworkPending = teacherHomework.any { it.status != "completed" }
    Card(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 214.dp),
        shape = RoundedCornerShape(OpenPhysicsRadius.Large),
        colors = CardDefaults.cardColors(containerColor = OpenPhysicsColors.Surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, OpenPhysicsColors.Border),
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth()
                .background(
                    Brush.linearGradient(
                        listOf(
                            TabletHomeColors.cardGradientStart,
                            TabletHomeColors.cardGradientMid,
                            Color.White,
                        ),
                    ),
                )
                .padding(20.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(),
                verticalArrangement = Arrangement.Top,
            ) {
                Text(
                    text = "今日推荐任务",
                    color = OpenPhysicsColors.PrimaryDeep,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(10.dp))
                // iOS: a teacher's homework comes before the system's own recommendation.
                if (teacherHomework.isNotEmpty()) {
                    TabletTeacherHomeworkRows(teacherHomework, onTeacherHomework)
                    HorizontalDivider(Modifier.padding(vertical = 14.dp), color = OpenPhysicsColors.Border)
                }
                Text(
                    text = todayHeroTitle(task),
                    color = OpenPhysicsColors.Ink,
                    style = if (teacherHomework.isEmpty()) MaterialTheme.typography.headlineMedium
                        else MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = when {
                        dashboardLoading -> "正在生成今日学习建议。"
                        dashboardError.isNotBlank() -> dashboardError
                        dashboard == null -> "暂无学习画像，先从同步学习或巩固提升开始。"
                        else -> todayHeroReason(task)
                    },
                    color = OpenPhysicsColors.Muted,
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(modifier = Modifier.height(18.dp))
                if (dashboardError.isNotBlank()) {
                    SecondaryActionButton(
                        text = "重新生成",
                        onClick = onRefreshDashboard,
                        modifier = Modifier.width(172.dp),
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                }
                if (homeworkPending) {
                    SecondaryActionButton(
                        text = task.action,
                        enabled = !dashboardLoading,
                        modifier = Modifier.width(172.dp),
                        onClick = { onTodayTask(task) },
                    )
                } else {
                    PrimaryActionButton(
                        text = task.action,
                        enabled = !dashboardLoading,
                        modifier = Modifier.width(172.dp),
                        onClick = { onTodayTask(task) },
                    )
                }
            }
        }
    }
}

@Composable
private fun TabletHomeLoopMetricsCard(
    dashboard: DashboardData?,
    dailyLoop: DailyLearningLoop?,
    dashboardLoading: Boolean,
    onToggleHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // iPad 今日目标: double rings with "x/2 项达标", a labelled legend, then the three outcome counts.
    val practice = dailyLoop?.rings?.practice
    val review = dailyLoop?.rings?.review
    val closed = listOfNotNull(practice, review).count { it.completed }
    val ringSize = if (LocalConfiguration.current.screenWidthDp < 1000) 96.dp else 112.dp
    fun count(value: Int?) = if (dashboardLoading) "..." else "${value ?: 0}"
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.Surface, RoundedCornerShape(OpenPhysicsRadius.Large))
            .clickable(enabled = dailyLoop != null, onClick = onToggleHistory)
            .padding(16.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(Modifier.size(ringSize), contentAlignment = Alignment.Center) {
                PhoneGoalRings(practice, review, Modifier.fillMaxSize())
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("$closed/2", color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.ExtraBold)
                    Text("项达标", color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelSmall)
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("今日目标", color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold)
                PhoneGoalLegend("做题", practice, PhoneColors.Ring)
                PhoneGoalLegend("复盘", review, PhoneColors.RingGreen)
            }
        }
        HorizontalDivider(Modifier.padding(vertical = 10.dp), color = OpenPhysicsColors.Divider)
        Row(Modifier.fillMaxWidth()) {
            PhoneGoalMetric(tabletHomeLoopMetricLabels()[0],
                count(dailyLoop?.streakDays ?: dashboard?.motivation?.streakDays), TabletHomeColors.warm, Modifier.weight(1f))
            PhoneGoalMetric(tabletHomeLoopMetricLabels()[1],
                count(dashboard?.motivation?.weeklyKpsMastered), TabletHomeColors.success, Modifier.weight(1f))
            PhoneGoalMetric(tabletHomeLoopMetricLabels()[2],
                count(dashboard?.motivation?.mistakeBacklogCount), TabletHomeColors.danger, Modifier.weight(1f))
        }
    }
}

@Composable
private fun TabletQuickActionsPanel(
    dashboard: DashboardData?,
    onDirectory: () -> Unit,
    onReinforcement: () -> Unit,
    onGaokao: () -> Unit,
    onReview: () -> Unit,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    LearningCard(modifier = modifier) {
        if (compact) {
            SectionHeader(title = "学习入口")
        }
        if (compact) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                HomeEntryCard(
                    title = "同步学习",
                    subtitle = dashboard?.plan?.kpName ?: "按教材章节学习",
                    tone = HomeEntryTone.Sync,
                    onClick = onDirectory,
                    modifier = Modifier.fillMaxWidth(),
                )
                HomeEntryCard(
                    title = "巩固提升",
                    subtitle = "围绕薄弱点训练",
                    tone = HomeEntryTone.Train,
                    onClick = onReinforcement,
                    modifier = Modifier.fillMaxWidth(),
                )
                HomeEntryCard(
                    title = "高考复习",
                    subtitle = "按专题完成分层复习",
                    tone = HomeEntryTone.Gaokao,
                    onClick = onGaokao,
                    modifier = Modifier.fillMaxWidth(),
                )
                HomeEntryCard(
                    title = "错题复盘",
                    subtitle = "${dashboard?.motivation?.mistakeBacklogCount ?: 0} 道待复盘",
                    tone = HomeEntryTone.Review,
                    onClick = onReview,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                HomeEntryCard(
                    title = "同步学习",
                    subtitle = dashboard?.plan?.kpName ?: "按教材章节学习",
                    tone = HomeEntryTone.Sync,
                    onClick = onDirectory,
                    modifier = Modifier.weight(1f),
                )
                HomeEntryCard(
                    title = "巩固提升",
                    subtitle = "围绕薄弱点训练",
                    tone = HomeEntryTone.Train,
                    onClick = onReinforcement,
                    modifier = Modifier.weight(1f),
                )
                HomeEntryCard(
                    title = "高考复习",
                    subtitle = "按专题完成分层复习",
                    tone = HomeEntryTone.Gaokao,
                    onClick = onGaokao,
                    modifier = Modifier.weight(1f),
                )
                HomeEntryCard(
                    title = "错题复盘",
                    subtitle = "${dashboard?.motivation?.mistakeBacklogCount ?: 0} 道待复盘",
                    tone = HomeEntryTone.Review,
                    onClick = onReview,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun HomeGrowthRecordSection(
    streakDays: Int,
    dashboard: DashboardData?,
    growthReport: GrowthReportData?,
    tablet: Boolean,
    onRefresh: () -> Unit,
    onHistory: () -> Unit,
    onGrowthHistory: (GrowthReportData) -> Unit,
    modifier: Modifier = Modifier,
    onHomeworkHistory: (() -> Unit)? = null,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(OpenPhysicsRadius.Large),
        colors = CardDefaults.cardColors(containerColor = OpenPhysicsColors.Surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, OpenPhysicsColors.Border),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Text(
                    text = homeGrowthRecordTitle(),
                    color = OpenPhysicsColors.Ink,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
                MutedText(homeGrowthRecordDescription(streakDays))
            }
            GrowthSectionDivider()
            if (tablet) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(IntrinsicSize.Min)
                        .padding(horizontal = 20.dp, vertical = 18.dp),
                ) {
                    GrowthAdviceContent(
                        dashboard = dashboard,
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .padding(end = 24.dp),
                    )
                    Box(
                        modifier = Modifier
                            .width(1.dp)
                            .fillMaxHeight()
                            .background(OpenPhysicsColors.Border),
                    )
                    GrowthReportContent(
                        report = growthReport,
                        onRefresh = onRefresh,
                        onHistory = onHistory,
                        onGrowthHistory = onGrowthHistory,
                        onHomeworkHistory = onHomeworkHistory,
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .padding(start = 24.dp),
                    )
                }
            } else {
                Column(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(18.dp),
                ) {
                    GrowthAdviceContent(dashboard = dashboard)
                    GrowthSectionDivider()
                    GrowthReportContent(
                        report = growthReport,
                        onRefresh = onRefresh,
                        onHistory = onHistory,
                        onGrowthHistory = onGrowthHistory,
                        onHomeworkHistory = onHomeworkHistory,
                    )
                }
            }
        }
    }
}

@Composable
private fun GrowthAdviceContent(
    dashboard: DashboardData?,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            text = "下一步建议",
            color = OpenPhysicsColors.Ink,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = homeGrowthAdviceDescription(),
            color = OpenPhysicsColors.Muted,
            style = MaterialTheme.typography.bodyMedium,
        )
        dashboard?.motivation?.nextMilestone?.takeIf { it.isNotBlank() }?.let { milestone ->
            Spacer(modifier = Modifier.weight(1f))
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(60.dp)
                    .background(OpenPhysicsColors.Primary.copy(alpha = 0.08f), RoundedCornerShape(12.dp))
                    .border(
                        1.dp,
                        OpenPhysicsColors.Primary.copy(alpha = 0.18f),
                        RoundedCornerShape(12.dp),
                    )
                    .padding(horizontal = 14.dp),
                verticalArrangement = Arrangement.spacedBy(
                    3.dp,
                    Alignment.CenterVertically,
                ),
            ) {
                Text(
                    text = "下一目标",
                    color = OpenPhysicsColors.Muted,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = milestone,
                    color = OpenPhysicsColors.PrimaryDeep,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@Composable
private fun GrowthReportContent(
    report: GrowthReportData?,
    onRefresh: () -> Unit,
    onHistory: () -> Unit,
    onGrowthHistory: (GrowthReportData) -> Unit,
    modifier: Modifier = Modifier,
    onHomeworkHistory: (() -> Unit)? = null,
) {
    val summary = homeGrowthReportSummary(report)
    var summaryOverflows by remember(report?.id, summary) { mutableStateOf(false) }
    var showFullReport by remember(report?.id, summary) { mutableStateOf(false) }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "成长回顾",
                modifier = Modifier.weight(1f),
                color = OpenPhysicsColors.Ink,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            if (report != null && summaryOverflows) {
                Text(
                    text = "完整回顾",
                    modifier = Modifier
                        .clickable(role = Role.Button) { showFullReport = true }
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    color = OpenPhysicsColors.PrimaryDeep,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(999.dp))
                    .border(1.dp, OpenPhysicsColors.Primary.copy(alpha = 0.22f), RoundedCornerShape(999.dp))
                    .clickable(onClick = onRefresh),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "↻",
                    color = OpenPhysicsColors.PrimaryDeep,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
        Text(
            text = summary,
            color = if (report == null) OpenPhysicsColors.Muted else OpenPhysicsColors.Ink,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
            onTextLayout = { summaryOverflows = it.hasVisualOverflow },
        )
        if (report != null && report.startDate.isNotBlank() && report.endDate.isNotBlank()) {
            Text(
                text = "${report.startDate} ~ ${report.endDate}",
                color = OpenPhysicsColors.Muted,
                style = MaterialTheme.typography.labelMedium,
            )
        }
        Spacer(modifier = Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            GrowthHistoryAction(
                text = homeGrowthReportHistoryLabel(report),
                onClick = {
                    if (report != null && report.totalAnswers > 0) onGrowthHistory(report) else onHistory()
                },
                modifier = Modifier.weight(1f),
            )
            if (onHomeworkHistory != null) {
                GrowthHistoryAction(
                    label = "作业记录",
                    text = "查看历次作业得分",
                    onClick = onHomeworkHistory,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }

    if (showFullReport && report != null) {
        val maxTextHeight = LocalConfiguration.current.screenHeightDp.dp * 0.55f
        AlertDialog(
            onDismissRequest = { showFullReport = false },
            modifier = Modifier.widthIn(max = 720.dp).fillMaxWidth(0.9f),
            properties = DialogProperties(usePlatformDefaultWidth = false),
            title = { Text("成长回顾") },
            text = {
                Column(
                    modifier = Modifier
                        .heightIn(max = maxTextHeight)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (report.startDate.isNotBlank() && report.endDate.isNotBlank()) {
                        Text(
                            text = "${report.startDate} ~ ${report.endDate}",
                            color = OpenPhysicsColors.Muted,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                    Text(
                        text = summary,
                        color = OpenPhysicsColors.Ink,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { showFullReport = false }) { Text("关闭") }
            },
        )
    }
}

@Composable
private fun GrowthHistoryAction(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    label: String = "练习记录",
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(60.dp)
            .background(OpenPhysicsColors.Primary.copy(alpha = 0.08f), RoundedCornerShape(12.dp))
            .border(
                1.dp,
                OpenPhysicsColors.Primary.copy(alpha = 0.18f),
                RoundedCornerShape(12.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                text = label,
                color = OpenPhysicsColors.Muted,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = text,
                color = OpenPhysicsColors.PrimaryDeep,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
            )
        }
        Text(
            text = "›",
            color = OpenPhysicsColors.PrimaryDeep,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun GrowthSectionDivider() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(OpenPhysicsColors.Border),
    )
}

@Composable
internal fun DailyLoopHistoryPanel(
    history: DailyLearningLoopHistory?,
    today: DailyLearningLoop,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    scrollable: Boolean = false,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .then(
                if (scrollable) {
                    Modifier
                        .heightIn(max = if (compact) 500.dp else 800.dp)
                        .verticalScroll(rememberScrollState())
                } else {
                    Modifier
                },
            )
            .padding(if (compact) 10.dp else 12.dp),
        verticalArrangement = Arrangement.spacedBy(if (compact) 7.dp else 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "闭环日历",
                style = MaterialTheme.typography.titleMedium,
                color = OpenPhysicsColors.Ink,
                fontWeight = FontWeight.Bold,
            )
            Spacer(modifier = Modifier.weight(1f))
            Text(
                text = history?.let { "近${it.days.size}天" } ?: "历史暂不可用",
                style = MaterialTheme.typography.labelMedium,
                color = OpenPhysicsColors.Muted,
            )
        }
        Text(
            text = "今日：做题 ${ringCountLabel(today.rings.practice)} · 复盘 ${ringCountLabel(today.rings.review)}",
            style = MaterialTheme.typography.bodyMedium,
            color = OpenPhysicsColors.Muted,
        )
        val syncedHistory = history?.let { mobileDailyLoopHistoryWithToday(it, today) }
        if (syncedHistory == null) {
            MutedText("暂时无法获取历史记录，稍后可刷新首页重试。")
            return@Column
        }
        Row(horizontalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 8.dp)) {
            DailyLoopHistoryStat("做题", syncedHistory.summary.practiceTotal, Modifier.weight(1f))
            DailyLoopHistoryStat("复盘", syncedHistory.summary.reviewTotal, Modifier.weight(1f))
            DailyLoopHistoryStat("双环", syncedHistory.summary.dualClosedDays, Modifier.weight(1f))
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            WEEKDAY_LABELS.forEach { label ->
                Text(
                    text = label,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelSmall,
                    color = OpenPhysicsColors.Muted,
                    textAlign = TextAlign.Center,
                )
            }
        }
        mobileDailyLoopMonthSections(syncedHistory).forEach { section ->
            Text(
                text = section.label,
                modifier = Modifier.fillMaxWidth(),
                style = MaterialTheme.typography.labelLarge,
                color = OpenPhysicsColors.Ink,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            section.cells.chunked(7).forEach { week ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    week.forEach { cell ->
                        DailyLoopCalendarCell(cell = cell, compact = compact, modifier = Modifier.weight(1f))
                    }
                    repeat(7 - week.size) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun DailyLoopHistoryStat(label: String, value: Int, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Small))
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text("$value", style = MaterialTheme.typography.titleMedium, color = OpenPhysicsColors.Ink, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.labelSmall, color = OpenPhysicsColors.Muted)
    }
}

@Composable
private fun DailyLoopCalendarCell(
    cell: MobileDailyLoopCalendarCell,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    val day = cell.day
    val spec = mobileDailyLoopCalendarCellSpec()
    val dayColor = when {
        cell.isToday -> OpenPhysicsColors.Ink
        day?.isEffectiveDay == true -> OpenPhysicsColors.PrimaryDeep
        else -> OpenPhysicsColors.Subtle
    }
    val borderColor = when {
        cell.isToday -> OpenPhysicsColors.PrimaryDeep
        day?.isHighQualityDay == true -> OpenPhysicsColors.Primary
        else -> OpenPhysicsColors.Border
    }
    val cellChrome = if (spec.showsCellBorder) {
        Modifier
            .background(
                if (cell.isToday || day?.isHighQualityDay == true) Color(0xFFF6FEFF) else Color.White,
                RoundedCornerShape(OpenPhysicsRadius.Small),
            )
            .border(1.dp, borderColor, RoundedCornerShape(OpenPhysicsRadius.Small))
    } else {
        Modifier
    }
    Column(
        modifier = modifier
            .aspectRatio(spec.aspectRatio)
            .then(cellChrome)
            .padding(if (compact) 1.dp else 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(if (compact) 2.dp else 6.dp, Alignment.CenterVertically),
    ) {
        if (cell.iso == null) {
            return@Column
        }
        Text(
            text = "${cell.dayOfMonth}",
            style = if (compact) MaterialTheme.typography.labelSmall else MaterialTheme.typography.titleSmall,
            color = dayColor,
            fontWeight = if (day?.isEffectiveDay == true || cell.isToday) FontWeight.Bold else FontWeight.SemiBold,
        )
        DailyLoopMiniRings(day = day, compact = compact)
    }
}

@Composable
private fun DailyLoopMiniRings(day: DailyLearningLoopDay?, compact: Boolean = false) {
    val state = day?.let { mobileDailyLoopRingState(it.rings) }
    val spec = mobileDailyLoopCalendarCellSpec()
    val ringSize = if (compact) spec.compactRingSizeDp.dp else 42.dp
    Canvas(modifier = Modifier.size(ringSize)) {
        val outerStrokeWidth = (if (compact) 7.dp else 6.dp).toPx()
        val innerStrokeWidth = (if (compact) 6.8.dp else 5.4.dp).toPx()
        val outerStroke = Stroke(width = outerStrokeWidth, cap = StrokeCap.Round)
        val innerStroke = Stroke(width = innerStrokeWidth, cap = StrokeCap.Round)
        val outerInset = (if (compact) 3.dp else 4.dp).toPx()
        val innerInset = outerInset + ((outerStrokeWidth + innerStrokeWidth) / 2f) + spec.ringGapDp.dp.toPx()
        drawArc(
            color = TabletHomeColors.ringTrack,
            startAngle = -90f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = androidx.compose.ui.geometry.Offset(outerInset, outerInset),
            size = androidx.compose.ui.geometry.Size(size.width - outerInset * 2, size.height - outerInset * 2),
            style = outerStroke,
        )
        drawArc(
            color = TabletHomeColors.practice,
            startAngle = -90f,
            sweepAngle = 360f * (state?.practiceProgress ?: 0.0).toFloat(),
            useCenter = false,
            topLeft = androidx.compose.ui.geometry.Offset(outerInset, outerInset),
            size = androidx.compose.ui.geometry.Size(size.width - outerInset * 2, size.height - outerInset * 2),
            style = outerStroke,
        )
        drawArc(
            color = TabletHomeColors.practiceOverflow,
            startAngle = -90f,
            sweepAngle = 360f * (state?.practiceOverflowProgress ?: 0.0).toFloat(),
            useCenter = false,
            topLeft = androidx.compose.ui.geometry.Offset(outerInset, outerInset),
            size = androidx.compose.ui.geometry.Size(size.width - outerInset * 2, size.height - outerInset * 2),
            style = outerStroke,
        )
        drawArc(
            color = TabletHomeColors.ringTrack,
            startAngle = -90f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = androidx.compose.ui.geometry.Offset(innerInset, innerInset),
            size = androidx.compose.ui.geometry.Size(size.width - innerInset * 2, size.height - innerInset * 2),
            style = innerStroke,
        )
        drawArc(
            color = TabletHomeColors.review,
            startAngle = -90f,
            sweepAngle = 360f * (state?.reviewProgress ?: 0.0).toFloat(),
            useCenter = false,
            topLeft = androidx.compose.ui.geometry.Offset(innerInset, innerInset),
            size = androidx.compose.ui.geometry.Size(size.width - innerInset * 2, size.height - innerInset * 2),
            style = innerStroke,
        )
    }
}

data class MobileDailyLoopRingState(
    val closedCount: Int,
    val practiceProgress: Double,
    val practiceOverflowProgress: Double,
    val reviewProgress: Double,
    val reviewOverflowProgress: Double,
    val reviewAutoCompleted: Boolean,
    val practiceCountLabel: String,
    val reviewCountLabel: String,
)

data class MobileDailyLoopMonthSection(
    val label: String,
    val cells: List<MobileDailyLoopCalendarCell>,
)

data class MobileDailyLoopCalendarCell(
    val iso: String?,
    val dayOfMonth: Int?,
    val day: DailyLearningLoopDay?,
    val inHistoryRange: Boolean,
    val isToday: Boolean,
)

fun mobileDailyLoopRingState(rings: DailyLoopRings): MobileDailyLoopRingState {
    return MobileDailyLoopRingState(
        closedCount = listOf(rings.practice, rings.review).count { it.completed },
        practiceProgress = ringCompletionRatio(rings.practice),
        practiceOverflowProgress = ringOverflowRatio(rings.practice),
        reviewProgress = ringCompletionRatio(rings.review),
        reviewOverflowProgress = ringOverflowRatio(rings.review),
        reviewAutoCompleted = rings.review.autoCompleted,
        practiceCountLabel = ringCountLabel(rings.practice),
        reviewCountLabel = ringCountLabel(rings.review),
    )
}

fun mobileDailyLoopMonthSections(history: DailyLearningLoopHistory): List<MobileDailyLoopMonthSection> {
    val start = parseIsoDay(history.startDate) ?: return emptyList()
    val end = parseIsoDay(history.endDate) ?: return emptyList()
    val dayMap = history.days.associateBy { it.date }
    val sections = mutableListOf<MobileDailyLoopMonthSection>()
    var year = start.year
    var month = start.month
    while (year < end.year || (year == end.year && month <= end.month)) {
        val cells = mutableListOf<MobileDailyLoopCalendarCell>()
        repeat(firstWeekdayOffset(year, month)) {
            cells += MobileDailyLoopCalendarCell(null, null, null, inHistoryRange = false, isToday = false)
        }
        for (day in 1..daysInMonth(year, month)) {
            val iso = isoDate(year, month, day)
            cells += MobileDailyLoopCalendarCell(
                iso = iso,
                dayOfMonth = day,
                day = dayMap[iso],
                inHistoryRange = iso >= history.startDate && iso <= history.endDate,
                isToday = iso == history.endDate,
            )
        }
        sections += MobileDailyLoopMonthSection("${year}年${month}月", cells)
        month += 1
        if (month == 13) {
            month = 1
            year += 1
        }
    }
    return sections.asReversed()
}

fun mobileDailyLoopHistoryWithToday(
    history: DailyLearningLoopHistory,
    today: DailyLearningLoop,
): DailyLearningLoopHistory {
    if (today.date < history.startDate || today.date > history.endDate) return history
    val days = history.days
        .filterNot { it.date == today.date }
        .plus(
            DailyLearningLoopDay(
                date = today.date,
                isEffectiveDay = today.isEffectiveDay,
                isHighQualityDay = today.isHighQualityDay,
                rings = today.rings,
                summary = today.summary,
                nextAction = today.nextAction,
            ),
        )
        .sortedBy { it.date }

    return history.copy(
        days = days,
        summary = DailyLearningLoopHistorySummary(
            practiceTotal = days.sumOf { it.rings.practice.actualCurrent },
            reviewTotal = days.sumOf { it.rings.review.actualCurrent },
            practiceClosedDays = days.count { it.rings.practice.completed },
            reviewClosedDays = days.count { it.rings.review.completed },
            dualClosedDays = days.count { it.isHighQualityDay },
            effectiveDays = days.count { it.isEffectiveDay },
        ),
    )
}

private fun ringCompletionRatio(ring: DailyLoopRing): Double {
    if (ring.target <= 0) return 0.0
    return (ring.current.toDouble() / ring.target.toDouble()).coerceIn(0.0, 1.0)
}

private fun ringOverflowRatio(ring: DailyLoopRing): Double {
    if (ring.target <= 0) return 0.0
    return (ring.current.toDouble() / ring.target.toDouble() - 1.0).coerceIn(0.0, 1.0)
}

private fun ringCountLabel(ring: DailyLoopRing): String {
    val base = "${ring.actualCurrent}/${ring.target}"
    return if (ring.autoCompleted) "$base · 无待复盘" else base
}

private data class SimpleIsoDay(val year: Int, val month: Int, val day: Int)

private val WEEKDAY_LABELS = listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")

private fun parseIsoDay(value: String): SimpleIsoDay? {
    val parts = value.split("-")
    if (parts.size != 3) return null
    val year = parts[0].toIntOrNull() ?: return null
    val month = parts[1].toIntOrNull() ?: return null
    val day = parts[2].toIntOrNull() ?: return null
    return SimpleIsoDay(year, month, day)
}

private fun isoDate(year: Int, month: Int, day: Int): String {
    return "${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}"
}

private fun firstWeekdayOffset(year: Int, month: Int): Int {
    val adjustedMonth = if (month < 3) month + 12 else month
    val adjustedYear = if (month < 3) year - 1 else year
    val century = adjustedYear / 100
    val yearOfCentury = adjustedYear % 100
    val zeller = (1 + ((13 * (adjustedMonth + 1)) / 5) + yearOfCentury + (yearOfCentury / 4) + (century / 4) + (5 * century)) % 7
    val sundayZero = (zeller + 6) % 7
    return (sundayZero + 6) % 7
}

private fun daysInMonth(year: Int, month: Int): Int {
    return when (month) {
        1, 3, 5, 7, 8, 10, 12 -> 31
        4, 6, 9, 11 -> 30
        2 -> if (isLeapYear(year)) 29 else 28
        else -> 30
    }
}

private fun isLeapYear(year: Int): Boolean {
    return year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

@Composable
private fun HomeEntryCard(
    title: String,
    subtitle: String,
    tone: HomeEntryTone,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    HomeEntrySurface(
        title = title,
        subtitle = subtitle,
        tone = tone,
        onClick = onClick,
        modifier = modifier
            .heightIn(min = 82.dp),
        accentHeight = 58.dp,
        contentPaddingVertical = 12.dp,
    )
}

@Composable
private fun HomeEntrySurface(
    title: String,
    subtitle: String,
    tone: HomeEntryTone,
    onClick: () -> Unit,
    modifier: Modifier,
    accentHeight: androidx.compose.ui.unit.Dp,
    contentPaddingVertical: androidx.compose.ui.unit.Dp,
) {
    val palette = homeEntryPalette(tone)
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier = modifier
            .clip(shape)
            .background(
                brush = Brush.linearGradient(listOf(palette.background, Color.White)),
                shape = shape,
            )
            .border(1.dp, palette.border, shape)
            .clickable(onClick = onClick),
    ) {
        Box(
            modifier = Modifier
                .align(Alignment.CenterStart)
                .width(4.dp)
                .height(accentHeight)
                .background(
                    color = palette.accent,
                    shape = RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp),
                ),
        )
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = contentPaddingVertical),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                color = OpenPhysicsColors.Ink,
                fontWeight = FontWeight.ExtraBold,
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = OpenPhysicsColors.Muted,
            )
        }
    }
}

private fun todayHeroTitle(task: HomeTask): String {
    return when (task.actionType) {
        HomeTaskAction.Review -> "先清除 ${task.title}"
        HomeTaskAction.Sync -> task.title
        HomeTaskAction.Reinforcement -> task.title
    }
}

private fun todayHeroReason(task: HomeTask): String {
    return when (task.actionType) {
        HomeTaskAction.Review -> "先把已经暴露的问题闭环，再进入新知识或新题，提升效率更高。"
        HomeTaskAction.Sync -> "先理解概念和公式，再进入掌握评估或巩固练习，学习路径会更稳。"
        HomeTaskAction.Reinforcement -> task.reason.ifBlank { "完成一组综合练习，保持题感并更新下一步建议。" }
    }
}

enum class HomeTaskAction {
    Sync,
    Reinforcement,
    Review,
}

data class HomeTask(
    val title: String,
    val reason: String,
    val action: String,
    val actionType: HomeTaskAction,
    val kpId: String = "",
    val estimatedMinutes: Int,
    val expectedGain: String,
    val shortAction: String,
    val stageLabel: String,
)

fun buildTodayTask(dashboard: DashboardData?): HomeTask {
    if ((dashboard?.motivation?.mistakeBacklogCount ?: 0) > 0) {
        val count = dashboard?.motivation?.mistakeBacklogCount ?: 0
        return HomeTask(
            title = "$count 道错题待复盘",
            reason = "先闭环错题，再进入新题。",
            action = "去复盘错题",
            actionType = HomeTaskAction.Review,
            estimatedMinutes = (count * 4).coerceIn(8, 24),
            expectedGain = "错因清晰",
            shortAction = "复盘",
            stageLabel = "先复盘",
        )
    }
    val plan = dashboard?.plan
    if (plan != null) {
        val needsLearning = plan.mastery < 0.4
        return HomeTask(
            title = "推进「${plan.kpName}」",
            reason = plan.reason.ifBlank { "按掌握度推荐。" },
            action = if (needsLearning) "进入同步学习" else "进入巩固提升",
            actionType = if (needsLearning) HomeTaskAction.Sync else HomeTaskAction.Reinforcement,
            kpId = plan.kpId,
            estimatedMinutes = plan.estimatedMinutes.coerceAtLeast(8),
            expectedGain = "+${expectedMasteryGain(plan.mastery)}%",
            shortAction = if (needsLearning) "学习" else "训练",
            stageLabel = if (needsLearning) "先理解" else "再巩固",
        )
    }
    return HomeTask(
        title = "完成一次综合练习",
        reason = dashboard?.motivation?.nextMilestone?.ifBlank { null } ?: "保持手感。",
        action = "开始巩固提升",
        actionType = HomeTaskAction.Reinforcement,
        estimatedMinutes = 12,
        expectedGain = "稳定手感",
        shortAction = "练习",
        stageLabel = "再巩固",
    )
}

private fun expectedMasteryGain(mastery: Double): Int {
    return when {
        mastery < 0.25 -> 18
        mastery < 0.45 -> 14
        mastery < 0.7 -> 10
        else -> 6
    }
}
