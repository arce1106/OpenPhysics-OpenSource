package cn.openphysics.androidapp.ui.screens

import android.content.Context
import android.os.Build
import android.util.DisplayMetrics
import android.view.WindowManager
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.SaveableStateHolder
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import cn.openphysics.androidapp.ui.AppController
import cn.openphysics.androidapp.ui.Screen
import kotlin.math.min

/**
 * Phone or tablet — there is no third layout. A phone (its whole screen is phone-sized) always gets
 * the phone presentation; so does any window too small for the tablet workbench, such as a tablet
 * in a narrow split screen. Window width alone would mistake a portrait tablet for a phone.
 */
internal fun usePhonePresentation(
    deviceSmallestWidthDp: Int,
    configuredSmallestWidthDp: Int,
    windowWidthDp: Int,
    windowHeightDp: Int,
): Boolean =
    (deviceSmallestWidthDp in 1 until 600 && configuredSmallestWidthDp in 1 until 600) ||
        !supportsTabletWorkbench(windowWidthDp, windowHeightDp)

internal fun stableDeviceSmallestWidthDp(widthPixels: Int, heightPixels: Int, stableDensityDpi: Int): Int =
    if (stableDensityDpi > 0) (min(widthPixels, heightPixels) * 160f / stableDensityDpi).toInt() else 0

@Suppress("DEPRECATION")
@Composable
private fun rememberPhoneDevice(): Boolean {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val smallest = configuration.smallestScreenWidthDp
    val densityDpi = configuration.densityDpi
    val width = configuration.screenWidthDp
    val height = configuration.screenHeightDp
    return remember(context, smallest, densityDpi, width, height) {
        val manager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val physicalSmallest = runCatching {
            if (Build.VERSION.SDK_INT >= 30) {
                val bounds = manager.maximumWindowMetrics.bounds
                stableDeviceSmallestWidthDp(bounds.width(), bounds.height(), DisplayMetrics.DENSITY_DEVICE_STABLE)
            } else {
                val metrics = DisplayMetrics()
                manager.defaultDisplay.getRealMetrics(metrics)
                stableDeviceSmallestWidthDp(metrics.widthPixels, metrics.heightPixels, DisplayMetrics.DENSITY_DEVICE_STABLE)
            }
        }.getOrDefault(0) // Unknown device: preserve the existing presentation.
        usePhonePresentation(physicalSmallest, smallest, width, height)
    }
}

internal val LocalPhonePresentation = staticCompositionLocalOf { false }
internal val LocalPhoneLearningNavigation = staticCompositionLocalOf<PhoneLearningNavigation?> { null }
internal val LocalPhoneDirectoryState = staticCompositionLocalOf<SaveableStateHolder?> { null }

internal enum class PhoneLearningSection(val title: String) {
    Sync("同步学习"), Train("巩固提升"), Gaokao("高考复习"),
}

internal data class PhoneLearningNavigation(
    val selected: PhoneLearningSection,
    val onSelect: (PhoneLearningSection) -> Unit,
    /** Back from a learning section: the previous page, or the 学习 entry page when it was a root. */
    val onBack: () -> Unit = {},
)

/** Phone 学习 tab target: the iOS-style entry page rather than straight into 同步学习. */
internal val LocalPhoneOpenLearnHub = staticCompositionLocalOf<(() -> Unit)?> { null }

internal object PhoneColors {
    val Ink = Color(0xFF182C30)
    val Muted = Color(0xFF667579)
    val Primary = Color(0xFF087F83)
    val Soft = Color(0xFFE7F3F1)
    val Background = Color(0xFFF6F8F7)
    val Divider = Color(0xFFE5EAE9)
    val TabPill = Color(0xFFEDF2F2)
    /** iOS systemGroupedBackground: main tab pages sit on this, their groups on white cards. */
    val Page = Color(0xFFF2F3F5)
    val CardStroke = Color(0x14182C30)
    val Ring = Color(0xFF087079)
    val RingLight = Color(0xFF1ABDBD)
    val RingGreen = Color(0xFF3D871A)
    val RingGreenLight = Color(0xFF8CD133)
    val Shadow = Color(0x33182C30)
    val Success = Color(0xFF2E7D32)
    val Warning = Color(0xFFC2620F)
}

