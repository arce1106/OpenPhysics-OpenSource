package cn.openphysics.androidapp.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.StudentAccessPolicy
import cn.openphysics.androidapp.domain.StudentSession
import cn.openphysics.androidapp.ui.AppController
import cn.openphysics.androidapp.ui.Screen
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors

/** iPad sidebar sections, in the same order and with the same names. */
internal enum class TabletSection(val title: String, val symbol: PhoneSymbol) {
    Home("首页", PhoneSymbol.Home),
    Sync("同步学习", PhoneSymbol.Book),
    Reinforcement("巩固提升", PhoneSymbol.Target),
    Gaokao("高考复习", PhoneSymbol.Graduation),
    Review("错题本", PhoneSymbol.Retry),
    Account("个人中心", PhoneSymbol.User),
}

/**
 * What the persistent tablet sidebar means for the page inside it: when it is shown, a section's
 * root page needs no way "home" (the sidebar is it), and its title bar offers the section refresh.
 */
internal data class TabletShellChrome(
    /** The window has a sidebar (shown or collapsed), so section roots never need a way home. */
    val sidebarAvailable: Boolean = false,
    /** Collapsed: title bars carry the ⊟ button that brings it back, as on iPad. */
    val sidebarCollapsed: Boolean = false,
    val onToggleSidebar: (() -> Unit)? = null,
    val onRefresh: (() -> Unit)? = null,
) {
    val sidebarVisible: Boolean get() = sidebarAvailable && !sidebarCollapsed
}

internal val LocalTabletShell = staticCompositionLocalOf { TabletShellChrome() }

/** Lets a page with unsaved edits (个人中心) confirm before the sidebar switches sections. */
internal class TabletNavigationGuard {
    var intercept: ((() -> Unit) -> Unit)? = null
}

internal val LocalTabletNavigationGuard = staticCompositionLocalOf<TabletNavigationGuard?> { null }

/**
 * Sidebar visibility as the window changes width, the iPad rule: going narrow (portrait) collapses
 * it; going wide again reopens it only if narrowing was what closed it, so a sidebar the student
 * closed stays closed. Starting narrow counts as open, as the iPad does on a portrait launch.
 */
internal data class TabletSidebarState(
    val collapsed: Boolean = false,
    val collapsedForNarrow: Boolean = false,
    val lastNarrow: Boolean? = null,
) {
    fun afterWidth(narrow: Boolean): TabletSidebarState = when {
        narrow && lastNarrow != true -> TabletSidebarState(
            collapsed = true,
            collapsedForNarrow = lastNarrow == null || !collapsed,
            lastNarrow = true,
        )
        !narrow && lastNarrow == true -> TabletSidebarState(
            collapsed = if (collapsedForNarrow) false else collapsed,
            collapsedForNarrow = false,
            lastNarrow = false,
        )
        else -> copy(lastNarrow = narrow)
    }
}

internal fun Screen.tabletStudentSession(): StudentSession? = when (this) {
    is Screen.Login, is Screen.Loading -> null
    is Screen.Error -> unavailableSession
    is Screen.Home -> session
    is Screen.Settings -> session
    is Screen.LearnHub -> session
    is Screen.History -> session
    is Screen.HomeworkHistory -> session
    is Screen.Review -> session
    is Screen.HistoryDetail -> session
    is Screen.ReviewDetail -> session
    is Screen.ReviewRetryQuestion -> session
    is Screen.Directory -> session
    is Screen.GaokaoReview -> session
    is Screen.ReinforcementHome -> session
    is Screen.ReinforcementChapterPath -> session
    is Screen.ReinforcementScopeResult -> session
    is Screen.ReinforcementRetestResult -> session
    is Screen.ReinforcementTaskComplete -> session
    is Screen.ReinforcementReport -> session
    is Screen.ReinforcementReportHistory -> session
    is Screen.ReinforcementDiagnosticHistory -> session
    is Screen.ReinforcementDiagnosticAttemptDetail -> session
    is Screen.ReinforcementLearningTrace -> session
    is Screen.Learn -> session
    is Screen.PracticeQuestionScreen -> session
    is Screen.PracticeResultScreen -> session
    is Screen.PracticeReviewScreen -> session
}

