package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.LocalImageFile
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.ui.draft.DraftCanvasSnapshot
import cn.openphysics.androidapp.ui.draft.hasAnswerInk

/** Freeze and prepare the whole set before making any grading request. */
internal object PracticeHandwritingPreparation {
    fun prepare(
        submissions: List<PracticeSubmission>,
        snapshots: Map<String, DraftCanvasSnapshot>,
        export: (PracticeQuestion, DraftCanvasSnapshot) -> LocalImageFile,
    ): List<PracticeSubmission> = submissions.map { submission ->
        val snapshot = snapshots[submission.question.id]
        when {
            submission.selfReview != null || submission.photo != null -> submission
            snapshot?.hasAnswerInk() != true -> submission
            submission.question.isChoice() -> submission.copy(scratchImage = export(submission.question, snapshot))
            else -> submission.copy(
                answer = "[手写作答]",
                handwriting = export(submission.question, snapshot),
            )
        }
    }
}
