package cn.openphysics.androidapp.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.*
import cn.openphysics.androidapp.ui.KpAssessmentProgress
import kotlin.math.roundToInt
import cn.openphysics.androidapp.ui.masteryDisplayLabelFor
import cn.openphysics.androidapp.ui.TutorRequestState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PhoneDirectoryScreen(
    session: StudentSession,
    grouped: Map<String,List<ChapterGroup>>, focusedKpId: String,
    onHome: ()->Unit,onPractice: ()->Unit,onReview: ()->Unit,onMe: ()->Unit,
    onStartLearn: (ChapterGroup,KpNode,Boolean)->Unit,
    onStartCheck: (ChapterGroup,KpNode)->Unit,
    onStartTrain: (ChapterGroup,KpNode)->Unit,
    assessmentProgressFor: (String)->KpAssessmentProgress?,
    judgmentsByKpId: Map<String, KnowledgeMasteryJudgment> = emptyMap(),
    canAccessKp: (KpNode) -> Boolean = { true },
    onAccountUnavailable: () -> Unit = {},
) {
    val stateHolder = LocalPhoneDirectoryState.current ?: androidx.compose.runtime.saveable.rememberSaveableStateHolder()
    stateHolder.SaveableStateProvider("directory") {
        PhoneDirectoryContent(session, grouped, focusedKpId, onHome, onPractice, onReview, onMe, onStartLearn, onStartCheck,
            onStartTrain, assessmentProgressFor, judgmentsByKpId, canAccessKp, onAccountUnavailable)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PhoneDirectoryContent(
    session: StudentSession,
    grouped: Map<String,List<ChapterGroup>>, focusedKpId: String,
    onHome: ()->Unit,onPractice: ()->Unit,onReview: ()->Unit,onMe: ()->Unit,
    onStartLearn: (ChapterGroup,KpNode,Boolean)->Unit,
    onStartCheck: (ChapterGroup,KpNode)->Unit,
    onStartTrain: (ChapterGroup,KpNode)->Unit,
    assessmentProgressFor: (String)->KpAssessmentProgress?,
    judgmentsByKpId: Map<String, KnowledgeMasteryJudgment> = emptyMap(),
    canAccessKp: (KpNode) -> Boolean = { true },
    onAccountUnavailable: () -> Unit = {},
) {
    val volumes = grouped.keys.toList()
    val chapters = remember(grouped) { grouped.values.flatten() }
    val continueTarget = remember(chapters, session) { phoneContinueTarget(chapters, session) }
    val fallbackRecommended = remember(chapters) { selectMobileSyncRecommendedChapter(chapters) }
    val recommended = continueTarget?.first ?: fallbackRecommended
    val recommendedKp = continueTarget?.second
    var expandedVolume by rememberSaveable(volumes) { mutableStateOf(mobileSyncInitialVolume(volumes,recommended)) }
    var expandedChapter by rememberSaveable { mutableStateOf(recommended?.takeIf { it.volume==expandedVolume }?.chapter ?: grouped[expandedVolume]?.firstOrNull()?.chapter.orEmpty()) }
    var appliedFocus by rememberSaveable { mutableStateOf("") }
    var selectedKpId by rememberSaveable { mutableStateOf("") }
    val listStateHolder = androidx.compose.runtime.saveable.rememberSaveableStateHolder()
    val selectedKp = remember(grouped, selectedKpId) {
        grouped.values.asSequence().flatten().firstNotNullOfOrNull { chapter ->
            chapter.kps.firstOrNull { it.id == selectedKpId }?.let { chapter to it }
        }
    }
    if(focusedKpId.isNotBlank()) {
        LaunchedEffect(focusedKpId) {
            if (appliedFocus != focusedKpId) {
                grouped.values.flatten().firstOrNull { group -> group.kps.any { it.id==focusedKpId } }?.let {
                    expandedVolume = it.volume
                    expandedChapter = it.chapter
                }
                appliedFocus = focusedKpId
            }
        }
    }
    if (selectedKp != null) {
        val (chapter, kp) = selectedKp
        if (kp.contentPending) {
            BackHandler { selectedKpId = "" }
            PhoneDetailPage(kp.name, { selectedKpId = "" }, showFooter = false) {
                PendingContentNotice(kp.name)
            }
            return
        }
        val assessmentProgress = assessmentProgressFor(kp.id)
        val checkAction = phoneKpAssessmentAction(kp, assessmentProgress)
        val assessmentPrimary = checkAction.isConsolidation || assessmentProgress == KpAssessmentProgress.InProgress
        BackHandler { selectedKpId = "" }
        val locked = !canAccessKp(kp)
        PhoneDetailPage("知识点", { selectedKpId = "" }, showFooter = false, background = PhoneColors.Page,
            tabBar = { PhoneTabBar(MainTab.Learn, onHome, {}, onReview, onMe, reselectLearn = true) }) {
            if (locked) AccountUnavailableBanner(LockedKnowledgePointTitle, LockedKnowledgePointMessage, onAccountUnavailable)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(listOf(mobileSyncVolumeLabel(kp.volume), chapter.chapter).filter { it.isNotBlank() }.joinToString(" · "),
                    style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
                Text(kp.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    val judgment = judgmentsByKpId[kp.id]
                    val mastered = if (judgment != null) judgment.confidence != "low" && judgment.masteryLevel in setOf("stable", "mastered")
                        else learningStateFor(kp) == "mastered"
                    Text(phoneMasteryLabel(kp, judgment), style = MaterialTheme.typography.labelMedium,
                        color = if (mastered) PhoneColors.Success else PhoneColors.Primary, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.background(if (mastered) Color(0xFFE8F5E9) else PhoneColors.Soft, RoundedCornerShape(8.dp))
                            .padding(horizontal = 9.dp, vertical = 4.dp))
                    Text("掌握度 ${phoneMasteryPercent(kp, judgmentsByKpId[kp.id])}%", style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
                }
            }
            // iOS: the advice names the next step, then one grouped card with numbered rows,
            // the recommended one marked.
            val recommendCheck = assessmentPrimary || learningStateFor(kp) in setOf("practice", "mastered")
            Text(phoneKpAdvice(kp), style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted,
                modifier = Modifier.padding(horizontal = 4.dp))
            PhoneCard(padding = PaddingValues(0.dp)) {
                PhoneNumberedRow("01", "知识学习",
                    if (locked) LockedActionDetail else "${phoneLearnActionLabel(kp, assessmentProgress)} · 知识卡片与视频讲解",
                    if (locked || recommendCheck) null else "推荐") { onStartLearn(chapter, kp, false) }
                HorizontalDivider(Modifier.padding(start = 60.dp), color = PhoneColors.Divider)
                PhoneNumberedRow("02", checkAction.title, if (locked) LockedActionDetail else checkAction.subtitle,
                    if (!locked && recommendCheck) "推荐" else null) {
                    if (checkAction.isConsolidation) onStartTrain(chapter, kp) else onStartCheck(chapter, kp)
                }
            }
        }
        return
    }
    listStateHolder.SaveableStateProvider("volumeList") {
        MainPage(MainTab.Learn,onHome,{},onPractice,onReview,onMe) {
            if (recommended != null && recommendedKp != null) {
                Surface(
                    modifier = Modifier.fillMaxWidth().clickable(role = Role.Button) { selectedKpId = recommendedKp.id },
                    shape = RoundedCornerShape(16.dp), color = PhoneColors.Soft,
                ) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("接着学 · ${mobileSyncVolumeLabel(recommended.volume)} / ${recommended.chapter}",
                                style = MaterialTheme.typography.labelMedium, color = PhoneColors.Primary,
                                maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            Text(recommendedKp.name, style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold, color = PhoneColors.Ink,
                                maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        }
                        PhoneIcon(PhoneSymbol.Next, Modifier.size(18.dp), PhoneColors.Primary)
                    }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if(volumes.isEmpty()) Text("暂无教材目录",color=PhoneColors.Muted)
                volumes.forEach { volume ->
                    val volumeExpanded = expandedVolume==volume
                    PhoneCard(padding = PaddingValues(horizontal = 4.dp, vertical = 2.dp)) {
                    Row(Modifier.fillMaxWidth()
                        .clickable(role=Role.Button,onClick={
                            expandedVolume = if(volumeExpanded) "" else volume
                            if(!volumeExpanded) expandedChapter = ""
                        }).padding(horizontal = 12.dp, vertical = 13.dp),verticalAlignment=Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(mobileSyncVolumeLabel(volume).ifBlank { volume },Modifier.weight(1f),
                            style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.Bold)
                        Text("${grouped[volume].orEmpty().size} 章",style=MaterialTheme.typography.labelMedium,color=PhoneColors.Muted)
                        PhoneIcon(if(volumeExpanded) PhoneSymbol.Down else PhoneSymbol.Next,Modifier.size(18.dp),PhoneColors.Muted)
                    }
                    if(volumeExpanded) {
                        val chapters = grouped[volume].orEmpty()
                        HorizontalDivider(Modifier.padding(horizontal = 12.dp), color=PhoneColors.Divider)
                        if(chapters.isEmpty()) Text("当前教材暂无知识点。",Modifier.padding(12.dp),color=PhoneColors.Muted)
                        chapters.forEachIndexed { chapterIndex, chapter ->
                            val expanded = expandedChapter==chapter.chapter
                            Row(Modifier.fillMaxWidth().clickable(role=Role.Button,onClick={expandedChapter=if(expanded) "" else chapter.chapter}).padding(start=12.dp,end=12.dp,top=15.dp,bottom=15.dp),
                                verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                                    Text(chapter.chapter,style=MaterialTheme.typography.bodyLarge,fontWeight=FontWeight.SemiBold,color=PhoneColors.Primary)
                                    Text(phoneChapterSummary(chapter),style=MaterialTheme.typography.labelMedium,color=PhoneColors.Muted)
                                }
                                PhoneIcon(if(expanded) PhoneSymbol.Down else PhoneSymbol.Next,Modifier.size(18.dp),PhoneColors.Muted)
                            }
                            if(expanded) chapter.kps.forEachIndexed { index, kp ->
                                Row(Modifier.fillMaxWidth()
                                    .background(if (kp.id == recommendedKp?.id) PhoneColors.Soft else Color.White, RoundedCornerShape(10.dp))
                                    .clickable(role=Role.Button,onClick={selectedKpId=kp.id})
                                    .padding(start=16.dp,end=12.dp,top=12.dp,bottom=12.dp),
                                    verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                                    Box(Modifier.size(30.dp).background(Color.White,RoundedCornerShape(10.dp)),contentAlignment=Alignment.Center) {
                                        if(learningStateFor(kp)=="mastered") PhoneIcon(PhoneSymbol.Check,Modifier.size(17.dp),PhoneColors.Primary)
                                        else Text("${index+1}",style=MaterialTheme.typography.labelMedium,color=PhoneColors.Primary)
                                    }
                                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                                        Text(kp.name,style=MaterialTheme.typography.bodyMedium)
                                        Text(phoneMasteryLabel(kp, judgmentsByKpId[kp.id]),style=MaterialTheme.typography.labelMedium,color=PhoneColors.Muted)
                                    }
                                    if (kp.id == recommendedKp?.id) Text("继续", style = MaterialTheme.typography.labelSmall, color = PhoneColors.Primary)
                                    PhoneMasteryMeter(phoneMasteryPercent(kp, judgmentsByKpId[kp.id]))
                                }
                            }
                            if(chapterIndex<chapters.lastIndex) HorizontalDivider(Modifier.padding(horizontal = 12.dp), color=PhoneColors.Divider)
                        }
                    }
                    }
                }
            }
        }
    }
}

/** A visible point is a continue cue only when both its learning state and account access allow it. */
internal fun phoneContinueTarget(chapters: List<ChapterGroup>, session: StudentSession): Pair<ChapterGroup, KpNode>? {
    listOf("learning", "practice", "to_learn").forEach { state ->
        chapters.forEach { chapter ->
            chapter.kps.firstOrNull { !it.contentPending && learningStateFor(it) == state && StudentAccessPolicy.canAccessKp(session, it) }
                ?.let { return chapter to it }
        }
    }
    return null
}

private fun phoneHasMasteryEvidence(kp: KpNode): Boolean =
    kp.lastPracticed.isNotBlank() || kp.masteryPercent() > 0 || learningStateFor(kp) in setOf("mastered", "practice")

/** Keep the server's path state while naming its dimension when prior mastery evidence exists. */
internal fun phoneKpStatusLabel(kp: KpNode): String = learningKpStatus(kp).label.let { label ->
    if (label == "未开始" && phoneHasMasteryEvidence(kp)) "路径未开始" else label
}

/** iOS shows the mastery judgment (证据较少 / 发展中 / 已掌握…) and its score when the server has one. */
internal fun phoneMasteryLabel(kp: KpNode, judgment: KnowledgeMasteryJudgment?): String =
    judgment?.let(::masteryDisplayLabelFor) ?: phoneKpStatusLabel(kp)

internal fun phoneMasteryPercent(kp: KpNode, judgment: KnowledgeMasteryJudgment?): Int =
    judgment?.masteryScore?.let { (it.coerceIn(0.0, 1.0) * 100).roundToInt() } ?: kp.masteryPercent()

// iOS counts mastered points ("6/13 已掌握") rather than an average percentage.
private fun phoneChapterSummary(chapter: ChapterGroup): String =
    "${chapter.kps.count { learningStateFor(it) == "mastered" }}/${chapter.kps.size} 已掌握"

internal fun phoneKpAdvice(kp: KpNode): String = when (learningStateFor(kp)) {
    "mastered" -> "已基本掌握，可以巩固应用，也可以回看知识卡。"
    "practice" -> "概念已经学过，当前更适合用练习巩固。"
    "learning" -> "继续完成知识卡，再用掌握评估确认是否真正会用。"
    else -> "建议先学习知识卡，再用掌握评估确认理解。"
}

/** iOS OpenPhysicsPhoneActionRow: a numbered badge, title and detail, an optional accent value. */
@Composable
internal fun PhoneNumberedRow(number: String, title: String, detail: String, value: String?, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 72.dp).clickable(role = Role.Button, onClick = onClick).padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(32.dp).background(PhoneColors.Primary.copy(alpha = 0.10f), RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center) {
            Text(number, style = MaterialTheme.typography.labelMedium, color = PhoneColors.Primary, fontWeight = FontWeight.SemiBold)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            if (detail.isNotBlank()) Text(detail, style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
        }
        value?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = PhoneColors.Primary, fontWeight = FontWeight.SemiBold) }
        PhoneIcon(PhoneSymbol.Next, Modifier.size(16.dp), PhoneColors.Muted)
    }
}