/** The section a page belongs to; null keeps the last highlighted one (loading, results). */
internal fun Screen.tabletSection(): TabletSection? = when (this) {
    is Screen.Home -> TabletSection.Home
    is Screen.Directory, is Screen.Learn, is Screen.LearnHub -> TabletSection.Sync
    is Screen.ReinforcementHome, is Screen.ReinforcementChapterPath, is Screen.ReinforcementScopeResult,
    is Screen.ReinforcementRetestResult, is Screen.ReinforcementTaskComplete, is Screen.ReinforcementReport,
    is Screen.ReinforcementReportHistory, is Screen.ReinforcementDiagnosticHistory,
    is Screen.ReinforcementDiagnosticAttemptDetail, is Screen.ReinforcementLearningTrace -> TabletSection.Reinforcement
    is Screen.GaokaoReview -> TabletSection.Gaokao
    is Screen.Review, is Screen.ReviewDetail, is Screen.ReviewRetryQuestion -> TabletSection.Review
    is Screen.Settings, is Screen.History, is Screen.HistoryDetail -> TabletSection.Account
    is Screen.HomeworkHistory -> TabletSection.Home
    else -> null
}

/** Answering keeps the whole width, as on iPad, where practice collapses the sidebar. */
private fun Screen.hidesTabletSidebar(): Boolean =
    this is Screen.Login || this is Screen.PracticeQuestionScreen || this is Screen.ReviewRetryQuestion

@Composable
internal fun TabletShellHost(controller: AppController, content: @Composable () -> Unit) {
    val configuration = LocalConfiguration.current
    val screen = controller.screen
    var lastSession by remember { mutableStateOf<StudentSession?>(null) }
    var lastSection by remember { mutableStateOf(TabletSection.Home) }
    screen.tabletStudentSession()?.let { if (lastSession != it) lastSession = it }
    if (screen is Screen.Login) lastSession = null
    screen.tabletSection()?.let { if (lastSection != it) lastSection = it }
    val session = lastSession
    val guard = remember { TabletNavigationGuard() }
    var sidebarCollapsed by rememberSaveable { mutableStateOf(false) }
    var collapsedForNarrow by rememberSaveable { mutableStateOf(false) }
    var lastNarrow by rememberSaveable { mutableStateOf<Boolean?>(null) }
    val available = !LocalPhonePresentation.current &&
        supportsTabletWorkbench(configuration.screenWidthDp, configuration.screenHeightDp)
    val narrow = tabletSidebarOverlays(configuration.screenWidthDp)
    if (available && lastNarrow != narrow) {
        val next = TabletSidebarState(sidebarCollapsed, collapsedForNarrow, lastNarrow).afterWidth(narrow)
        sidebarCollapsed = next.collapsed
        collapsedForNarrow = next.collapsedForNarrow
        lastNarrow = next.lastNarrow
    }
    val collapsed = sidebarCollapsed
    if (!available || session == null || screen.hidesTabletSidebar()) {
        CompositionLocalProvider(LocalTabletShell provides TabletShellChrome(onRefresh = tabletRefresh(controller, screen))) {
            content()
        }
        return
    }
    val selectSection: (TabletSection) -> Unit = { target ->
        val go: () -> Unit = {
            lastSection = target // highlight at once, not after the section finishes loading
            when (target) {
                TabletSection.Home -> controller.showHome(session)
                TabletSection.Sync -> controller.loadDirectory(session, asRoot = true)
                TabletSection.Reinforcement -> controller.loadReinforcementHome(session, asRoot = true)
                TabletSection.Gaokao -> controller.loadGaokaoReview(session, asRoot = true)
                TabletSection.Review -> controller.loadReview(session, asRoot = true)
                TabletSection.Account -> controller.showSettingsRoot(session)
            }
            // Portrait: the sidebar was opened to navigate; give the page its width back.
            if (narrow) sidebarCollapsed = true
        }
        guard.intercept?.invoke(go) ?: go()
    }
    val pageContent: @Composable () -> Unit = {
        CompositionLocalProvider(
            LocalTabletShell provides TabletShellChrome(
                sidebarAvailable = true,
                sidebarCollapsed = collapsed || narrow,
                onToggleSidebar = { sidebarCollapsed = !sidebarCollapsed },
                onRefresh = tabletRefresh(controller, screen),
            ),
            LocalTabletNavigationGuard provides guard,
        ) {
            content()
        }
    }
    if (narrow) {
        // Portrait: the page keeps the full width and the sidebar opens over it, as on iPad.
        BackHandler(enabled = !collapsed) { sidebarCollapsed = true }
        Box(Modifier.fillMaxSize().background(OpenPhysicsColors.Background)) {
            Box(Modifier.fillMaxSize().padding(start = 12.dp, top = 12.dp, bottom = 12.dp)) { pageContent() }
            AnimatedVisibility(
                visible = !collapsed,
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.18f))
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = { sidebarCollapsed = true },
                        )
                        .semantics { contentDescription = "收起侧边栏" },
                )
            }
            AnimatedVisibility(
                visible = !collapsed,
                enter = slideInHorizontally { -it } + fadeIn(),
                exit = slideOutHorizontally { -it } + fadeOut(),
            ) {
                // Taps on the sidebar's empty space must not fall through to the scrim and close it.
                Box(
                    Modifier.fillMaxHeight().padding(start = 12.dp, top = 12.dp, bottom = 12.dp).clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = {},
                    ),
                ) {
                    TabletSidebar(
                        selected = lastSection,
                        session = session,
                        onCollapse = { sidebarCollapsed = true },
                        onSelect = selectSection,
                    )
                }
            }
        }
        return
    }
    Row(
        Modifier.fillMaxSize().background(OpenPhysicsColors.Background)
            .padding(start = 12.dp, top = 12.dp, bottom = 12.dp),
    ) {
        AnimatedVisibility(
            visible = !collapsed,
            enter = expandHorizontally(expandFrom = Alignment.Start) + fadeIn(),
            exit = shrinkHorizontally(shrinkTowards = Alignment.Start) + fadeOut(),
        ) {
            TabletSidebar(
                selected = lastSection,
                session = session,
                onCollapse = { sidebarCollapsed = true },
                onSelect = selectSection,
            )
        }
        Box(Modifier.weight(1f).fillMaxHeight()) { pageContent() }
    }
}

