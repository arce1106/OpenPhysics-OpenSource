package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.LearnBundle
import cn.openphysics.androidapp.domain.VideoItem

data class LearnResourceGroups(
    val lecture: VideoItem?,
    val demonstration: VideoItem?,
)

fun LearnBundle.toLearnResourceGroups(): LearnResourceGroups {
    val demonstration = videos.firstOrNull { it.isDemonstrationResource() }
    val lecture = videos.firstOrNull { !it.isDemonstrationResource() }
    return LearnResourceGroups(lecture = lecture, demonstration = demonstration)
}

private fun VideoItem.isDemonstrationResource(): Boolean {
    val text = listOf(title, category, uploader).joinToString(" ")
    return listOf("实验", "演示", "demo", "experiment").any { keyword ->
        text.contains(keyword, ignoreCase = true)
    }
}