/** Opt-in presentation layer. A tablet receives precisely its existing theme and content. */
@Composable
internal fun PhoneAppPresentation(controller: AppController, appFontScale: Float, content: @Composable () -> Unit) {
    val phone = rememberPhoneDevice()
    if (!phone) {
        content()
        return
    }
    val current = controller.screen
    val section = when (current) {
        is Screen.Directory -> PhoneLearningSection.Sync
        is Screen.ReinforcementHome -> PhoneLearningSection.Train
        is Screen.GaokaoReview -> PhoneLearningSection.Gaokao
        else -> null
    }
    val session = when (current) {
        is Screen.Directory -> current.session
        is Screen.ReinforcementHome -> current.session
        is Screen.GaokaoReview -> current.session
        else -> null
    }
    val navigation = if (session != null && section != null) PhoneLearningNavigation(section, { target ->
        if (target != section) when (target) {
            PhoneLearningSection.Sync -> controller.loadDirectory(session, asRoot = true)
            PhoneLearningSection.Train -> controller.loadReinforcementHome(session, asRoot = true)
            PhoneLearningSection.Gaokao -> controller.loadGaokaoReview(session, asRoot = true)
        }
    }, onBack = { if (!controller.goBack()) controller.showLearnHub(session) }) else null
    val hubSession = when (current) {
        is Screen.Home -> current.session
        is Screen.Settings -> current.session
        is Screen.Review -> current.session
        is Screen.LearnHub -> current.session
        else -> session
    }
    val openLearnHub: (() -> Unit)? = hubSession?.let { owner -> { controller.showLearnHub(owner) } }
    val base = MaterialTheme.typography
    val density = LocalDensity.current
    val systemFontScale = LocalConfiguration.current.fontScale
    val directoryState = rememberSaveableStateHolder()
    CompositionLocalProvider(
        LocalPhonePresentation provides true,
        LocalPhoneLearningNavigation provides navigation,
        LocalPhoneOpenLearnHub provides openLearnHub,
        LocalPhoneDirectoryState provides directoryState,
        LocalDensity provides Density(density.density, systemFontScale * appFontScale),
    ) {
        MaterialTheme(
            colorScheme = MaterialTheme.colorScheme.copy(
                primary = PhoneColors.Primary, onPrimary = Color.White,
                background = Color.White, surface = Color.White,
                onSurface = PhoneColors.Ink, onBackground = PhoneColors.Ink,
                surfaceVariant = PhoneColors.Background, outline = PhoneColors.Divider,
                primaryContainer = PhoneColors.Soft, onPrimaryContainer = PhoneColors.Primary,
                secondaryContainer = PhoneColors.Soft, onSecondaryContainer = PhoneColors.Primary,
                surfaceTint = Color.White, surfaceContainerLowest = Color.White, surfaceContainerLow = Color.White,
                surfaceContainer = Color.White, surfaceContainerHigh = Color.White,
                surfaceContainerHighest = PhoneColors.Background, onSurfaceVariant = PhoneColors.Muted,
                outlineVariant = PhoneColors.Divider,
            ),
            typography = base.copy(
                headlineSmall = base.headlineSmall.copy(fontSize = 26.sp, lineHeight = 36.sp, fontWeight = FontWeight.Bold),
                titleLarge = base.titleLarge.copy(fontSize = 21.sp, lineHeight = 30.sp, fontWeight = FontWeight.Bold),
                titleMedium = base.titleMedium.copy(fontSize = 17.sp, lineHeight = 25.sp, fontWeight = FontWeight.Medium),
                bodyLarge = base.bodyLarge.copy(fontSize = 17.sp, lineHeight = 27.sp),
                bodyMedium = base.bodyMedium.copy(fontSize = 16.sp, lineHeight = 25.sp),
                labelLarge = base.labelLarge.copy(fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium),
                labelMedium = base.labelMedium.copy(fontSize = 13.sp, lineHeight = 19.sp),
            ),
            content = content,
        )
    }
}

