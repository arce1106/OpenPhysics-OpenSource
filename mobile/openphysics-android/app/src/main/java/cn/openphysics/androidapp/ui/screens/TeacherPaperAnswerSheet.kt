package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.data.api.ApiClient
import cn.openphysics.androidapp.data.session.ChatHistoryStore
import cn.openphysics.androidapp.domain.AnswerHistoryRecord
import cn.openphysics.androidapp.domain.StudentSession
import cn.openphysics.androidapp.domain.TutorChatMessage
import cn.openphysics.androidapp.ui.PracticeReviewItem
import cn.openphysics.androidapp.ui.Screen
import cn.openphysics.androidapp.ui.TutorRequestState
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

internal fun teacherPaperAnswerRecords(items: List<PracticeReviewItem>): List<AnswerHistoryRecord> = items.mapNotNull { item ->
    val answerId = item.result.answerId ?: return@mapNotNull null
    AnswerHistoryRecord(
        id = answerId, questionId = item.question.id, stemText = item.question.stem,
        questionType = item.question.questionType, options = item.question.options, images = item.question.images,
        kpNames = emptyList(), givenAnswer = item.answer, isCorrect = item.result.correct,
        correctAnswer = item.result.correctAnswer, explanation = item.result.explanation, createdAt = "",
        lessonVideo = item.result.lessonVideo ?: item.question.lessonVideo,
    )
}

internal fun buildTeacherPaperReviewPayload(items: List<PracticeReviewItem>): String = JSONObject()
    .put("mode", "teacher_paper_review")
    .put("paperItems", JSONArray().also { array ->
        items.forEachIndexed { index, item ->
            val video = item.result.lessonVideo ?: item.question.lessonVideo
            val payload = buildQuestionPanePayload(
                question = item.question, index = index, total = items.size, answer = item.answer,
                result = item.result, readOnly = true, includeSolution = true, resultPresentation = true,
                canCorrectGrading = practiceResultCanCorrectGrading(item.result),
            ).put("answerId", item.result.answerId ?: JSONObject.NULL)
            if (video != null) payload.put("lessonVideo", JSONObject()
                .put("id", video.id).put("title", video.title).put("duration_seconds", video.durationSeconds)
                .put("available", video.available).put("locked_reason", video.lockedReason))
            array.put(payload)
        }
    }).toString()

@Composable
internal fun TeacherPaperAnswerSheet(
    screen: Screen.PracticeReviewScreen,
    onDone: () -> Unit,
    onRestart: (() -> Unit)? = null,
    onCorrectGrading: (QuestionPaneGradingCorrection) -> Unit = {},
) {
    // The saved question snapshots determine order, never the grading completion order.
    val items = remember(screen.practice.questions, screen.review) {
        screen.practice.questions.mapNotNull { question -> screen.review.items.firstOrNull { it.question.id == question.id } }
    }
    val records = remember(items) { teacherPaperAnswerRecords(items) }
    val payload = remember(items) { buildTeacherPaperReviewPayload(items) }
    var tutorAnswerId by remember(screen.practice.teacherPaper?.attemptId) { mutableStateOf<Int?>(null) }
    var confirmRestart by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(OpenPhysicsColors.Background).padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TextButton(onClick = onDone) { Text("返回") }
            Text(if (screen.learningCatalogContext?.isTeacherHomework == true) "老师作业 · 答卷复盘" else "教师作业 · 答卷复盘", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            screen.practice.teacherPaper?.score?.let { score ->
                Column(horizontalAlignment = Alignment.End) {
                    Text("得分 ${score.percent}/100", style = MaterialTheme.typography.titleMedium,
                        color = OpenPhysicsColors.PrimaryDeep, fontWeight = FontWeight.Bold)
                    Text(score.note, style = MaterialTheme.typography.labelSmall, color = OpenPhysicsColors.Muted)
                }
            }
            if (onRestart != null) TextButton(onClick = { confirmRestart = true }) { Text("重新作答") }
        }
        HistoryRecordsPaneWebView(
            records = records, onOpenReview = {}, studentToken = screen.session.token,
            paperPayload = payload, onOpenTutor = { tutorAnswerId = it.id }, onCorrectGrading = onCorrectGrading, modifier = Modifier.weight(1f),
        )
    }
    if (confirmRestart && onRestart != null) AlertDialog(
        onDismissRequest = { confirmRestart = false }, title = { Text("重新作答这份套卷？") },
        text = { Text("将开始一份新答卷，原作答记录会保留。") },
        confirmButton = { TextButton(onClick = { confirmRestart = false; onRestart() }) { Text("重新作答") } },
        dismissButton = { TextButton(onClick = { confirmRestart = false }) { Text("取消") } },
    )
    items.firstOrNull { it.result.answerId == tutorAnswerId && tutorAnswerId != null }?.let { item ->
        key(item.result.answerId) {
            TeacherPaperTutorDialog(screen.session, item) { tutorAnswerId = null }
        }
    }
}

@Composable
private fun TeacherPaperTutorDialog(session: StudentSession, item: PracticeReviewItem, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val store = remember { ChatHistoryStore(context.applicationContext) }
    val chatScope = "question-answer:${item.result.answerId}"
    var messages by remember { mutableStateOf(store.read(session.studentId, chatScope)) }
    var input by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var pendingPrompt by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val api = remember { ApiClient() }
    TutorAssistantDialog(
        policy = practiceResultTutorAssistantPolicy(), chatMessages = messages, input = input,
        error = "", onInputChange = { input = it },
        requestState = TutorRequestState(
            pendingPrompt = pendingPrompt,
            requestId = if (sending) 0L else null,
            error = error,
        ),
        onDismiss = onDismiss,
        onSubmit = { message ->
            if (!sending && message.isNotBlank()) {
                sending = true
                error = ""
                pendingPrompt = message.trim()
                input = ""
                scope.launch {
                    try {
                        val prompt = message.trim()
                        val reply = withContext(Dispatchers.IO) {
                            api.questionTutorChat(session.token, item.question.id, item.answer, prompt, messages, item.result.processGrading)
                        }
                        messages = (messages + TutorChatMessage("user", prompt) + TutorChatMessage("assistant", reply)).takeLast(30)
                        pendingPrompt = ""
                        store.save(session.studentId, chatScope, messages)
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (failure: Exception) {
                        error = failure.message ?: "暂时无法获取讲解，请重试"
                    } finally {
                        sending = false
                    }
                }
            }
        },
    )
}
