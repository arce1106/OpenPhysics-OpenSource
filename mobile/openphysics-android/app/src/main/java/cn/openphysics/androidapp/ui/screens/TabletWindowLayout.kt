package cn.openphysics.androidapp.ui.screens

/**
 * Shared by navigation and practice, including tablets using enlarged display settings.
 * Like iPad, a tablet keeps the tablet workbench in portrait too (the sidebar collapses there);
 * only phone-sized windows — narrower than a tablet, or a phone held in landscape — use flow mode.
 */
internal fun supportsTabletWorkbench(screenWidthDp: Int, screenHeightDp: Int): Boolean =
    screenWidthDp >= TabletMinWidthDp && screenHeightDp >= TabletMinHeightDp

/** Below this width the sidebar would squeeze the page, so it is collapsed and opens over it. */
internal fun tabletSidebarOverlays(screenWidthDp: Int): Boolean = screenWidthDp < TabletSidebarInlineMinWidthDp

private const val TabletMinWidthDp = 600
private const val TabletMinHeightDp = 480
private const val TabletSidebarInlineMinWidthDp = 960
