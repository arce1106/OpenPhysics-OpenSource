package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.ui.theme.AppSpacing
import cn.openphysics.androidapp.ui.components.PrimaryActionButton
import cn.openphysics.androidapp.ui.components.SecondaryActionButton
import cn.openphysics.androidapp.ui.components.StatusChip
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsElevation
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone

@Composable
fun Page(
    scrollState: androidx.compose.foundation.ScrollState = rememberScrollState(),
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(scrollState)
            .padding(
                start = AppSpacing.pageHorizontalDp.dp,
                top = AppSpacing.pageTopDp.dp,
                end = AppSpacing.pageHorizontalDp.dp,
                bottom = 20.dp,
            ),
        verticalArrangement = Arrangement.spacedBy(AppSpacing.pageGapDp.dp),
        content = content,
    )
}

enum class MainTab(val label: String, val marker: String) {
    Home("首页", "首"),
    Learn("学习", "学"),
    Practice("巩固", "练"),
    Review("复盘", "错"),
    History("记录", "记"),
    Tutor("AI", "AI"),
    Settings("设置", "设"),
    Me("我的", "我"),
}


internal data class AndroidNativeBackButtonPolicy(
    val icon: String,
    val shape: String,
    val usesTextLabel: Boolean,
    val defaultSizeDp: Int,
    val visibleSizeDp: Int,
)

internal fun androidNativeBackButtonPolicy(): AndroidNativeBackButtonPolicy =
    AndroidNativeBackButtonPolicy(
        icon = "chevron",
        shape = "circle",
        usesTextLabel = false,
        defaultSizeDp = 48,
        visibleSizeDp = 36,
    )

@Composable
internal fun AndroidNativeBackButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val policy = androidNativeBackButtonPolicy()
    Box(
        modifier = modifier
            .size(policy.defaultSizeDp.dp)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .size(policy.visibleSizeDp.dp)
                .background(Color.White, RoundedCornerShape(999.dp))
                .border(BorderStroke(1.dp, OpenPhysicsColors.Border), RoundedCornerShape(999.dp)),
            contentAlignment = Alignment.Center,
        ) {
            // iPad: a back chevron. A home glyph read as "leave the app section", not "go back".
            PhoneIcon(PhoneSymbol.Back, Modifier.size(18.dp), OpenPhysicsColors.PrimaryDeep)
        }
    }
}

enum class TabletMainContentMode {
    Scroll,
    FillAvailableHeight,
}

internal val TabletLearningPagePadding = PaddingValues(horizontal = 22.dp, vertical = 16.dp)

@Composable
internal fun tabletLearningSidebarWidth() =
    (LocalConfiguration.current.screenWidthDp * 0.24f).coerceIn(220f, 260f).dp

@Composable
internal fun TabletCompactActionButton(
    text: String,
    onClick: () -> Unit,
    width: Dp,
    height: Dp = 32.dp,
    enabled: Boolean = true,
    primary: Boolean = false,
) {
    Box(Modifier.width(width).height(48.dp), contentAlignment = Alignment.Center) {
        val label: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {
            Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1)
        }
        val padding = PaddingValues(horizontal = 12.dp, vertical = 0.dp)
        if (primary) {
            Button(
                onClick = onClick, enabled = enabled,
                modifier = Modifier.fillMaxWidth().height(height),
                shape = RoundedCornerShape(999.dp), contentPadding = padding,
                colors = ButtonDefaults.buttonColors(
                    containerColor = OpenPhysicsColors.Primary,
                    contentColor = OpenPhysicsColors.Surface,
                ),
                content = label,
            )
        } else {
            OutlinedButton(
                onClick = onClick, enabled = enabled,
                modifier = Modifier.fillMaxWidth().height(height),
                shape = RoundedCornerShape(999.dp), contentPadding = padding,
                border = androidx.compose.foundation.BorderStroke(1.dp, OpenPhysicsColors.Border),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = OpenPhysicsColors.PrimaryDeep),
                content = label,
            )
        }
    }
}

@Composable
internal fun TabletLearningPageHeader(
    title: String,
    onHome: () -> Unit,
    badge: String = "",
    trailing: @Composable RowScope.() -> Unit = {},
) {
    // iPad section title bar: white capsule, title left, section actions and ↻ on the right.
    // With the sidebar showing, the section root needs no way home — the sidebar is it.
    val shell = LocalTabletShell.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .background(OpenPhysicsColors.Surface, RoundedCornerShape(OpenPhysicsRadius.Large))
            .padding(start = if (shell.sidebarVisible) 18.dp else 8.dp, end = 10.dp, top = 6.dp, bottom = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!shell.sidebarAvailable) AndroidNativeBackButton(onClick = onHome)
        TabletSidebarRestoreButton()
        Text(
            text = title,
            modifier = Modifier.weight(1f),
            color = OpenPhysicsColors.Ink,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (badge.isNotBlank()) StatusChip(badge, tone = OpenPhysicsTone.Primary)
        trailing()
        shell.onRefresh?.let { TabletRefreshButton(it) }
    }
}

/** Every window is phone or tablet: anything too small for the tablet workbench is presented as a phone. */
@Composable
internal fun isTabletLayout(): Boolean = !LocalPhonePresentation.current

@Composable
fun MainPage(
    activeTab: MainTab,
    onHome: () -> Unit,
    onLearn: () -> Unit,
    onPractice: () -> Unit,
    onReview: () -> Unit,
    onMe: () -> Unit,
    onHistory: (() -> Unit)? = null,
    onTutor: (() -> Unit)? = null,
    onSettings: (() -> Unit)? = null,
    showTabletTopBar: Boolean = false,
    tabletContentMode: TabletMainContentMode = TabletMainContentMode.Scroll,
    content: @Composable ColumnScope.() -> Unit,
) {
    if (LocalPhonePresentation.current) {
        PhoneMainPage(activeTab, onHome, onLearn, onReview, onMe, content)
        return
    }
    TabletMainPage(
        onSettings = onSettings ?: onMe,
        showTopBar = showTabletTopBar,
        contentMode = tabletContentMode,
        content = content,
    )
}

