package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.CardSection
import cn.openphysics.androidapp.domain.CardSectionContent
import cn.openphysics.androidapp.domain.FormulaVariable
import cn.openphysics.androidapp.domain.KnowledgeCard
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.domain.RenderedRichContent
import cn.openphysics.androidapp.ui.KpAssessmentProgress
import org.junit.Assert.assertEquals
import org.junit.Test

class LearnScreenFlowTest {
    @Test
    fun `learn screen cta sends consolidation states to practice`() {
        val card = KnowledgeCard(
            contentId = "card_1",
            title = "参考系",
            consumed = true,
            sections = listOf(CardSection(title = "概念", text = "内容")),
        )

        assertEquals("去巩固小练", learnPracticeActionText(kp("mastered"), card))
        assertEquals("去巩固小练", learnPracticeActionText(kp("practice"), card))
    }

    @Test
    fun `learn screen cta sends learning states to mastery assessment`() {
        val card = KnowledgeCard(
            contentId = "card_1",
            title = "参考系",
            consumed = true,
            sections = listOf(CardSection(title = "概念", text = "内容")),
        )

        assertEquals("开始掌握评估", learnPracticeActionText(kp("learning"), card))
        assertEquals("开始掌握评估", learnPracticeActionText(kp("to_learn"), card))
        assertEquals("重新评估", learnPracticeActionText(kp("learning"), card, KpAssessmentProgress.InProgress))
    }

    @Test
    fun `knowledge card content uses learning content pane payload`() {
        val card = KnowledgeCard(
            contentId = "card_speed",
            title = "路程与位移",
            consumed = true,
            sections = listOf(
                CardSection(
                    title = "关键公式",
                    type = "formula",
                    text = "\$\\Delta x=x_2-x_1\$",
                    rendered = RenderedRichContent(html = "<span class=\"katex\">formula</span>"),
                    content = CardSectionContent(
                        latex = "\\Delta x=x_2-x_1",
                        variableTable = listOf(FormulaVariable("\\Delta x", "位移", "m")),
                    ),
                ),
            ),
        )

        val payload = buildKnowledgeCardPanePayload(card)
        val section = payload.getJSONArray("sections").getJSONObject(0)

        assertEquals("knowledge_card", payload.getString("mode"))
        assertEquals("路程与位移", payload.getString("title"))
        assertEquals("关键公式", section.getString("title"))
        assertEquals("formula", section.getString("type"))
        assertEquals("\$\\Delta x=x_2-x_1\$", section.getString("text"))
        assertEquals("<span class=\"katex\">formula</span>", section.getJSONObject("rendered").getString("html"))
        assertEquals("\\Delta x=x_2-x_1", section.getJSONObject("content").getString("latex"))
        assertEquals("位移", section.getJSONObject("content").getJSONArray("variable_table").getJSONObject(0).getString("name"))
    }

    private fun kp(learningState: String): KpNode {
        return KpNode(
            id = "kp_1",
            name = "参考系",
            volume = "必修 第一册",
            chapter = "第一章 运动的描述",
            section = "1.1",
            mastery = 0.0,
            status = "current",
            learningState = learningState,
            learningStateLabel = "",
            learningStateTone = "",
        )
    }
}
