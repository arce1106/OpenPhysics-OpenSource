package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.ChapterGroup
import cn.openphysics.androidapp.domain.DirectoryData
import cn.openphysics.androidapp.domain.KnowledgeMasteryJudgment
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.domain.StudentSession

/** The server directory owns mastery, learning stage and chapter totals. */
internal data class LearningDirectorySnapshot(
    val owner: StudentSession,
    val data: DirectoryData,
    val judgments: Map<String, KnowledgeMasteryJudgment>,
) {
    fun apply(screen: Screen): Screen {
        fun kp(old: KpNode) = data.kps.firstOrNull { it.id == old.id } ?: old
        fun chapter(old: ChapterGroup) = old.copy(kps = data.kps.filter { it.volume == old.volume && it.chapter == old.chapter })
        fun owns(session: StudentSession) = owner.studentId == session.studentId
        // Topic and homework practice runs on a synthetic KP outside the directory; adopting the
        // directory would drop it from the practice and make the saved practice unreadable.
        fun ownsPractice(session: StudentSession, practiceKp: KpNode) = owns(session) && data.kps.any { it.id == practiceKp.id }
        return when (screen) {
            is Screen.Directory -> if (owns(screen.session)) screen.copy(data = data, judgmentsByKpId = judgments) else screen
            is Screen.Learn -> if (owns(screen.session)) screen.copy(data = data, chapter = chapter(screen.chapter), kp = kp(screen.kp)) else screen
            is Screen.PracticeQuestionScreen -> if (ownsPractice(screen.session, screen.kp)) screen.copy(data = data, chapter = chapter(screen.chapter), kp = kp(screen.kp)) else screen
            is Screen.PracticeResultScreen -> if (ownsPractice(screen.session, screen.kp)) screen.copy(data = data, chapter = chapter(screen.chapter), kp = kp(screen.kp)) else screen
            is Screen.PracticeReviewScreen -> if (ownsPractice(screen.session, screen.kp)) screen.copy(data = data, chapter = chapter(screen.chapter), kp = kp(screen.kp)) else screen
            is Screen.ReinforcementHome -> if (owns(screen.session)) screen.copy(data = data, judgmentsByKpId = judgments) else screen
            is Screen.ReinforcementChapterPath -> if (owns(screen.session)) screen.copy(data = data, judgmentsByKpId = judgments) else screen
            is Screen.ReinforcementScopeResult -> if (owns(screen.session)) screen.copy(data = data) else screen
            is Screen.ReinforcementRetestResult -> if (owns(screen.session)) screen.copy(data = data) else screen
            is Screen.ReinforcementTaskComplete -> if (owns(screen.session)) screen.copy(data = data) else screen
            is Screen.ReinforcementReport -> if (owns(screen.session)) screen.copy(data = data) else screen
            is Screen.ReinforcementReportHistory -> if (owns(screen.session)) screen.copy(data = data) else screen
            is Screen.ReinforcementDiagnosticHistory -> if (owns(screen.session)) screen.copy(data = data) else screen
            is Screen.ReinforcementDiagnosticAttemptDetail -> if (owns(screen.session)) screen.copy(data = data) else screen
            is Screen.ReinforcementLearningTrace -> if (owns(screen.session)) screen.copy(data = data) else screen
            else -> screen
        }
    }
}
