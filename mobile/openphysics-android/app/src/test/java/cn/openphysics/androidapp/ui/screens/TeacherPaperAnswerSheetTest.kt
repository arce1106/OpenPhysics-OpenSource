package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.QuestionLessonVideo
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.ui.PracticeReviewItem
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TeacherPaperAnswerSheetTest {
    private fun item(id: String, answerId: Int, available: Boolean = true) = PracticeReviewItem(
        PracticeQuestion(id = id, stem = "已保存的题干 $id", questionType = "calculation", options = emptyList(),
            images = emptyList(), correctAnswer = "2", explanation = "已保存的解析"),
        "1", SubmitResult(answerId, false, "2", "已保存的解析", "", lessonVideo = QuestionLessonVideo("v-$id", "讲解", 100, available)),
    )

    @Test fun paperPayloadPreservesQuestionOrderAnswersAndVideoEligibility() {
        val items = listOf(item("q-9", 91), item("q-1", 12, false))
        val payload = JSONObject(buildTeacherPaperReviewPayload(items))
        assertEquals("teacher_paper_review", payload.getString("mode"))
        val entries = payload.getJSONArray("paperItems")
        assertEquals("q-9", entries.getJSONObject(0).getJSONObject("question").getString("id"))
        assertEquals(91, entries.getJSONObject(0).getInt("answerId"))
        assertFalse(entries.getJSONObject(1).getJSONObject("lessonVideo").getBoolean("available"))
        assertFalse(entries.getJSONObject(0).getBoolean("canCorrectGrading"))
    }

    @Test fun videoAndTutorBridgeRequireMatchingAnswerAndQuestion() {
        val records = teacherPaperAnswerRecords(listOf(item("q-9", 91), item("q-1", 12, false)))
        val videos = mutableListOf<Int>()
        val tutors = mutableListOf<Int>()
        val errors = mutableListOf<String>()
        val bridge = LearningContentPaneBridge(records = { records }, onOpenLessonVideo = { videos += it.id },
            onOpenTutor = { tutors += it.id }, onError = errors::add)
        bridge.onOpenLessonVideo("""{"answerId":91,"questionId":"q-1"}""")
        bridge.onOpenTutor("""{"answerId":91,"questionId":"q-1"}""")
        bridge.onOpenLessonVideo("""{"answerId":12,"questionId":"q-1"}""")
        assertTrue(videos.isEmpty())
        assertTrue(tutors.isEmpty())
        assertEquals(3, errors.size)
        bridge.onOpenLessonVideo("""{"answerId":91,"questionId":"q-9"}""")
        bridge.onOpenTutor("""{"answerId":91,"questionId":"q-9"}""")
        assertEquals(listOf(91), videos)
        assertEquals(listOf(91), tutors)
    }

    @Test fun masteryPaletteHasDistinctScoreBandsAtEveryBoundary() {
        listOf(0 to 39, 40 to 69, 70 to 79, 80 to 100).forEach { (start, end) ->
            assertEquals(syncMasteryPalette(start), syncMasteryPalette(end))
        }
        assertEquals(4, listOf(0, 40, 70, 80).map { syncMasteryPalette(it).fill }.distinct().size)
    }
}
