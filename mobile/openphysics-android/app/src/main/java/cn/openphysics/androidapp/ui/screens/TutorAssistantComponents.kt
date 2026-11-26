package cn.openphysics.androidapp.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import cn.openphysics.androidapp.domain.TutorChatMessage
import cn.openphysics.androidapp.ui.TutorRequestState
import cn.openphysics.androidapp.ui.components.SecondaryActionButton
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import kotlin.math.roundToInt

data class TutorAssistantPolicy(
    val dialogTitle: String,
    val triggerLabel: String,
    val floatsOverContent: Boolean,
    val triggerIsDraggable: Boolean,
    val triggerOpensDialog: Boolean,
    val triggerSendsPromptImmediately: Boolean,
    val quickPromptsUseVerticalPills: Boolean,
    val composerPlacesSendInsideInput: Boolean,
    val sendUsesIconOnly: Boolean,
    val quickPrompts: List<String>,
    val placeholder: String,
    val loadingText: String,
    val triggerPlacement: TutorAssistantTriggerPlacement = TutorAssistantTriggerPlacement(),
)

data class TutorAssistantTriggerPlacement(
    val initialYOffsetPx: Int = 0,
    val minYOffsetPx: Int = -720,
    val maxYOffsetPx: Int = 24,
)

data class TutorAssistantPresentationState(
    val showQuickPrompts: Boolean,
    val compactComposer: Boolean,
    val allowDialogDrag: Boolean,
)

fun tutorAssistantPresentationState(
    hasMessages: Boolean,
    inputFocused: Boolean,
    imeVisible: Boolean,
): TutorAssistantPresentationState {
    val focusedInputMode = inputFocused || imeVisible
    return TutorAssistantPresentationState(
        showQuickPrompts = !hasMessages && !focusedInputMode,
        compactComposer = focusedInputMode,
        allowDialogDrag = !focusedInputMode,
    )
}

fun learnTutorTriggerPlacement(): TutorAssistantTriggerPlacement {
    return TutorAssistantTriggerPlacement(
        initialYOffsetPx = -180,
        minYOffsetPx = -1080,
        maxYOffsetPx = 24,
    )
}

fun learnTutorAssistantPolicy(): TutorAssistantPolicy {
    return TutorAssistantPolicy(
        dialogTitle = "AI助教",
        triggerLabel = "AI助教",
        floatsOverContent = true,
        triggerIsDraggable = true,
        triggerOpensDialog = true,
        triggerSendsPromptImmediately = false,
        quickPromptsUseVerticalPills = true,
        composerPlacesSendInsideInput = true,
        sendUsesIconOnly = true,
        quickPrompts = learnTutorQuickPrompts(),
        placeholder = "有什么关于这个知识点的问题，都可以问我",
        loadingText = "助教正在梳理这个知识点...",
        triggerPlacement = learnTutorTriggerPlacement(),
    )
}

@Composable
fun TutorAssistantFloating(
    policy: TutorAssistantPolicy,
    chatMessages: List<TutorChatMessage>,
    input: String,
    error: String,
    onInputChange: (String) -> Unit,
    onSubmit: (String) -> Unit,
    modifier: Modifier = Modifier,
    requestState: TutorRequestState = TutorRequestState(),
) {
    var open by remember { mutableStateOf(false) }
    val tablet = isTabletLayout()
    val focusManager = LocalFocusManager.current
    val triggerPlacement = policy.triggerPlacement
    var triggerOffset by remember(triggerPlacement) {
        mutableStateOf(IntOffset(0, triggerPlacement.initialYOffsetPx))
    }
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.BottomEnd,
    ) {
        if (open) {
            TutorAssistantPanel(
                policy = policy,
                chatMessages = chatMessages,
                input = input,
                error = error,
                onInputChange = onInputChange,
                onSubmit = onSubmit,
                onDismiss = { open = false },
                requestState = requestState,
            )
        }
        // Draw the trigger above the non-modal panel so the same button can
        // close it, including while the assistant is still generating a reply.
        TutorAssistantTrigger(
            label = policy.triggerLabel,
            onClick = {
                if (open) focusManager.clearFocus()
                open = !open
            },
            draggable = policy.triggerIsDraggable && (!open || tablet),
            compact = open && !tablet,
            onDrag = { dx, dy ->
                triggerOffset = IntOffset(
                    x = (triggerOffset.x + dx.roundToInt()).coerceIn(-720, 24),
                    y = (triggerOffset.y + dy.roundToInt()).coerceIn(
                        triggerPlacement.minYOffsetPx,
                        triggerPlacement.maxYOffsetPx,
                    ),
                )
            },
            modifier = Modifier
                .offset { if (open && !tablet) IntOffset.Zero else triggerOffset }
                .padding(if (open && !tablet) 12.dp else 18.dp),
        )
    }
}

