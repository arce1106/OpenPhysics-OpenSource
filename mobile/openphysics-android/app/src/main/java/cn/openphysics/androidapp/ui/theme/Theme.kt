package cn.openphysics.androidapp.ui.theme

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import cn.openphysics.androidapp.R
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import kotlin.math.min

private val Colors = lightColorScheme(
    primary = OpenPhysicsColors.Primary,
    secondary = OpenPhysicsColors.Muted,
    tertiary = OpenPhysicsColors.AccentCyan,
    background = OpenPhysicsColors.Background,
    surface = OpenPhysicsColors.Surface,
    onPrimary = OpenPhysicsColors.Surface,
    onSurface = OpenPhysicsColors.Ink,
    surfaceVariant = OpenPhysicsColors.SurfaceSoft,
    outline = OpenPhysicsColors.Border,
    // Material 3 defaults these to a lavender tint, which leaked into dialogs, sheets and menus.
    primaryContainer = OpenPhysicsColors.PrimarySoft,
    onPrimaryContainer = OpenPhysicsColors.PrimaryDeep,
    secondaryContainer = OpenPhysicsColors.PrimarySoft,
    onSecondaryContainer = OpenPhysicsColors.PrimaryDeep,
    surfaceTint = OpenPhysicsColors.Surface,
    surfaceBright = OpenPhysicsColors.Surface,
    surfaceDim = OpenPhysicsColors.Background,
    surfaceContainerLowest = OpenPhysicsColors.Surface,
    surfaceContainerLow = OpenPhysicsColors.Surface,
    surfaceContainer = OpenPhysicsColors.Surface,
    surfaceContainerHigh = OpenPhysicsColors.Surface,
    surfaceContainerHighest = OpenPhysicsColors.SurfaceSoft,
    onSurfaceVariant = OpenPhysicsColors.Muted,
    outlineVariant = OpenPhysicsColors.Divider,
)

object AppTextScale {
    const val headlineSmallSp = 21
    const val titleLargeSp = 17
    const val titleMediumSp = 14
    const val bodyMediumSp = 14
    const val bodyLineHeightSp = 21
    const val labelLargeSp = 14
    const val labelMediumSp = 12
    const val labelSmallSp = 11
}

object AppSpacing {
    const val pageHorizontalDp = 16
    const val pageTopDp = 16
    const val pageGapDp = 12
    const val panelPaddingDp = 16
    const val panelGapDp = 12
    const val actionMinHeightDp = 46
}

object AppFontScale {
    const val maxSystemFontScale = 1.0f
    const val maxFontScale = 1.22f
}

private object OpenPhysicsNoIndication : IndicationNodeFactory {
    override fun create(interactionSource: InteractionSource): DelegatableNode {
        return object : Modifier.Node() {}
    }

    override fun equals(other: Any?): Boolean = other === this

    override fun hashCode(): Int = javaClass.hashCode()
}

enum class AppFontSize(val key: String, val label: String, val scale: Float) {
    Compact("compact", "偏小", 0.94f),
    Standard("standard", "标准", 1.0f),
    Comfortable("comfortable", "舒适", 1.08f),
    Large("large", "偏大", 1.16f);

    companion object {
        val default = Standard

        fun fromKey(key: String?): AppFontSize {
            return values().firstOrNull { it.key == key } ?: default
        }
    }
}

private val OpenPhysicsFontFamily = FontFamily(
    Font(R.font.noto_sans_cjk_sc_regular, FontWeight.Normal),
    Font(R.font.noto_sans_cjk_sc_medium, FontWeight.Medium),
    Font(R.font.noto_sans_cjk_sc_bold, FontWeight.Bold),
)

private fun openPhysicsTextStyle(
    fontSize: TextUnit,
    lineHeight: TextUnit,
    fontWeight: FontWeight = FontWeight.Normal,
) = TextStyle(
    fontFamily = OpenPhysicsFontFamily,
    fontSize = fontSize,
    lineHeight = lineHeight,
    fontWeight = fontWeight,
)

private val AppTypography = Typography(
    headlineSmall = openPhysicsTextStyle(
        fontSize = AppTextScale.headlineSmallSp.sp,
        lineHeight = 28.sp,
    ),
    titleSmall = openPhysicsTextStyle(
        fontSize = 13.sp,
        lineHeight = 19.sp,
    ),
    titleLarge = openPhysicsTextStyle(
        fontSize = AppTextScale.titleLargeSp.sp,
        lineHeight = 24.sp,
    ),
    titleMedium = openPhysicsTextStyle(
        fontSize = AppTextScale.titleMediumSp.sp,
        lineHeight = 20.sp,
    ),
    bodyLarge = openPhysicsTextStyle(
        fontSize = 15.sp,
        lineHeight = 24.sp,
    ),
    bodyMedium = openPhysicsTextStyle(
        fontSize = AppTextScale.bodyMediumSp.sp,
        lineHeight = AppTextScale.bodyLineHeightSp.sp,
    ),
    bodySmall = openPhysicsTextStyle(
        fontSize = 12.sp,
        lineHeight = 17.sp,
    ),
    labelLarge = openPhysicsTextStyle(
        fontSize = AppTextScale.labelLargeSp.sp,
        lineHeight = 19.sp,
    ),
    labelMedium = openPhysicsTextStyle(
        fontSize = AppTextScale.labelMediumSp.sp,
        lineHeight = 16.sp,
    ),
    labelSmall = openPhysicsTextStyle(
        fontSize = AppTextScale.labelSmallSp.sp,
        lineHeight = 15.sp,
    ),
)

private val AppShapes = Shapes(
    small = RoundedCornerShape(OpenPhysicsRadius.Small),
    medium = RoundedCornerShape(OpenPhysicsRadius.Medium),
    large = RoundedCornerShape(OpenPhysicsRadius.Large),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OpenPhysicsTheme(
    fontScale: Float = AppFontSize.default.scale,
    content: @Composable () -> Unit,
) {
    val density = LocalDensity.current
    val cappedDensity = Density(
        density = density.density,
        fontScale = min(density.fontScale, AppFontScale.maxSystemFontScale) *
            fontScale.coerceIn(AppFontSize.Compact.scale, AppFontScale.maxFontScale),
    )
    CompositionLocalProvider(
        LocalDensity provides cappedDensity,
        LocalIndication provides OpenPhysicsNoIndication,
        LocalRippleConfiguration provides null,
    ) {
        MaterialTheme(colorScheme = Colors, typography = AppTypography, shapes = AppShapes, content = content)
    }
}
