package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.RenderedRichContent

enum class RichContentRenderPath {
    PreRenderedKatexHtml,
    RawPlainTextFallback,
}

data class RichContentDisplayDecision(
    val path: RichContentRenderPath,
    val reason: String,
)

fun decideRichContentDisplay(
    text: String,
    rendered: RenderedRichContent?,
): RichContentDisplayDecision {
    if (rendered != null) {
        return when {
            rendered.errors.isNotEmpty() -> fallbackDecision(text, "rendered_errors")
            rendered.html.isBlank() -> fallbackDecision(text, "rendered_empty")
            else -> RichContentDisplayDecision(RichContentRenderPath.PreRenderedKatexHtml, "")
        }
    }
    return fallbackDecision(text, "missing_rendered")
}

private fun fallbackDecision(@Suppress("UNUSED_PARAMETER") text: String, reason: String): RichContentDisplayDecision {
    return RichContentDisplayDecision(
        path = RichContentRenderPath.RawPlainTextFallback,
        reason = reason,
    )
}
