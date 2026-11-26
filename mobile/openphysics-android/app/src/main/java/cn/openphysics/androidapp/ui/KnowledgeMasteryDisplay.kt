package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.KnowledgeMasteryJudgment
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone
import kotlin.math.roundToInt

data class KnowledgeMasteryDisplayFallback(
    val label: String,
    val reason: String,
    val tone: OpenPhysicsTone = OpenPhysicsTone.Primary,
    val masteryPct: Int? = null,
)

data class KnowledgeMasteryDisplayBadge(
    val label: String,
    val reason: String,
    val tone: OpenPhysicsTone,
    val masteryPct: Int?,
    val isJudgmentBased: Boolean,
)

fun mapKnowledgeMasteryJudgmentToMasteryDisplay(
    judgment: KnowledgeMasteryJudgment?,
    fallback: KnowledgeMasteryDisplayFallback,
): KnowledgeMasteryDisplayBadge {
    if (judgment == null) {
        return KnowledgeMasteryDisplayBadge(
            label = fallback.label,
            reason = fallback.reason,
            tone = fallback.tone,
            masteryPct = fallback.masteryPct,
            isJudgmentBased = false,
        )
    }
    return KnowledgeMasteryDisplayBadge(
        label = masteryDisplayLabelFor(judgment),
        reason = masteryDisplayReasonFor(judgment),
        tone = masteryDisplayToneFor(judgment),
        masteryPct = judgment.masteryScore?.let { (it.coerceIn(0.0, 1.0) * 100).roundToInt() },
        isJudgmentBased = true,
    )
}

fun masteryDisplayLabelFor(judgment: KnowledgeMasteryJudgment): String {
    if (judgment.confidence == "low") return "证据较少"
    return when (judgment.masteryLevel) {
        "weak" -> "薄弱"
        "developing" -> "发展中"
        "stable" -> "较稳定"
        "mastered" -> "已掌握"
        else -> "建议先学习"
    }
}

fun masteryDisplayToneFor(judgment: KnowledgeMasteryJudgment): OpenPhysicsTone {
    if (judgment.confidence == "low") return OpenPhysicsTone.Primary
    return when (judgment.masteryLevel) {
        "stable", "mastered" -> OpenPhysicsTone.Success
        "developing" -> OpenPhysicsTone.Warning
        "weak" -> OpenPhysicsTone.Primary
        else -> OpenPhysicsTone.Primary
    }
}

fun masteryDisplayReasonFor(judgment: KnowledgeMasteryJudgment): String {
    if (judgment.confidence == "low") {
        return "当前证据较少，建议先学习或完成掌握评估。"
    }
    if (judgment.reason.isNotBlank()) return judgment.reason
    return when (judgment.masteryLevel) {
        "mastered", "stable" -> "当前掌握较稳定，可以进入巩固或后续学习。"
        "developing" -> "已有一定基础，建议通过小练继续巩固。"
        "weak" -> "当前基础证据较弱，建议先学习知识点讲解。"
        else -> "建议先学习知识卡片，再用掌握评估确认理解。"
    }
}