internal enum class PhoneSymbol(val pathData: String) {
    Home("M3,10 L12,3 L21,10 L21,21 L15,21 L15,14 L9,14 L9,21 L3,21 Z"),
    Book("M12,6 C9,3 5,3 2,4 L2,20 C6,19 9,19 12,22 C15,19 18,19 22,20 L22,4 C19,3 15,3 12,6 L12,22"),
    Train("M3,14 L7,14 L7,21 L3,21 Z M10,9 L14,9 L14,21 L10,21 Z M17,3 L21,3 L21,21 L17,21 Z"),
    Graduation("M2,8 L12,3 L22,8 L12,13 Z M6,10 L6,17 Q12,22 18,17 L18,10 M22,8 L22,17"),
    Review("M15,21 L5,21 Q3,21 3,19 L3,5 Q3,3 5,3 L17,3 Q19,3 19,5 L19,11 M7,8 L15,8 M7,12 L13,12 M13,20 L14,16 L20,10 L23,13 L17,19 Z"),
    User("M8,7 A4,4 0 1,0 16,7 A4,4 0 1,0 8,7 Z M4,22 L4,19 C4,12 20,12 20,19 L20,22 Z"),
    Back("M15,4 L7,12 L15,20"),
    Next("M9,5 L16,12 L9,19"),
    Down("M5,9 L12,16 L19,9"),
    Up("M5,15 L12,8 L19,15"),
    Clock("M3,12 A9,9 0 1,0 21,12 A9,9 0 1,0 3,12 Z M12,6 L12,12 L16,14"),
    Chat("M5,18 C-2,11 4,3 12,3 C24,3 26,19 12,20 L7,19 L3,22 Z M7,10 L17,10 M7,14 L13,14"),
    Close("M6,6 L18,18 M18,6 L6,18"),
    Check("M4,12 L9,17 L20,6"),
    Cards("M4,8 L18,8 L18,20 L4,20 Z M7,4 L21,4 L21,16"),
    Play("M4,5 L20,5 L20,19 L4,19 Z M10,9 L15,12 L10,15 Z"),
    Target("M3,12 A9,9 0 1,0 21,12 A9,9 0 1,0 3,12 Z M7.5,12 A4.5,4.5 0 1,0 16.5,12 A4.5,4.5 0 1,0 7.5,12 Z M11,12 A1,1 0 1,0 13,12 A1,1 0 1,0 11,12 Z"),
    Retry("M4,12 A8,8 0 1,0 6.34,6.34 M5.6,2.6 L6.34,6.34 L10.1,5.6"),
    Sidebar("M3,5 L21,5 L21,19 L3,19 Z M9,5 L9,19 M5,8.5 L7,8.5 M5,11.5 L7,11.5"),
    Sparkle("M12,3 L13.8,10.2 L21,12 L13.8,13.8 L12,21 L10.2,13.8 L3,12 L10.2,10.2 Z M19,3 L19,6 M17.5,4.5 L20.5,4.5"),
}

private val phoneIconCache = HashMap<Pair<PhoneSymbol, Boolean>, ImageVector>()

/** Builds each symbol once as a vector, so it renders through the same cached path as system icons. */
private fun phoneIconVector(symbol: PhoneSymbol, filled: Boolean): ImageVector = phoneIconCache.getOrPut(symbol to filled) {
    ImageVector.Builder(name = "phone-${symbol.name}", defaultWidth = 24.dp, defaultHeight = 24.dp,
        viewportWidth = 24f, viewportHeight = 24f).addPath(
        pathData = PathParser().parsePathString(symbol.pathData).toNodes(),
        fill = if (filled) SolidColor(Color.Black) else null,
        stroke = SolidColor(Color.Black), strokeLineWidth = 1.7f,
        strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
    ).build()
}

/**
 * A consistent 24-unit, rounded, 1.7-unit outline icon family.
 * Drawn as an [ImageVector] (not raw Canvas paths), which on a cold start could leave only
 * the circle primitives visible until the first recomposition.
 */
@Composable
internal fun PhoneIcon(symbol: PhoneSymbol, modifier: Modifier = Modifier.size(24.dp), color: Color = PhoneColors.Ink, filled: Boolean = false) {
    Icon(rememberVectorPainter(phoneIconVector(symbol, filled && symbol == PhoneSymbol.Home)), contentDescription = null,
        modifier = modifier, tint = color)
}

