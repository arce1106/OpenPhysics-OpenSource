package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.RenderedRichContent
import cn.openphysics.androidapp.domain.RenderedRichContentError
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RichTextHtmlTest {
    @Test
    fun detectsCommonLatexFormulaText() {
        assertTrue(hasFormulaText("由 ${'$'}v^{2}=2ax${'$'} 可得"))
        assertTrue(hasFormulaText("加速度 \\(a=\\frac{v}{t}\\)"))
        assertFalse(hasFormulaText("这是一段普通中文说明"))
    }


    @Test
    fun repairsFormFeedFracFromOcrOrModelOutput() {
        val text = normalizePhysicsRichTextInput("t_{3}=\u000crac{v_{1}}{a_{2}}")

        assertTrue(text.contains("\\frac{v_{1}}{a_{2}}"))
    }

    @Test
    fun detectsAndWrapsNakedFormulaFragmentsInsideChineseText() {
        val normalized = normalizePhysicsRichTextInput("先由 h=1/2gt^2 求时间，再由 v=gt 求速度。")

        assertTrue(hasFormulaText("先由 h=1/2gt^2 求时间，再由 v=gt 求速度。"))
        assertTrue(normalized.contains("${'$'}h=1/2gt^{2}${'$'}"))
        assertTrue(normalized.contains("${'$'}v=gt${'$'}"))
    }

    @Test
    fun wrapsBareLatexFormulaLikeWebFrontend() {
        val normalized = normalizePhysicsRichTextInput("v=v_0+\\frac{1}{2}at^2")

        assertTrue(normalized.contains("${'$'}v=v_0+\\frac{1}{2}at^{2}${'$'}"))
    }

    @Test
    fun createsReadableLocalFallbackForInlineFormula() {
        val text = toReadablePhysicsText("第 ${'$'}t_{n-1}\\sim t_n${'$'} 内，${'$'}v^{2}${'$'}")

        assertTrue(text, text.contains("tₙ₋₁～tₙ"))
        assertTrue(text, text.contains("v²"))
        assertFalse(text, text.contains("${'$'}"))
    }

    @Test
    fun createsReadableLocalFallbackForUndelimitedLatexMacros() {
        val text = "\\text{物体可视为质点的条件：} d \\ll L"

        assertTrue(hasFormulaText(text))
        assertTrue(toReadablePhysicsText(text).contains("物体可视为质点的条件： d ≪ L"))
    }

    @Test
    fun keepsUppercaseLetterSubscriptsReadableOnMobile() {
        val text = toReadablePhysicsText("${'$'}φ_{M}<φ_{N}${'$'}")

        assertTrue(text, text.contains("φ_(M)<φ_(N)"))
    }

    @Test
    fun physicsRichTextInputKeepsFullExplanationAndRepairsMath() {
        val normalized = normalizePhysicsRichTextInput(
            "正确答案：${'$'}\\frac{1}{2}at^2${'$'}\n解析：由 ${'$'}v^{2}=2ax${'$'} 可得后续步骤。",
        )

        assertTrue(normalized.contains("\\frac{1}{2}at^{2}"))
        assertTrue(normalized.contains("v^{2}=2ax"))
        assertTrue(normalized.contains("后续步骤"))
    }

    @Test
    fun renderedFallbackModeUsesRenderedHtmlOnlyWhenSafe() {
        assertEquals(
            RichContentRenderPath.RawPlainTextFallback,
            decideRichContentDisplay("解析", null).path,
        )
        assertEquals(
            RichContentRenderPath.PreRenderedKatexHtml,
            decideRichContentDisplay(
                "解析",
                RenderedRichContent(html = "<p>解析</p>", contentHash = "answer"),
            ).path,
        )
        assertEquals(
            RichContentRenderPath.RawPlainTextFallback,
            decideRichContentDisplay(
                "解析",
                RenderedRichContent(
                    html = "<p>解析</p>",
                    contentHash = "bad",
                    errors = listOf(RenderedRichContentError(type = "katex", message = "bad")),
                ),
            ).path,
        )
    }

    @Test
    fun richContentDisplayDecisionExplainsFallbackReasons() {
        val rendered = RenderedRichContent(html = "<span class=\"katex\">v=at</span>", contentHash = "hash")
        val errored = rendered.copy(errors = listOf(RenderedRichContentError(type = "katex", message = "bad")))
        val empty = rendered.copy(html = "")

        assertEquals(
            RichContentDisplayDecision(RichContentRenderPath.PreRenderedKatexHtml, ""),
            decideRichContentDisplay("由 ${'$'}v=at${'$'} 可得", rendered),
        )
        assertEquals(
            RichContentDisplayDecision(RichContentRenderPath.RawPlainTextFallback, "rendered_errors"),
            decideRichContentDisplay("由 ${'$'}v=at${'$'} 可得", errored),
        )
        assertEquals(
            RichContentDisplayDecision(RichContentRenderPath.RawPlainTextFallback, "rendered_errors"),
            decideRichContentDisplay("由 ${'$'}v=at${'$'} 可得", errored.copy(html = "")),
        )
        assertEquals(
            RichContentDisplayDecision(RichContentRenderPath.RawPlainTextFallback, "rendered_empty"),
            decideRichContentDisplay("由 ${'$'}v=at${'$'} 可得", empty),
        )
        assertEquals(
            RichContentDisplayDecision(RichContentRenderPath.RawPlainTextFallback, "missing_rendered"),
            decideRichContentDisplay("由 ${'$'}v=at${'$'} 可得", null),
        )
        assertEquals(
            RichContentDisplayDecision(RichContentRenderPath.RawPlainTextFallback, "missing_rendered"),
            decideRichContentDisplay("普通说明", null),
        )
    }

    @Test
    fun localKatexCssUrlUsesWebViewAssetLoaderDomain() {
        assertEquals(
            "https://appassets.openphysics.local/assets/katex/katex.min.css",
            OpenPhysicsWebAssets.LocalKatexCssUrl,
        )
    }

    @Test
    fun renderedRichHtmlUsesDedicatedRichTextBridgeWithoutLegacyQuestionHooks() {
        val html = buildRenderedRichHtml(
            rendered = RenderedRichContent(
                html = "<p>由 <span class=\"katex\">v=at</span> 可得</p>",
                contentHash = "rendered",
            ),
        )

        assertTrue(html.contains(OpenPhysicsWebAssets.LocalKatexCssUrl))
        assertTrue(html.contains("window.OpenPhysicsRichText"))
        assertTrue(html.contains("OpenPhysicsRichText.setHeight"))
        assertTrue(html.contains("OpenPhysicsRichText.openImage"))
        assertFalse(html.contains("OpenPhysicsQuestion"))
        assertFalse(html.contains("selectChoice"))
        assertFalse(html.contains("window.MathJax"))
        assertFalse(html.contains("tex-svg.js"))
    }
}
