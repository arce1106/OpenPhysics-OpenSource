package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.ui.PracticeReview
import cn.openphysics.androidapp.ui.LearningCatalogPracticeContext
import kotlin.math.abs
import kotlin.math.roundToInt

internal enum class PracticeSummaryTone {
    Mastered,
    Practice,
    Study,
    Neutral,
}

enum class PracticeSummaryAction {
    Learn,
    Practice,
    GaokaoReturn,
    GaokaoRepeat,
}

internal data class PracticeSummaryDialogModel(
    val title: String,
    val scoreText: String,
    val label: String,
    val feedback: String,
    val tone: PracticeSummaryTone,
    val meta: String? = null,
    val primaryLabel: String,
    val primaryAction: PracticeSummaryAction,
    val secondaryLabel: String? = null,
    val secondaryAction: PracticeSummaryAction? = null,
)

internal fun buildPracticeSummaryDialogModel(
    kpName: String,
    practice: PracticeSession,
    review: PracticeReview,
    learningCatalogContext: LearningCatalogPracticeContext? = null,
): PracticeSummaryDialogModel {
    if (learningCatalogContext?.isTeacherHomework == true) {
        val total = review.totalCount
        val credit = displayCredit(review.items.sumOf { resultCredit(it.result) })
        // The server weighs each question by the teacher's points; per question is the fallback.
        val score = practice.teacherPaper?.score
        val percent = score?.percent ?: if (total > 0) (credit / total * 100).roundToInt() else 0
        val full = score?.let { it.score >= it.maxScore } ?: (total > 0 && credit >= total - 0.001)
        return PracticeSummaryDialogModel(
            title = "作业批改结果",
            scoreText = "${learningCatalogContext.topicTitle}：得分 $percent/100",
            label = if (full) "这份作业全部完成得很好。" else "先看错题解析，把错因弄清楚。",
            feedback = "${score?.note ?: "AI 批改，老师审核后可能调整"}。老师会看到你的作答和批改结果。",
            tone = if (full) PracticeSummaryTone.Mastered else PracticeSummaryTone.Practice,
            primaryLabel = "返回首页",
            primaryAction = PracticeSummaryAction.GaokaoReturn,
        )
    }
    if (learningCatalogContext != null) {
        val total = review.totalCount
        val credit = displayCredit(review.items.sumOf { resultCredit(it.result) })
        val accuracy = if (total > 0) credit / total else 0.0
        val allCorrect = total > 0 && accuracy >= 0.999
        return PracticeSummaryDialogModel(
            title = if (practice.teacherPaper != null || learningCatalogContext.layer == cn.openphysics.androidapp.domain.LearningCatalogTopicLayer.Paper) "套卷批改结果" else "专题复习结果",
            scoreText = "${learningCatalogContext.topicTitle} · ${learningCatalogContext.layer.title}：得分 ${scoreText(credit)}/$total",
            label = if (allCorrect) {
                "本轮方法比较稳定，可以继续向综合题推进。"
            } else {
                "本轮已经暴露出需要修复的位置，先把错因闭环。"
            },
            feedback = "得分率 ${(accuracy * 100).roundToInt()}%。本次结果已计入当前高考专题状态。",
            tone = if (allCorrect) PracticeSummaryTone.Mastered else PracticeSummaryTone.Practice,
            primaryLabel = "返回专题路径",
            primaryAction = PracticeSummaryAction.GaokaoReturn,
            secondaryLabel = if (practice.teacherPaper != null) "重新作答" else "再练本层",
            secondaryAction = PracticeSummaryAction.GaokaoRepeat,
        )
    }
    val diagnostic = review.diagnosticFeedback
    if (diagnostic != null) {
        val tone = when (diagnostic.recommendation) {
            "mastered" -> PracticeSummaryTone.Mastered
            "practice" -> PracticeSummaryTone.Practice
            else -> PracticeSummaryTone.Study
        }
        val label = when (diagnostic.recommendation) {
            "mastered" -> "已掌握"
            "practice" -> "有基础，需巩固"
            else -> "建议先学习"
        }
        val shouldStudy = diagnostic.recommendation == "study"
        return PracticeSummaryDialogModel(
            title = "评估结果",
            scoreText = "${diagnostic.title.ifBlank { kpName }}：正确 ${diagnostic.correctCount}/${diagnostic.totalCount}",
            label = label,
            feedback = diagnostic.feedback,
            tone = tone,
            meta = if (abs(diagnostic.masteryAfter - diagnostic.masteryBefore) >= 0.005) {
                "掌握度：${percent(diagnostic.masteryBefore)} → ${percent(diagnostic.masteryAfter)}"
            } else {
                null
            },
            primaryLabel = if (shouldStudy) "去同步学习" else "做巩固小练",
            primaryAction = if (shouldStudy) PracticeSummaryAction.Learn else PracticeSummaryAction.Practice,
        )
    }

    val total = review.totalCount
    val credit = displayCredit(review.items.sumOf { resultCredit(it.result) })
    val accuracy = if (total > 0) credit / total else 0.0
    val allCorrect = total > 0 && accuracy >= 0.999
    val headline = if (allCorrect) {
        "本轮方法比较稳定，可以继续向综合题推进。"
    } else {
        "本轮已经暴露出需要修复的位置，先把错因闭环。"
    }
    val nextDescription = if (allCorrect) {
        "保持当前节奏，进入下一组题或下一个知识点。"
    } else {
        "先复盘错题和第一处错误，再进入下一轮训练。"
    }
    return PracticeSummaryDialogModel(
        title = "练习结果",
        scoreText = "${kpName.ifBlank { practice.objective.ifBlank { "当前知识点" } }}：得分 ${scoreText(credit)}/$total",
        label = headline,
        feedback = "得分率 ${(accuracy * 100).roundToInt()}%。$nextDescription",
        tone = PracticeSummaryTone.Neutral,
        primaryLabel = if (allCorrect) "回到同步学习" else "继续巩固",
        primaryAction = if (allCorrect) PracticeSummaryAction.Learn else PracticeSummaryAction.Practice,
    )
}

private fun resultCredit(result: SubmitResult): Double {
    val grading = result.processGrading
    if (grading?.score != null && grading.maxScore != null && grading.maxScore > 0.0) {
        return (grading.score / grading.maxScore).coerceIn(0.0, 1.0)
    }
    result.processGrading?.processScore?.let { score ->
        return (score / 100.0).coerceIn(0.0, 1.0)
    }
    val stepScores = result.processGrading?.stepScores.orEmpty()
    val maxScore = stepScores.sumOf { it.maxScore }
    if (maxScore > 0.0) {
        return (stepScores.sumOf { it.score } / maxScore).coerceIn(0.0, 1.0)
    }
    return if (result.correct) 1.0 else 0.0
}

private fun displayCredit(value: Double): Double =
    if (value == value.toInt().toDouble()) value else (value * 10).roundToInt() / 10.0

private fun scoreText(value: Double): String =
    if (value == value.toInt().toDouble()) value.toInt().toString() else value.toString()

private fun percent(value: Double): String = "${(value * 100).roundToInt().coerceIn(0, 100)}%"