@Composable
private fun TutorAssistantTrigger(
    label: String,
    onClick: () -> Unit,
    draggable: Boolean,
    onDrag: (Float, Float) -> Unit,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    Column(
        modifier = modifier
            .then(
                if (draggable) {
                    Modifier.pointerInput(Unit) {
                        detectDragGestures { change, dragAmount ->
                            change.consume()
                            onDrag(dragAmount.x, dragAmount.y)
                        }
                    }
                } else {
                    Modifier
                },
            )
            .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Large))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Large))
            .clickable(onClick = onClick)
            .heightIn(min = 48.dp)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
    ) {
        if (!compact) Box(
            modifier = Modifier
                .size(42.dp)
                .background(OpenPhysicsColors.PrimarySoft, RoundedCornerShape(999.dp))
                .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(999.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text("AI", color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        }
        Text(label, color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun TutorAssistantDialog(
    policy: TutorAssistantPolicy,
    chatMessages: List<TutorChatMessage>,
    input: String,
    error: String,
    onInputChange: (String) -> Unit,
    onSubmit: (String) -> Unit,
    onDismiss: () -> Unit,
    requestState: TutorRequestState = TutorRequestState(),
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        TutorAssistantPanel(
            policy, chatMessages, input, error, onInputChange, onSubmit, onDismiss,
            requestState = requestState,
            reserveTriggerSpace = false,
            modifier = Modifier
                .windowInsetsPadding(
                    WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Top),
                )
                .windowInsetsPadding(WindowInsets.ime),
        )
    }
}

/** An in-page overlay: its uncovered action rail remains interactive. */
@Composable
fun TutorAssistantPanel(
    policy: TutorAssistantPolicy,
    chatMessages: List<TutorChatMessage>,
    input: String,
    error: String,
    onInputChange: (String) -> Unit,
    onSubmit: (String) -> Unit,
    onDismiss: () -> Unit,
    requestState: TutorRequestState = TutorRequestState(),
    reserveTriggerSpace: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val tablet = isTabletLayout()
    val focusManager = LocalFocusManager.current
    val dismiss = {
        focusManager.clearFocus()
        onDismiss()
    }
    BackHandler(onBack = dismiss)
    var inputFocused by remember { mutableStateOf(false) }
    val imeVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    val presentation = tutorAssistantPresentationState(
        hasMessages = chatMessages.isNotEmpty() || requestState.pendingPrompt.isNotBlank(),
        inputFocused = inputFocused,
        imeVisible = imeVisible,
    )
    var offsetX by remember { mutableFloatStateOf(0f) }
    var offsetY by remember { mutableFloatStateOf(0f) }
    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(
                start = if (tablet) 24.dp else 12.dp,
                top = 12.dp,
                end = if (tablet && reserveTriggerSpace) 124.dp else 12.dp,
                bottom = if (!tablet && reserveTriggerSpace) 72.dp else 12.dp,
            ),
        contentAlignment = if (tablet) Alignment.BottomEnd else Alignment.BottomCenter,
    ) {
        Column(
            modifier = Modifier
                .then(if (tablet) Modifier.width(430.dp) else Modifier.fillMaxWidth())
                .fillMaxHeight(
                    when {
                        presentation.compactComposer -> 1f
                        tablet -> 0.96f
                        else -> 0.94f
                    },
                )
                .offset {
                    if (presentation.compactComposer) IntOffset.Zero
                    else IntOffset(offsetX.roundToInt(), offsetY.roundToInt())
                }
                .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Large))
                .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Large))
                .pointerInput(Unit) { detectTapGestures { /* Block taps through the panel. */ } },
        ) {
            TutorAssistantHeader(
                title = policy.dialogTitle,
                draggable = tablet && presentation.allowDialogDrag,
                onDrag = { dx, dy ->
                    offsetX += dx
                    offsetY += dy
                },
                onDismiss = dismiss,
            )
            TutorAssistantConversation(
                policy = policy,
                chatMessages = chatMessages,
                input = input,
                error = error,
                onInputChange = onInputChange,
                onSubmit = onSubmit,
                presentation = presentation,
                onInputFocusChanged = { inputFocused = it },
                requestState = requestState,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun TutorAssistantHeader(
    title: String,
    draggable: Boolean,
    onDrag: (Float, Float) -> Unit,
    onDismiss: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (draggable) {
                    Modifier.pointerInput(Unit) {
                        detectDragGestures { change, dragAmount ->
                            change.consume()
                            onDrag(dragAmount.x, dragAmount.y)
                        }
                    }
                } else {
                    Modifier
                },
            )
            .padding(horizontal = 18.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.weight(1f))
        Box(
            modifier = Modifier
                .size(38.dp)
                .clickable(onClick = onDismiss),
            contentAlignment = Alignment.Center,
        ) {
            Text("×", color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.titleLarge)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TutorAssistantConversation(
    policy: TutorAssistantPolicy,
    chatMessages: List<TutorChatMessage>,
    input: String,
    error: String,
    onInputChange: (String) -> Unit,
    onSubmit: (String) -> Unit,
    presentation: TutorAssistantPresentationState,
    onInputFocusChanged: (Boolean) -> Unit,
    requestState: TutorRequestState,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()
    fun send(text: String) {
        val trimmed = text.trim()
        if (trimmed.isBlank() || requestState.isLoading) return
        onSubmit(trimmed)
        scope.launch { scrollState.animateScrollTo(scrollState.maxValue) }
    }
    LaunchedEffect(chatMessages.size, requestState, scrollState.maxValue, presentation.compactComposer) {
        scrollState.scrollTo(scrollState.maxValue)
    }
    Column(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(scrollState)
                .padding(horizontal = 18.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (presentation.showQuickPrompts) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    policy.quickPrompts.forEach { prompt ->
                        if (LocalPhonePresentation.current) {
                            PhoneLinkRow(prompt, "") { send(prompt) }
                            androidx.compose.material3.HorizontalDivider(color = PhoneColors.Divider)
                        } else {
                            TutorAssistantPromptButton(prompt = prompt, onClick = { send(prompt) })
                        }
                    }
                }
            } else {
                chatMessages.forEach { message ->
                    TutorAssistantMessageBubble(message)
                }
                if (requestState.pendingPrompt.isNotBlank()) {
                    TutorAssistantMessageBubble(TutorChatMessage("user", requestState.pendingPrompt))
                }
                if (requestState.isLoading) {
                    Row(
                        modifier = Modifier
                            .background(OpenPhysicsColors.PrimarySoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        Text(policy.loadingText, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color.White)
                .border(1.dp, Color(0xFFF0F3F5)),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TutorAssistantComposer(
                input = input,
                placeholder = policy.placeholder,
                onInputChange = onInputChange,
                onSubmit = { send(input) },
                compact = presentation.compactComposer,
                onFocusChanged = onInputFocusChanged,
                sending = requestState.isLoading,
                modifier = Modifier.padding(16.dp),
            )
            val visibleError = error.ifBlank { requestState.error }
            if (visibleError.isNotBlank()) {
                Box(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    MutedText(visibleError)
                }
            }
            if (!requestState.isLoading && requestState.error.isNotBlank() && requestState.pendingPrompt.isNotBlank()) {
                SecondaryActionButton(
                    "重试这次提问",
                    onClick = { send(requestState.pendingPrompt) },
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun TutorAssistantPromptButton(prompt: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .background(Color.White, RoundedCornerShape(999.dp))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(999.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TutorAssistantPromptMark()
        Text(
            prompt,
            modifier = Modifier.weight(1f),
            color = OpenPhysicsColors.Ink,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
        )
        Text("→", color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun TutorAssistantPromptMark() {
    Canvas(modifier = Modifier.size(24.dp)) {
        val color = Color(0xFFFF6A3D)
        drawCircle(color = color.copy(alpha = 0.18f), radius = size.minDimension / 2f)
        drawLine(
            color = color,
            start = androidx.compose.ui.geometry.Offset(size.width / 2f, size.height * 0.22f),
            end = androidx.compose.ui.geometry.Offset(size.width / 2f, size.height * 0.78f),
            strokeWidth = 7f,
            cap = StrokeCap.Round,
        )
        drawLine(
            color = color,
            start = androidx.compose.ui.geometry.Offset(size.width * 0.22f, size.height / 2f),
            end = androidx.compose.ui.geometry.Offset(size.width * 0.78f, size.height / 2f),
            strokeWidth = 7f,
            cap = StrokeCap.Round,
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TutorAssistantComposer(
    input: String,
    placeholder: String,
    onInputChange: (String) -> Unit,
    onSubmit: () -> Unit,
    compact: Boolean,
    onFocusChanged: (Boolean) -> Unit,
    sending: Boolean,
    modifier: Modifier = Modifier,
) {
    val enabled = input.trim().isNotEmpty() && !sending
    val bringIntoViewRequester = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    Box(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = if (compact) 72.dp else 108.dp)
            .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(
                width = 1.5.dp,
                color = if (enabled) OpenPhysicsColors.Primary else OpenPhysicsColors.Border,
                shape = RoundedCornerShape(OpenPhysicsRadius.Medium),
            )
            .padding(14.dp),
    ) {
        BasicTextField(
            value = input,
            onValueChange = onInputChange,
            minLines = 1,
            maxLines = 4,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(
                onSend = {
                    if (enabled) onSubmit()
                },
            ),
            textStyle = TextStyle(
                color = OpenPhysicsColors.Ink,
                fontSize = MaterialTheme.typography.bodyLarge.fontSize,
                lineHeight = MaterialTheme.typography.bodyLarge.lineHeight,
            ),
            cursorBrush = SolidColor(OpenPhysicsColors.Primary),
            modifier = Modifier
                .fillMaxWidth()
                .padding(end = 52.dp)
                .bringIntoViewRequester(bringIntoViewRequester)
                .onFocusChanged { focusState ->
                    onFocusChanged(focusState.isFocused)
                    if (focusState.isFocused) {
                        scope.launch { bringIntoViewRequester.bringIntoView() }
                    }
                },
            decorationBox = { innerTextField ->
                Box {
                    if (input.isBlank()) {
                        Text(
                            placeholder,
                            color = OpenPhysicsColors.Muted,
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    }
                    innerTextField()
                }
            },
        )
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .size(40.dp)
                .background(
                    if (enabled) OpenPhysicsColors.Primary else Color(0xFFE5EAEF),
                    RoundedCornerShape(999.dp),
                )
                .clickable(enabled = enabled, onClick = onSubmit),
            contentAlignment = Alignment.Center,
        ) {
            TutorAssistantSendIcon(enabled = enabled)
        }
    }
}

@Composable
private fun TutorAssistantSendIcon(enabled: Boolean) {
    val iconColor = if (enabled) Color.White else Color(0xFF7B8491)
    Canvas(modifier = Modifier.size(20.dp)) {
        val body = Path().apply {
            moveTo(size.width * 0.16f, size.height * 0.52f)
            lineTo(size.width * 0.86f, size.height * 0.18f)
            lineTo(size.width * 0.58f, size.height * 0.86f)
            lineTo(size.width * 0.46f, size.height * 0.58f)
            close()
        }
        drawPath(path = body, color = iconColor)
        drawLine(
            color = if (enabled) OpenPhysicsColors.Primary else Color(0xFFE5EAEF),
            start = androidx.compose.ui.geometry.Offset(size.width * 0.46f, size.height * 0.58f),
            end = androidx.compose.ui.geometry.Offset(size.width * 0.66f, size.height * 0.36f),
            strokeWidth = 2f,
            cap = StrokeCap.Round,
        )
    }
}

@Composable
private fun TutorAssistantMessageBubble(message: TutorChatMessage) {
    val isUser = message.role == "user"
    // Matches iOS: the student's own message is white on the accent, sized to its text and
    // right-aligned; the tutor's reply keeps full-strength ink on the soft card.
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = if (isUser) 44.dp else 0.dp, end = if (isUser) 0.dp else 24.dp),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier
                .background(
                    if (isUser) OpenPhysicsColors.Primary else Color(0xFFF2F6F7),
                    RoundedCornerShape(OpenPhysicsRadius.Medium),
                )
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            PhysicsRichText(message.content, color = if (isUser) Color.White else OpenPhysicsColors.Ink)
        }
    }
}
