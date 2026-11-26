package cn.openphysics.androidapp.ui.screens

import android.net.Uri
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.VideoView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import cn.openphysics.androidapp.data.api.ApiClient
import cn.openphysics.androidapp.domain.QuestionLessonVideo
import cn.openphysics.androidapp.domain.TeacherPaperQuestionVideo
import cn.openphysics.androidapp.ui.components.SecondaryActionButton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

@Composable
internal fun QuestionLessonVideoAction(
    studentToken: String,
    questionId: String,
    answerId: Int?,
    lessonVideo: QuestionLessonVideo?,
) {
    if (lessonVideo == null || answerId == null) return
    var open by remember(questionId, answerId) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (lessonVideo.available) {
            SecondaryActionButton(text = "视频讲解", onClick = { open = true })
        } else {
            Text(lessonVideo.lockedReason.ifBlank { "整套批改完成后可看视频讲解" })
        }
    }
    if (open) QuestionLessonVideoPlayback(studentToken, questionId, answerId) { open = false }
}

@Composable
internal fun QuestionLessonVideoPlayback(
    studentToken: String,
    questionId: String,
    answerId: Int,
    onClose: () -> Unit,
) {
    var video by remember(questionId, answerId) { mutableStateOf<TeacherPaperQuestionVideo?>(null) }
    var error by remember(questionId, answerId) { mutableStateOf("") }
    var retry by remember(questionId, answerId) { mutableIntStateOf(0) }
    var savedPosition by remember(questionId, answerId) { mutableIntStateOf(0) }
    val api = remember { ApiClient() }
    LaunchedEffect(questionId, answerId, retry) {
        error = ""
        try {
            video = withContext(Dispatchers.IO) { api.getQuestionLessonVideo(studentToken, questionId, answerId) }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            error = failure.message ?: "讲解视频加载失败，请重试"
        }
    }
    video?.let { selected ->
        TeacherPaperVideoDialog(
            video = selected,
            initialPosition = savedPosition,
            onSavePosition = { savedPosition = it },
            onReload = { position ->
                savedPosition = position
                error = ""
                video = null
                retry++
            },
            onClose = onClose,
        )
    } ?: Dialog(onDismissRequest = onClose) {
        Column(Modifier.background(Color.White).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (error.isBlank()) {
                CircularProgressIndicator()
                Text("正在加载本题讲解…")
            } else {
                Text(error)
                TextButton(onClick = { retry++ }) { Text("重试") }
            }
            TextButton(onClick = onClose) { Text("返回题目") }
        }
    }
}

