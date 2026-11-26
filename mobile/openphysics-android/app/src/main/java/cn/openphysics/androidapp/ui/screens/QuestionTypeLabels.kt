package cn.openphysics.androidapp.ui.screens

private val choiceQuestionTypes = setOf("single_choice", "multiple_choice", "choice")
private val blankQuestionTypes = setOf("blank", "fill_blank", "fill_in_blank", "fill_in_the_blank")

/**
 * Converts backend question type identifiers into student-facing labels.
 * Keep unknown values hidden from students; raw identifiers are implementation details.
 */
internal fun questionTypeLabel(questionType: String): String {
    val raw = questionType.trim()
    if (raw.isBlank()) return "练习题"

    val normalized = raw.lowercase()
        .replace("-", "_")
        .replace(" ", "_")

    return when {
        normalized in choiceQuestionTypes ||
            normalized.contains("choice") ||
            raw.contains("选择") ||
            raw.contains("单选") ||
            raw.contains("多选") -> "选择题"

        normalized in blankQuestionTypes ||
            normalized.contains("blank") ||
            normalized.contains("fill") ||
            raw.contains("填空") -> "填空题"

        normalized.contains("experiment") ||
            normalized.contains("experimental") ||
            raw.contains("实验") -> "实验题"

        normalized.contains("calculation") ||
            normalized.contains("problem_solving") ||
            normalized.contains("problem") ||
            normalized.contains("solving") ||
            normalized.contains("subjective") ||
            normalized.contains("essay") ||
            normalized.contains("short_answer") ||
            normalized.contains("written") ||
            raw.contains("解答") ||
            raw.contains("计算") ||
            raw.contains("简答") -> "解答题"

        normalized.contains("judge") ||
            normalized.contains("true_false") ||
            normalized.contains("boolean") ||
            raw.contains("判断") -> "判断题"

        else -> "练习题"
    }
}
