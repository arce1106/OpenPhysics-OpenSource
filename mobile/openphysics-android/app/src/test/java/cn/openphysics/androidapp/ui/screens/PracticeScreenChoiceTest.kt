package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class PracticeScreenChoiceTest {
    @Test
    fun choiceSelectionIsOwnedByH5QuestionPaneBridge() {
        assertEquals(
            "AC",
            parseQuestionPaneSelection("""{"selectedOptions":["C","A"]}""").getOrNull()?.answer,
        )
    }

    @Test
    fun choiceSelectionBridgeKeepsQuestionIdentityForDraftPersistence() {
        val selection = parseQuestionPaneSelection(
            """{"questionId":"q_2","selectedOptions":["B"]}""",
        ).getOrThrow()

        assertEquals("q_2", selection.questionId)
        assertEquals("B", selection.answer)
    }

    @Test
    fun reusedQuestionPaneRoutesSelectionToTheCurrentlyDisplayedQuestion() {
        var activeQuestionId = "q_1"
        val savedAnswers = mutableMapOf<String, String>()

        activeQuestionId = "q_2"
        dispatchQuestionPaneSelection(
            selection = QuestionPaneSelection(questionId = "q_2", answer = "C"),
            activeQuestionId = { activeQuestionId },
            onAnswerChange = { questionId, answer -> savedAnswers[questionId] = answer },
        )

        assertEquals(mapOf("q_2" to "C"), savedAnswers)
    }

}
