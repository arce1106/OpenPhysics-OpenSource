package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.TutorChatMessage

/** Pending prompts stay out of API history until a complete reply is received. */
data class TutorRequestState(
    val pendingPrompt: String = "",
    val requestId: Long? = null,
    val error: String = "",
) {
    val isLoading: Boolean get() = requestId != null

    fun failed(message: String): TutorRequestState = copy(requestId = null, error = message)

    fun forGeneration(generation: Long): TutorRequestState =
        if (requestId != null && requestId != generation) {
            failed("上次提问已中断，可以重试。")
        } else {
            this
        }
}

internal fun Screen.tutorOwner(): Pair<String, String>? = when (this) {
    is Screen.Learn -> session.studentId to "learn:${kp.id}"
    is Screen.ReviewDetail -> session.studentId to "review:${mistake.answerId}"
    is Screen.PracticeResultScreen -> session.studentId to "result:${question.id}:${result.answerId}"
    else -> null
}

internal fun Screen.tutorRequestState(): TutorRequestState = when (this) {
    is Screen.Learn -> tutorRequest
    is Screen.ReviewDetail -> tutorRequest
    is Screen.PracticeResultScreen -> tutorRequest
    else -> TutorRequestState()
}

internal fun Screen.tutorConversationMessages(): List<TutorChatMessage> = when (this) {
    is Screen.Learn -> chatMessages
    is Screen.ReviewDetail -> tutorMessages
    is Screen.PracticeResultScreen -> tutorMessages
    else -> emptyList()
}

internal fun Screen.withTutorConversation(
    request: TutorRequestState,
    messages: List<TutorChatMessage> = tutorConversationMessages(),
): Screen = when (this) {
    is Screen.Learn -> copy(chatMessages = messages, tutorRequest = request)
    is Screen.ReviewDetail -> copy(tutorMessages = messages, tutorRequest = request)
    is Screen.PracticeResultScreen -> copy(tutorMessages = messages, tutorRequest = request)
    else -> this
}