/** The white, softly outlined rounded group the iOS app uses on its grey pages. */
@Composable
internal fun PhoneCard(
    modifier: Modifier = Modifier,
    padding: PaddingValues = PaddingValues(horizontal = 16.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White)
        .border(1.dp, PhoneColors.CardStroke, RoundedCornerShape(18.dp)).padding(padding), content = content)
}

@Composable
internal fun PhoneAction(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, primary: Boolean = true, enabled: Boolean = true) {
    val label: @Composable RowScope.() -> Unit = {
        Text(text, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
    }
    // iOS capsules: a filled accent primary, and a tinted (not outlined) secondary.
    if (primary) Button(onClick, modifier.heightIn(min = 50.dp), enabled = enabled,
        shape = RoundedCornerShape(50), contentPadding = PaddingValues(horizontal = 22.dp, vertical = 12.dp), content = label)
    else Button(onClick, modifier.heightIn(min = 50.dp), enabled = enabled, shape = RoundedCornerShape(50),
        colors = ButtonDefaults.buttonColors(containerColor = PhoneColors.Soft, contentColor = PhoneColors.Primary),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp), content = label)
}

@Composable
internal fun PhoneTopBar(title: String, onBack: (() -> Unit)? = null, trailing: @Composable RowScope.() -> Unit = {}) {
    // iOS navigation bar: a round back button on the leading edge and a centred inline title.
    // A root page (no back) keeps its leading title, as the iOS tab roots do.
    if (onBack == null) {
        Box(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 20.dp)) {
            Text(title, modifier = Modifier.align(Alignment.Center), style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold, maxLines = 1)
            Row(Modifier.align(Alignment.CenterEnd), verticalAlignment = Alignment.CenterVertically, content = trailing)
        }
        return
    }
    Box(Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(horizontal = 16.dp, vertical = 8.dp)) {
        PhoneCircleButton(PhoneSymbol.Back, "返回", onBack, Modifier.align(Alignment.CenterStart))
        Text(title, modifier = Modifier.align(Alignment.Center).padding(horizontal = 56.dp),
            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(Modifier.align(Alignment.CenterEnd), verticalAlignment = Alignment.CenterVertically, content = trailing)
    }
}

/** A tab root's title: centred and inline, as iOS shows 今天怎么学 / 错题复盘 / 我的. */
@Composable
internal fun PhoneRootTitle(title: String) {
    Box(Modifier.fillMaxWidth().heightIn(min = 40.dp), contentAlignment = Alignment.Center) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** The round, lightly raised toolbar button used by the iOS app for back and refresh. */
@Composable
internal fun PhoneCircleButton(symbol: PhoneSymbol, description: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier.size(42.dp).shadow(6.dp, CircleShape, ambientColor = PhoneColors.Shadow, spotColor = PhoneColors.Shadow)
        .background(Color.White, CircleShape).clip(CircleShape)
        .clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = description },
        contentAlignment = Alignment.Center) {
        PhoneIcon(symbol, Modifier.size(20.dp), PhoneColors.Ink)
    }
}

@Composable
internal fun PhoneMainPage(
    activeTab: MainTab,
    onHome: () -> Unit, onLearn: () -> Unit, onReview: () -> Unit, onMe: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val learning = LocalPhoneLearningNavigation.current
    val selected = if (learning != null || activeTab == MainTab.Practice) MainTab.Learn else activeTab
    Scaffold(containerColor = PhoneColors.Page, contentWindowInsets = WindowInsets(0), bottomBar = {
        PhoneTabBar(selected, onHome, onLearn, onReview, onMe, reselectLearn = learning != null)
    }) { insets ->
        Column(Modifier.fillMaxSize().padding(insets)) {
            if (learning != null) {
                // Each learning section is its own page under 学习, with a back button (iOS).
                androidx.activity.compose.BackHandler { learning.onBack() }
                PhoneTopBar(learning.selected.title, learning.onBack)
            }
            Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(horizontal=20.dp,vertical=16.dp),
                verticalArrangement=Arrangement.spacedBy(24.dp),content=content)
        }
    }
}