@Composable
private fun TabletMainPage(
    onSettings: () -> Unit,
    showTopBar: Boolean,
    contentMode: TabletMainContentMode,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenPhysicsColors.Background)
            .padding(TabletLearningPagePadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (showTopBar) {
            TabletTopBar(onSettings = onSettings)
        }
        val contentModifier = when (contentMode) {
            TabletMainContentMode.Scroll -> Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState())
            TabletMainContentMode.FillAvailableHeight -> Modifier
                .fillMaxWidth()
                .weight(1f)
        }
        Column(
            modifier = contentModifier,
            verticalArrangement = Arrangement.spacedBy(16.dp),
            content = content,
        )
    }
}

@Composable
fun TabletWorkspaceTopBar(
    title: String,
    subtitle: String,
    onHome: () -> Unit,
    primaryBadge: String? = null,
    primaryTone: OpenPhysicsTone = OpenPhysicsTone.Primary,
    secondaryBadge: String? = null,
    secondaryTone: OpenPhysicsTone = OpenPhysicsTone.Neutral,
) {
    val hasSubtitle = subtitle.isNotBlank()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Large))
            .border(BorderStroke(1.dp, OpenPhysicsColors.Border), RoundedCornerShape(OpenPhysicsRadius.Large))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AndroidNativeBackButton(onClick = onHome)
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = if (hasSubtitle) Arrangement.spacedBy(2.dp) else Arrangement.Center,
        ) {
            Text(title, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            if (hasSubtitle) {
                Text(subtitle, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.bodyMedium)
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            primaryBadge?.takeIf { it.isNotBlank() }?.let {
                StatusChip(text = it, tone = primaryTone)
            }
            secondaryBadge?.takeIf { it.isNotBlank() }?.let {
                StatusChip(text = it, tone = secondaryTone)
            }
        }
    }
}

@Composable
private fun TabletTopBar(onSettings: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .width(320.dp)
                .background(Color.White, RoundedCornerShape(999.dp))
                .border(BorderStroke(1.dp, OpenPhysicsColors.Border), RoundedCornerShape(999.dp))
                .padding(horizontal = 18.dp, vertical = 12.dp),
        ) {
            Text(
                text = "搜索知识点、题目或内容",
                color = OpenPhysicsColors.Subtle,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        StatusChip("通知", tone = OpenPhysicsTone.Neutral)
        Box(
            modifier = Modifier
                .background(OpenPhysicsColors.PrimarySoft, RoundedCornerShape(OpenPhysicsRadius.Pill))
                .border(BorderStroke(1.dp, OpenPhysicsColors.Border), RoundedCornerShape(OpenPhysicsRadius.Pill))
                .clickable(onClick = onSettings)
                .padding(horizontal = 12.dp, vertical = 7.dp),
        ) {
            Text(
                text = "个人中心",
                color = OpenPhysicsColors.PrimaryDeep,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Normal,
            )
        }
    }
}

@Composable
fun Panel(content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(OpenPhysicsRadius.Large),
        elevation = CardDefaults.cardElevation(defaultElevation = OpenPhysicsElevation.Card),
        colors = CardDefaults.cardColors(containerColor = OpenPhysicsColors.Surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, OpenPhysicsColors.Border),
    ) {
        Column(
            modifier = Modifier.padding(AppSpacing.panelPaddingDp.dp),
            verticalArrangement = Arrangement.spacedBy(AppSpacing.panelGapDp.dp),
            content = content,
        )
    }
}

@Composable
fun PageTitle(text: String) {
    Text(text, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Light, color = OpenPhysicsColors.Ink)
}

@Composable
fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Light, color = OpenPhysicsColors.Ink)
}

@Composable
fun MutedText(text: String) {
    if (text.isNotBlank()) {
        if (hasFormulaText(text)) {
            PhysicsRichText(text)
        } else {
            Text(text, style = MaterialTheme.typography.bodyMedium, color = OpenPhysicsColors.Muted)
        }
    }
}

@Composable
fun MetaText(text: String) {
    Text(text, style = MaterialTheme.typography.labelMedium, color = OpenPhysicsColors.PrimaryDeep, fontWeight = FontWeight.Normal)
}

@Composable
fun ProgressLine(progress: Double) {
    LinearProgressIndicator(
        progress = { progress.toFloat().coerceIn(0f, 1f) },
        modifier = Modifier.fillMaxWidth().heightIn(min = 4.dp),
        color = MaterialTheme.colorScheme.primary,
        trackColor = OpenPhysicsColors.Divider,
    )
}

@Composable
fun StatStrip(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

@Composable
fun StatCell(label: String, value: String) {
    Column(horizontalAlignment = Alignment.Start) {
        Text(value, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.titleMedium)
        Text(label, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelMedium)
    }
}

fun cleanText(text: String): String {
    if (text == "null") return ""
    return text
        .replace(Regex("<[^>]+>"), "")
        .replace(Regex("\\{\\{IMG:[^}]+\\}\\}"), "[图片]")
        .replace("**", "")
        .replace("__", "")
        .replace("`", "")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .trim()
}

fun compactText(text: String, maxChars: Int = 120): String {
    val cleaned = cleanText(text)
        .replace(Regex("\\s+"), " ")
        .trim()
    if (cleaned.length <= maxChars) return cleaned
    return cleaned.take(maxChars).trimEnd() + "..."
}