/** Section roots refresh in place, the way the iPad title bar's ↻ does. */
private fun tabletRefresh(controller: AppController, screen: Screen): (() -> Unit)? = when (screen) {
    is Screen.Directory -> { { controller.loadDirectory(screen.session, asRoot = true) } }
    is Screen.ReinforcementHome -> { { controller.loadReinforcementHome(screen.session, asRoot = true) } }
    is Screen.GaokaoReview -> { { controller.loadGaokaoReview(screen.session, asRoot = true) } }
    is Screen.Review -> { { controller.loadReview(screen.session, asRoot = true) } }
    is Screen.Home -> { { controller.refreshHomeDashboard(screen.session) } }
    else -> null
}

private val SidebarSelected = Color(0xFFE2E6EA)

@Composable
private fun TabletSidebar(
    selected: TabletSection,
    session: StudentSession,
    onCollapse: () -> Unit,
    onSelect: (TabletSection) -> Unit,
) {
    Column(
        Modifier
            .width(232.dp)
            .fillMaxHeight()
            .shadow(10.dp, RoundedCornerShape(26.dp), ambientColor = PhoneColors.Shadow, spotColor = PhoneColors.Shadow)
            .clip(RoundedCornerShape(26.dp))
            .background(Brush.verticalGradient(listOf(Color(0xFFF4F6FD), Color(0xFFEFF5FA), Color(0xFFE4F7FA))))
            .border(1.dp, Color.White.copy(alpha = 0.8f), RoundedCornerShape(26.dp)),
    ) {
        Box(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 6.dp, end = 8.dp)) {
            Text(
                "OpenPhysics",
                Modifier.align(Alignment.Center),
                color = OpenPhysicsColors.Ink,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            // iPad: the ⊟ next to the app name folds the sidebar away.
            TabletSidebarToggleButton(onClick = onCollapse, modifier = Modifier.align(Alignment.CenterEnd), expanded = true)
        }
        Column(
            Modifier.padding(horizontal = 12.dp).selectableGroup(),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            TabletSection.entries.forEach { section ->
                val active = section == selected
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(if (active) SidebarSelected else Color.Transparent)
                        .selectable(selected = active, role = Role.Tab) { onSelect(section) }
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    val tint = if (active) OpenPhysicsColors.PrimaryDeep else OpenPhysicsColors.Ink
                    PhoneIcon(section.symbol, Modifier.size(22.dp), tint)
                    Text(
                        section.title,
                        color = tint,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Row(
            Modifier
                .fillMaxWidth()
                .background(Color.White.copy(alpha = 0.72f))
                .clickable(role = Role.Button) { onSelect(TabletSection.Account) }
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(Modifier.size(28.dp).background(OpenPhysicsColors.PrimaryDeep, CircleShape), contentAlignment = Alignment.Center) {
                PhoneIcon(PhoneSymbol.User, Modifier.size(17.dp), Color.White)
            }
            Column(Modifier.weight(1f)) {
                Text(session.displayLabel(), color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(tabletAccountLine(session), color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelSmall,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

internal fun tabletAccountLine(session: StudentSession): String = if (StudentAccessPolicy.hasFullLearningAccess(session)) "完整学习功能可用" else "账号不可用"

/** iPad title-bar refresh: a soft teal circle with ↻. */
@Composable
internal fun TabletRefreshButton(onClick: () -> Unit) {
    Box(
        Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(Color(0xFFD8E9EB))
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = "刷新" },
        contentAlignment = Alignment.Center,
    ) {
        PhoneIcon(PhoneSymbol.Retry, Modifier.size(19.dp), OpenPhysicsColors.PrimaryDeep)
    }
}

/** iPad back affordance: a white circle with a chevron, never a home glyph. */
@Composable
internal fun TabletBackButton(onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(48.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = "返回" },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(36.dp).background(Color.White, CircleShape).border(1.dp, OpenPhysicsColors.Border, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            PhoneIcon(PhoneSymbol.Back, Modifier.size(18.dp), OpenPhysicsColors.PrimaryDeep)
        }
    }
}

/** iPad second-level title bar: ‹ back, title, and the page's own actions on the right. */
@Composable
internal fun TabletDetailTitleBar(
    title: String,
    onBack: () -> Unit,
    subtitle: String = "",
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .background(OpenPhysicsColors.Surface, RoundedCornerShape(20.dp))
            .padding(start = 6.dp, end = 10.dp, top = 4.dp, bottom = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TabletSidebarRestoreButton()
        TabletBackButton(onClick = onBack)
        Column(Modifier.weight(1f)) {
            Text(title, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle.isNotBlank()) {
                Text(subtitle, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelMedium,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        actions()
    }
}

/** Capsule action for a title bar: filled teal when primary, soft teal otherwise. */
@Composable
internal fun TabletBarAction(
    text: String,
    onClick: () -> Unit,
    primary: Boolean = true,
    symbol: PhoneSymbol? = null,
    enabled: Boolean = true,
) {
    val background = when {
        !enabled -> OpenPhysicsColors.NeutralSoft
        primary -> OpenPhysicsColors.PrimaryDeep
        else -> Color(0xFFD8E9EB)
    }
    val content = when {
        !enabled -> OpenPhysicsColors.Subtle
        primary -> Color.White
        else -> OpenPhysicsColors.PrimaryDeep
    }
    Row(
        Modifier
            .heightIn(min = 40.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        symbol?.let { PhoneIcon(it, Modifier.size(17.dp), content) }
        Text(text, color = content, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
    }
}

/** iPad's sidebar button: folds the sidebar away, or brings it back from a title bar. */
@Composable
internal fun TabletSidebarToggleButton(onClick: () -> Unit, modifier: Modifier = Modifier, expanded: Boolean = false) {
    Box(
        modifier
            .size(44.dp)
            .clip(CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = if (expanded) "收起侧边栏" else "展开侧边栏" },
        contentAlignment = Alignment.Center,
    ) {
        PhoneIcon(PhoneSymbol.Sidebar, Modifier.size(22.dp), OpenPhysicsColors.Ink)
    }
}

/** Shown at the start of a title bar only while the sidebar is collapsed. */
@Composable
internal fun TabletSidebarRestoreButton() {
    val shell = LocalTabletShell.current
    if (shell.sidebarCollapsed) shell.onToggleSidebar?.let { TabletSidebarToggleButton(onClick = it) }
}