@Composable
internal fun TeacherPaperVideoDialog(
    video: TeacherPaperQuestionVideo,
    initialPosition: Int = 0,
    onSavePosition: (Int) -> Unit = {},
    onReload: (Int) -> Unit,
    onClose: () -> Unit,
) {
    var player by remember(video.videoUrl) { mutableStateOf<VideoView?>(null) }
    var loading by remember(video.videoUrl) { mutableStateOf(true) }
    var failed by remember(video.videoUrl) { mutableStateOf(false) }
    var playing by remember(video.videoUrl) { mutableStateOf(false) }
    var duration by remember(video.videoUrl) { mutableIntStateOf(0) }
    var position by remember(video.videoUrl) { mutableIntStateOf(initialPosition) }
    var seeking by remember(video.videoUrl) { mutableStateOf(false) }
    LaunchedEffect(player, loading, failed) {
        val view = player ?: return@LaunchedEffect
        if (loading || failed) return@LaunchedEffect
        while (true) {
            if (!seeking) position = view.currentPosition.coerceIn(0, duration)
            playing = view.isPlaying
            delay(500)
        }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, player) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) {
                player?.pause()
                playing = false
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val phone = LocalPhonePresentation.current
    val togglePlayback: () -> Unit = {
        player?.let { view ->
            if (view.isPlaying) view.pause() else view.start()
            playing = view.isPlaying
        }
    }
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        val safeInsets = WindowInsets.safeDrawing.asPaddingValues()
        val layoutDirection = LocalLayoutDirection.current
        Column(modifier = Modifier.fillMaxSize().background(Color.Black).padding(
            start = safeInsets.calculateStartPadding(layoutDirection) + 12.dp,
            top = safeInsets.calculateTopPadding() + 12.dp,
            end = safeInsets.calculateEndPadding(layoutDirection) + 12.dp,
            // Edge-to-edge phone dialogs may report zero bottom inset despite the gesture area.
            bottom = maxOf(safeInsets.calculateBottomPadding(), if (phone) 64.dp else 24.dp) + 12.dp,
        )) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(video.title, color = Color.White, modifier = Modifier.weight(1f),
                    maxLines = if (phone) 2 else Int.MAX_VALUE,
                    overflow = if (phone) TextOverflow.Ellipsis else TextOverflow.Clip)
                TextButton(onClick = onClose,
                    modifier = if (phone) Modifier.semantics { contentDescription = "关闭视频，返回题目" } else Modifier) {
                    Text(if (phone) "关闭" else "关闭视频，返回题目", color = Color.White)
                }
            }
            Box(modifier = Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                key(video.videoUrl) {
                    AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { context ->
                            FrameLayout(context).apply {
                                val view = VideoView(context)
                                view.keepScreenOn = true
                                addView(view, FrameLayout.LayoutParams(
                                    FrameLayout.LayoutParams.MATCH_PARENT,
                                    FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER,
                                ))
                                player = view
                                view.setOnPreparedListener {
                                    duration = view.duration.coerceAtLeast(0)
                                    position = initialPosition.coerceIn(0, duration)
                                    loading = false
                                    view.seekTo(position)
                                    view.start()
                                    playing = true
                                }
                                view.setOnCompletionListener {
                                    playing = false
                                    position = duration
                                }
                                view.setOnErrorListener { _, _, _ ->
                                    loading = false
                                    failed = true
                                    playing = false
                                    true
                                }
                                view.setVideoURI(Uri.parse(video.videoUrl))
                            }
                        },
                        onRelease = { container ->
                            val view = container.getChildAt(0) as VideoView
                            onSavePosition(position.coerceAtLeast(0))
                            view.stopPlayback()
                            container.removeAllViews()
                        },
                    )
                }
                if (loading) CircularProgressIndicator(color = Color.White)
                if (failed) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("视频暂时无法播放，请检查网络后重试。", color = Color.White)
                    TextButton(onClick = { onReload(position.coerceAtLeast(0)) }) { Text("重新加载") }
                }
            }
            if (phone) {
                Column(Modifier.fillMaxWidth()) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        TextButton(enabled = !loading && !failed, onClick = togglePlayback) {
                            Text(if (playing) "暂停" else "播放", color = Color.White)
                        }
                        Spacer(Modifier.weight(1f))
                        Text("${videoTime(position)} / ${videoTime(duration)}", color = Color.White)
                    }
                    Slider(
                        value = position.toFloat().coerceIn(0f, duration.coerceAtLeast(1).toFloat()),
                        onValueChange = { seeking = true; position = it.toInt() },
                        onValueChangeFinished = { player?.seekTo(position); seeking = false },
                        valueRange = 0f..duration.coerceAtLeast(1).toFloat(),
                        enabled = !loading && !failed && duration > 0,
                        modifier = Modifier.fillMaxWidth().semantics { contentDescription = "视频进度" },
                    )
                }
            } else {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    TextButton(enabled = !loading && !failed, onClick = togglePlayback) {
                        Text(if (playing) "暂停" else "播放", color = Color.White)
                    }
                    Text(videoTime(position), color = Color.White)
                    Slider(
                        value = position.toFloat().coerceIn(0f, duration.coerceAtLeast(1).toFloat()),
                        onValueChange = { seeking = true; position = it.toInt() },
                        onValueChangeFinished = { player?.seekTo(position); seeking = false },
                        valueRange = 0f..duration.coerceAtLeast(1).toFloat(),
                        enabled = !loading && !failed && duration > 0,
                        modifier = Modifier.weight(1f).semantics { contentDescription = "视频进度" },
                    )
                    Text(videoTime(duration), color = Color.White)
                }
            }
        }
    }
}

private fun videoTime(milliseconds: Int): String {
    val seconds = milliseconds.coerceAtLeast(0) / 1000
    return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
}
