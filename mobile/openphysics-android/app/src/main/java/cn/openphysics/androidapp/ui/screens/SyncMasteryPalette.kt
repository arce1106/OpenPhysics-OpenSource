package cn.openphysics.androidapp.ui.screens

import androidx.compose.ui.graphics.Color

internal data class SyncMasteryPalette(val fill: Color, val border: Color, val ink: Color)

internal fun syncMasteryPalette(percent: Int): SyncMasteryPalette = when {
    percent < 40 -> SyncMasteryPalette(Color(0xFFFFF1DC), Color(0xFFF2A746), Color(0xFF9A4D08))
    percent < 70 -> SyncMasteryPalette(Color(0xFFE8F0FF), Color(0xFF70A5EF), Color(0xFF245BB5))
    // 80% is the backend's single "已掌握" threshold.
    percent < 80 -> SyncMasteryPalette(Color(0xFFDCF5F2), Color(0xFF45B4AA), Color(0xFF0F766E))
    else -> SyncMasteryPalette(Color(0xFFE2F6D6), Color(0xFF76BF4E), Color(0xFF397B20))
}