/** The floating capsule tab bar, shared by tab roots and the learning pages beneath them (iOS keeps it visible). */
@Composable
internal fun PhoneTabBar(selected: MainTab, onHome: () -> Unit, onLearn: () -> Unit, onReview: () -> Unit, onMe: () -> Unit,
    reselectLearn: Boolean = false) {
    val openLearnHub = LocalPhoneOpenLearnHub.current
    val learning = if (reselectLearn) Unit else null
    // iOS-style floating capsule: the selected tab sits on a soft pill instead of a top divider.
        Box(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 10.dp)) {
            Row(Modifier.fillMaxWidth()
                .shadow(12.dp, RoundedCornerShape(32.dp), ambientColor = PhoneColors.Shadow, spotColor = PhoneColors.Shadow)
                .background(Color.White, RoundedCornerShape(32.dp)).selectableGroup().padding(5.dp)) {
                listOf(MainTab.Home,MainTab.Learn,MainTab.Review,MainTab.Me).forEach { tab ->
                    val isSelected = selected == tab
                    val color = if (isSelected) PhoneColors.Primary else PhoneColors.Ink
                    Column(Modifier.weight(1f).heightIn(min = 54.dp).clip(RoundedCornerShape(27.dp))
                        .background(if (isSelected) PhoneColors.TabPill else Color.Transparent)
                        .selectable(isSelected, role = Role.Tab, onClick = {
                            // Re-tapping 学习 inside a section returns to the entry page, as iOS pops to root.
                            if (tab == MainTab.Learn && (learning != null || !isSelected)) (openLearnHub ?: onLearn)()
                            else if (!isSelected) when(tab) { MainTab.Home->onHome();MainTab.Learn->onLearn();MainTab.Review->onReview();else->onMe() }
                        }).padding(vertical = 5.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        PhoneIcon(when(tab) { MainTab.Home->PhoneSymbol.Home;MainTab.Learn->PhoneSymbol.Book;MainTab.Review->PhoneSymbol.Review;else->PhoneSymbol.User }, color=color, filled=isSelected)
                        Text(if(tab==MainTab.Review) "错题" else tab.label, style=MaterialTheme.typography.labelSmall, color=color,
                            fontWeight=if(isSelected) FontWeight.SemiBold else FontWeight.Medium)
                    }
                }
            }
        }
}

@Composable
internal fun <T> PhoneTextTabs(items: List<T>, selected: T, label: (T)->String, onSelect: (T)->Unit, modifier: Modifier = Modifier) {
    val scrollState = rememberScrollState()
    val scrollCellWidth = with(LocalDensity.current) { 112.dp.roundToPx() }
    LaunchedEffect(items.size, selected, scrollState.maxValue) {
        if (items.size > 3) scrollState.animateScrollTo((items.indexOf(selected).coerceAtLeast(0) * scrollCellWidth)
            .coerceAtMost(scrollState.maxValue))
    }
    Column(modifier.fillMaxWidth()) {
        // Four learning resources cannot share equal-width cells on a narrow phone at large text sizes.
        val tabRow = if (items.size > 3) Modifier.fillMaxWidth().horizontalScroll(scrollState).selectableGroup()
            else Modifier.fillMaxWidth().selectableGroup()
        Row(tabRow) {
            items.forEach { item ->
                val active = item==selected
                val tabModifier = if (items.size > 3) Modifier.width(112.dp)
                    else Modifier.weight(1f)
                Column(tabModifier.selectable(active,role=Role.Tab,onClick={ onSelect(item) }),horizontalAlignment=Alignment.CenterHorizontally) {
                    Box(Modifier.heightIn(min=48.dp).padding(horizontal=4.dp,vertical=12.dp),contentAlignment=Alignment.Center) {
                        Text(label(item),color=if(active) PhoneColors.Primary else PhoneColors.Muted,style=MaterialTheme.typography.labelLarge,
                            fontWeight=if(active) FontWeight.Bold else FontWeight.Normal,maxLines=1,softWrap=false)
                    }
                    Box(Modifier.fillMaxWidth().height(3.dp).background(if(active) PhoneColors.Primary else Color.Transparent))
                }
            }
        }
        HorizontalDivider(color=PhoneColors.Divider)
    }
}