private fun phoneLearnActionLabel(kp: KpNode, assessmentProgress: KpAssessmentProgress?): String = when {
    shouldUseConsolidationPractice(kp, assessmentProgress) -> "回看学习"
    assessmentProgress == KpAssessmentProgress.InProgress -> "回看学习"
    else -> when (learningStateFor(kp)) {
    "mastered" -> "查看学习"
    "learning", "practice" -> "继续学习"
    else -> "开始学习"
    }
}

internal data class PhoneKpAssessmentAction(
    val title: String,
    val subtitle: String,
    val action: String,
    val isConsolidation: Boolean,
)

internal fun phoneKpAssessmentAction(kp: KpNode, progress: KpAssessmentProgress?): PhoneKpAssessmentAction {
    if (shouldUseConsolidationPractice(kp, progress)) {
        return PhoneKpAssessmentAction("巩固小练", "用练习巩固已评估的知识点", "开始练习", true)
    }
    return PhoneKpAssessmentAction(
        "掌握评估", "用 3 道题确认是否真正会用",
        if (progress == KpAssessmentProgress.InProgress) "重新评估" else "开始评估", false,
    )
}

@Composable
internal fun PhoneLearnContent(
    kp: KpNode,bundle: LearnBundle,onBack: ()->Unit,onPractice: ()->Unit,onVideo: (String)->Unit,
    assessmentProgress: KpAssessmentProgress?,
    tabs: List<LearnTab>,selectedTab: LearnTab,onSelectTab: (LearnTab)->Unit,
    chatMessages: List<TutorChatMessage>,input: String,error: String,onInputChange: (String)->Unit,
    onSubmit: (String)->Unit,requestState: TutorRequestState,
) {
    var tutorOpen by rememberSaveable(kp.id) { mutableStateOf(false) }
    Scaffold(containerColor=Color.White,contentWindowInsets=WindowInsets(0),topBar={PhoneTopBar(bundle.kpName.ifBlank { kp.name },onBack)},bottomBar={
        Column(Modifier.background(Color.White)) {
            HorizontalDivider(color=PhoneColors.Divider)
            Row(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=10.dp),horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=Alignment.CenterVertically) {
                PhoneAction(if(tutorOpen) "收起助教" else "AI 助教",{tutorOpen=!tutorOpen},Modifier.weight(0.38f),primary=false)
                val assessmentAction = phoneKpAssessmentAction(kp, assessmentProgress)
                PhoneAction(
                    when {
                        assessmentAction.isConsolidation -> "去巩固小练"
                        assessmentProgress == KpAssessmentProgress.InProgress -> "重新评估"
                        else -> "开始掌握评估"
                    },
                    onPractice,
                    Modifier.weight(0.62f),
                )
            }
        }
    }) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).verticalScroll(rememberScrollState()).padding(horizontal=20.dp,vertical=12.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
            // iOS: the point's name lives in the navigation bar; a status pill and mastery head the page.
            Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text(listOf(mobileSyncVolumeLabel(kp.volume),kp.chapter).filter { it.isNotBlank() }.joinToString(" · "),style=MaterialTheme.typography.labelMedium,color=PhoneColors.Muted)
                Row(horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=Alignment.CenterVertically) {
                    Text(learningKpStatus(kp).label,style=MaterialTheme.typography.labelMedium,color=PhoneColors.Primary,fontWeight=FontWeight.SemiBold,
                        modifier=Modifier.background(PhoneColors.Soft,RoundedCornerShape(8.dp)).padding(horizontal=8.dp,vertical=3.dp))
                    Text("掌握度 ${kp.masteryPercent()}%",style=MaterialTheme.typography.labelMedium,color=PhoneColors.Muted)
                }
            }
            if (tabs.size <= 3) PhoneSegmentedTabs(tabs,selectedTab,
                {when(it){LearnTab.Card->"卡片";LearnTab.Resource->"讲解";else->it.title}},
                {when(it){LearnTab.Card->PhoneSymbol.Cards;LearnTab.Resource->PhoneSymbol.Play;else->null}},onSelectTab)
            else PhoneTextTabs(tabs,selectedTab,{when(it){LearnTab.Card->"知识卡片";LearnTab.Resource->"视频讲解";else->it.title}},onSelectTab)
            when(selectedTab) {
                LearnTab.Card -> {
                    val card = bundle.card
                    if(card==null || card.sections.isEmpty()) Text("暂无卡片",color=PhoneColors.Muted)
                    else KnowledgeCardPaneWebView(card,minimumHeightDp=100,phonePresentation=true)
                }
                LearnTab.Resource -> {
                    val resources = learnResourceCards(bundle)
                    if(resources.isEmpty()) Text("暂无相关视频讲解。",color=PhoneColors.Muted)
                    resources.forEach { resource ->
                        val externalSearch = resource.video?.let(::isBilibiliSearchResource) == true
                        Row(Modifier.fillMaxWidth().clickable(role=Role.Button,onClick={resource.video?.url?.let(onVideo)}).padding(vertical=12.dp),
                            horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=Alignment.CenterVertically) {
                            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                                Text(if (externalSearch) "外部搜索 · B 站" else resource.source,
                                    style=MaterialTheme.typography.labelMedium,color=PhoneColors.Primary)
                                Text(if (externalSearch) "搜索「${kp.name}」相关讲解" else resource.video?.title ?: resource.title,
                                    style=MaterialTheme.typography.bodyMedium,fontWeight=FontWeight.SemiBold)
                                if (externalSearch) Text("打开 B 站搜索结果",style=MaterialTheme.typography.labelMedium,color=PhoneColors.Muted)
                                else if(resource.subtitle.isNotBlank()) Text(resource.subtitle,style=MaterialTheme.typography.labelMedium,color=PhoneColors.Muted)
                            }
                            PhoneIcon(PhoneSymbol.Next,Modifier.size(20.dp),PhoneColors.Primary)
                        }
                        HorizontalDivider(color=PhoneColors.Divider)
                    }
                }
                LearnTab.Slides -> SlideDeckPanel(bundle)
                LearnTab.Interactive -> InteractiveResourcePanel(bundle)
            }
            val showProgress = selectedTab != LearnTab.Resource ||
                learnResourceCards(bundle).none { it.video?.let(::isBilibiliSearchResource) == true }
            if (showProgress) learnProgressText(bundle).takeIf { it.isNotBlank() }?.let {
                Text(it,style=MaterialTheme.typography.labelMedium,color=PhoneColors.Muted)
            }
            Spacer(Modifier.height(12.dp))
        }
    }
    if(tutorOpen) PhoneTutorSheet(learnTutorAssistantPolicy().copy(placeholder="输入关于这个知识点的问题"),chatMessages,input,error,onInputChange,onSubmit,{tutorOpen=false},requestState,
        contextTitle = kp.name)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PhoneTutorSheet(
    policy: TutorAssistantPolicy,chatMessages: List<TutorChatMessage>,input: String,error: String,
    onInputChange: (String)->Unit,onSubmit: (String)->Unit,onDismiss: ()->Unit,requestState: TutorRequestState,
    contextTitle: String = "",
) {
    var focused by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val dismiss = {focusManager.clearFocus();onDismiss()}
    val imeVisible = WindowInsets.ime.getBottom(LocalDensity.current)>0
    val hasConversation = chatMessages.isNotEmpty() || requestState.pendingPrompt.isNotBlank() || requestState.isLoading
    ModalBottomSheet(onDismissRequest=dismiss,containerColor=Color.White,sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(if(imeVisible) 0.96f else if(hasConversation) 0.84f else 0.62f)) {
            PhoneTopBar("AI 助教",trailing={
                IconButton(onClick=dismiss,modifier=Modifier.semantics {contentDescription="收起助教"}) {PhoneIcon(PhoneSymbol.Close)}
            })
            if (contextTitle.isNotBlank()) Text("正在讨论 · $contextTitle",
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp),
                style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted,
                maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            TutorAssistantConversation(policy,chatMessages,input,error,onInputChange,onSubmit,
                tutorAssistantPresentationState(chatMessages.isNotEmpty()||requestState.pendingPrompt.isNotBlank(),focused,imeVisible),
                {focused=it},requestState,Modifier.weight(1f))
        }
    }
}

