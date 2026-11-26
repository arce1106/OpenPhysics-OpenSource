package cn.openphysics.androidapp.ui.design

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

object OpenPhysicsColors {
    val Ink = Color(0xFF0F172A)
    val Muted = Color(0xFF64748B)
    val Subtle = Color(0xFF94A3B8)
    val Primary = Color(0xFF14919B)
    val PrimaryDeep = Color(0xFF0E7C86)
    val PrimarySoft = Color(0xFFEAF8F9)
    val AccentCyan = Color(0xFF06B6D4)
    val AiPurple = Color(0xFF7C3AED)
    val Background = Color(0xFFF2F3F5)
    val Surface = Color.White
    val SurfaceSoft = Color(0xFFF8FAFC)
    val Border = Color(0xFFDDE7F0)
    val Divider = Color(0xFFE7EEF6)
    val Success = Color(0xFF15803D)
    val SuccessSoft = Color(0xFFEAF7EF)
    val Warning = Color(0xFFB45309)
    val WarningSoft = Color(0xFFFFF7ED)
    val Danger = Color(0xFFB42318)
    val DangerSoft = Color(0xFFFFF1F0)
    val NeutralSoft = Color(0xFFF1F5F9)
}

object OpenPhysicsSpacing {
    val PageHorizontal = 16.dp
    val PageTop = 16.dp
    val PageGap = 12.dp
    val CardPadding = 16.dp
    val CardGap = 12.dp
    val SectionGap = 8.dp
    val InlineGap = 8.dp
    val ButtonHeight = 46.dp
}

object OpenPhysicsRadius {
    val Small = 8.dp
    val Medium = 14.dp
    val Large = 20.dp
    val Pill = 999.dp
}

object OpenPhysicsElevation {
    val Card = 0.dp
    val Raised = 2.dp
}

enum class OpenPhysicsTone {
    Primary,
    Success,
    Warning,
    Danger,
    Neutral,
}

data class TonePalette(
    val background: Color,
    val foreground: Color,
    val border: Color,
)

fun tonePalette(tone: OpenPhysicsTone): TonePalette {
    return when (tone) {
        OpenPhysicsTone.Primary -> TonePalette(
            background = OpenPhysicsColors.PrimarySoft,
            foreground = OpenPhysicsColors.PrimaryDeep,
            border = Color(0xFFC9EEF2),
        )
        OpenPhysicsTone.Success -> TonePalette(
            background = OpenPhysicsColors.SuccessSoft,
            foreground = OpenPhysicsColors.Success,
            border = Color(0xFFC7E8D3),
        )
        OpenPhysicsTone.Warning -> TonePalette(
            background = OpenPhysicsColors.WarningSoft,
            foreground = OpenPhysicsColors.Warning,
            border = Color(0xFFF2D49F),
        )
        OpenPhysicsTone.Danger -> TonePalette(
            background = OpenPhysicsColors.DangerSoft,
            foreground = OpenPhysicsColors.Danger,
            border = Color(0xFFF4B8B2),
        )
        OpenPhysicsTone.Neutral -> TonePalette(
            background = OpenPhysicsColors.NeutralSoft,
            foreground = OpenPhysicsColors.Muted,
            border = OpenPhysicsColors.Border,
        )
    }
}
