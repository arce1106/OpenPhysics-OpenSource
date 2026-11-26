package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.QuestionImage
import java.util.Locale

internal fun promptQuestionImages(
    stem: String,
    options: List<PracticeOption>,
    images: List<QuestionImage>,
): List<QuestionImage> {
    val stemRefs = questionImageRefs(stem)
    if (stemRefs.isNotEmpty()) return stemRefs.mapNotNull { images.getOrNull(it) }.filter { it.isPromptImage() }
    val optionRefs = options.flatMap { questionImageRefs(it.text) }.toSet()
    return images.filterIndexed { index, image ->
        index !in optionRefs && image.isPromptImage()
    }
}

private fun questionImageRefs(text: String): List<Int> {
    return Regex("\\{\\{IMG:(\\d+)\\}\\}")
        .findAll(text)
        .mapNotNull { it.groupValues.getOrNull(1)?.toIntOrNull() }
        .toList()
}

internal fun QuestionImage.isPromptImage(): Boolean {
    val type = imageType.lowercase(Locale.ROOT)
    return type != "explanation" && type != "option"
}