/** iOS sync list trailing meter: the mastery percentage above a short progress bar. */
@Composable
internal fun PhoneMasteryMeter(percent: Int) {
    val value = percent.coerceIn(0, 100)
    val tone = when { value >= 80 -> PhoneColors.Success; value == 0 -> PhoneColors.Warning; else -> PhoneColors.Primary }
    Column(Modifier.width(64.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("$value%", style = MaterialTheme.typography.labelLarge, color = tone, fontWeight = FontWeight.SemiBold)
        Box(Modifier.fillMaxWidth().height(4.dp).background(PhoneColors.Divider, RoundedCornerShape(2.dp))) {
            if (value > 0) Box(Modifier.fillMaxWidth(value / 100f).fillMaxHeight().background(tone, RoundedCornerShape(2.dp)))
        }
    }
}

/** iOS capsule segmented control: the active segment is filled with the accent, the others tinted. */
@Composable
internal fun <T> PhoneSegmentedTabs(items: List<T>, selected: T, label: (T) -> String, icon: (T) -> PhoneSymbol?, onSelect: (T) -> Unit) {
    Row(Modifier.fillMaxWidth().selectableGroup(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        items.forEach { item ->
            val active = item == selected
            val content = if (active) Color.White else PhoneColors.Primary
            Row(Modifier.weight(1f).heightIn(min = 46.dp).clip(RoundedCornerShape(23.dp))
                .background(if (active) PhoneColors.Primary else PhoneColors.Soft)
                .selectable(active, role = Role.Tab, onClick = { onSelect(item) }).padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                icon(item)?.let { PhoneIcon(it, Modifier.size(18.dp), content); Spacer(Modifier.width(8.dp)) }
                Text(label(item), color = content, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
        }
    }
}

/** iOS 学习: three entry cards; each section opens as its own page. */
@Composable
internal fun PhoneLearnHubScreen(
    onHome: () -> Unit, onReview: () -> Unit, onMe: () -> Unit,
    onSync: () -> Unit, onReinforcement: () -> Unit, onGaokao: () -> Unit,
) {
    MainPage(MainTab.Learn, onHome, {}, {}, onReview, onMe) {
        PhoneRootTitle("学习")
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            PhoneHubEntry("同步学习", "按教材章节学习，读懂知识，再检查掌握情况。", PhoneSymbol.Book, onSync)
            PhoneHubEntry("巩固提升", "检测薄弱环节，完成针对练习与提升。", PhoneSymbol.Train, onReinforcement)
            PhoneHubEntry("高考复习", "按专题复习，完成分层训练和套卷。", PhoneSymbol.Graduation, onGaokao)
        }
    }
}

@Composable
private fun PhoneHubEntry(title: String, detail: String, icon: PhoneSymbol, onClick: () -> Unit) {
    PhoneCard(Modifier.clickable(role = Role.Button, onClick = onClick), padding = PaddingValues(16.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
            Box(Modifier.size(44.dp).background(PhoneColors.Soft, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                PhoneIcon(icon, Modifier.size(24.dp), PhoneColors.Primary)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(detail, style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
            }
            PhoneIcon(PhoneSymbol.Next, Modifier.size(16.dp), PhoneColors.Muted)
        }
    }
}
