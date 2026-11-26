package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.ChapterGroup
import cn.openphysics.androidapp.domain.DirectoryData
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.domain.KnowledgeMasteryJudgment
import cn.openphysics.androidapp.domain.StudentSession
import cn.openphysics.androidapp.ui.KpAssessmentProgress
import cn.openphysics.androidapp.ui.components.LearningCard
import cn.openphysics.androidapp.ui.components.StatusChip
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone

private val MOBILE_SYNC_VOLUME_LABELS = mapOf(
    "必修 第一册" to "必修一",
    "必修 第二册" to "必修二",
    "必修 第三册" to "必修三",
    "选择性必修 第一册" to "选必一",
    "选择性必修 第二册" to "选必二",
    "选择性必修 第三册" to "选必三",
)

@Composable
fun DirectoryScreen(
    session: StudentSession,
    data: DirectoryData,
    focusedKpId: String = "",
    judgmentsByKpId: Map<String, KnowledgeMasteryJudgment> = emptyMap(),
    grouped: Map<String, List<ChapterGroup>>,
    onHome: () -> Unit,
    onPractice: () -> Unit,
    onReview: () -> Unit,
    onMe: () -> Unit,
    onStartLearn: (ChapterGroup, KpNode, Boolean) -> Unit,
    onStartCheck: (ChapterGroup, KpNode) -> Unit,
    onStartTrain: (ChapterGroup, KpNode) -> Unit,
    assessmentProgressFor: (String) -> KpAssessmentProgress?,
    onKpAction: (ChapterGroup, KpNode, SyncKpActionKind) -> Unit,
    canAccessKp: (KpNode) -> Boolean = { true },
    onAccountUnavailable: () -> Unit = {},
) {
    if (LocalPhonePresentation.current) {
        PhoneDirectoryScreen(session, grouped, focusedKpId, onHome, onPractice, onReview, onMe,
            onStartLearn, onStartCheck, onStartTrain, assessmentProgressFor, judgmentsByKpId,
            canAccessKp, onAccountUnavailable)
        return
    }
    SyncTabletScreen(
        data = data,
        grouped = grouped,
        volumes = grouped.keys.toList(),
        focusedKpId = focusedKpId,
        judgmentsByKpId = judgmentsByKpId,
        assessmentProgressFor = assessmentProgressFor,
        onHome = onHome,
        onKpAction = onKpAction,
        canAccessKp = canAccessKp,
        onAccountUnavailable = onAccountUnavailable,
    )
}

fun selectMobileSyncRecommendedChapter(chapters: List<ChapterGroup>): ChapterGroup? {
    return chapters.firstOrNull { chapter ->
        hasLearningState(chapter.kps, "learning", "practice")
    } ?: chapters.firstOrNull { chapter ->
        hasLearningState(chapter.kps, "to_learn", "locked")
    } ?: chapters.firstOrNull()
}

fun mobileSyncInitialVolume(volumes: List<String>, recommendedChapter: ChapterGroup?): String {
    return recommendedChapter?.volume?.takeIf { it in volumes }
        ?: volumes.firstOrNull().orEmpty()
}

fun mobileSyncVolumeLabel(volume: String): String {
    return MOBILE_SYNC_VOLUME_LABELS[volume] ?: volume
}
