package cn.openphysics.androidapp

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.os.Bundle
import android.os.SystemClock
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import cn.openphysics.androidapp.data.session.PrivateImageStore
import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.ui.PracticeAnswerDrafts
import cn.openphysics.androidapp.ui.PracticeHandwritingPreparation
import cn.openphysics.androidapp.ui.PracticeSetSubmissionState
import cn.openphysics.androidapp.ui.draft.DraftBackgroundImage
import cn.openphysics.androidapp.ui.draft.DraftCanvasSnapshot
import cn.openphysics.androidapp.ui.draft.DraftCanvasView
import cn.openphysics.androidapp.ui.draft.DraftSnapshotExport
import cn.openphysics.androidapp.ui.draft.hasAnswerInk
import cn.openphysics.androidapp.ui.screens.PracticeGradingProgressDialog
import java.io.File

/** Device checks run only in the opt-in .devicetest app and never call business APIs. */
class DiagnosticSmokeInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }

    override fun onStart() {
        val result = Bundle()
        try {
            check(targetContext.packageName.endsWith(".devicetest")) { "Use OPENPHYSICS_DEVICE_SMOKE=true" }
            val activity = startActivitySync(Intent().setClassName(targetContext.packageName, MainActivity::class.java.name)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as ComponentActivity
            val snapshots = linkedMapOf<String, DraftCanvasSnapshot>()
            listOf("one", "two").forEachIndexed { index, id ->
                lateinit var view: DraftCanvasView
                runOnMainSync {
                    // Ink and motion prediction need a displayed Activity and render frames.
                    view = DraftCanvasView(activity)
                    view.setFingerWritingEnabled(true)
                    view.setOnSnapshotCommitted { snapshots[id] = it }
                    activity.setContentView(view)
                }
                waitForIdleSync()
                SystemClock.sleep(150)
                val start = SystemClock.uptimeMillis()
                listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE, MotionEvent.ACTION_UP).forEachIndexed { n, action ->
                    runOnMainSync {
                        val properties = MotionEvent.PointerProperties().apply { this.id = 0; toolType = MotionEvent.TOOL_TYPE_STYLUS }
                        val coordinates = MotionEvent.PointerCoords().apply {
                            x = 80f + n * 65f + index * 120f; y = 120f + n * 100f; pressure = 0.5f; size = 1f
                        }
                        val event = MotionEvent.obtain(start, SystemClock.uptimeMillis(), action, 1,
                            arrayOf(properties), arrayOf(coordinates), 0, 0, 1f, 1f, 0, 0,
                            android.view.InputDevice.SOURCE_STYLUS, 0)
                        view.dispatchTouchEvent(event)
                        event.recycle()
                    }
                    SystemClock.sleep(25)
                }
                val deadline = SystemClock.uptimeMillis() + 5_000
                var committed = false
                while (!committed && SystemClock.uptimeMillis() < deadline) {
                    runOnMainSync { committed = snapshots[id]?.hasAnswerInk() == true }
                    if (!committed) SystemClock.sleep(25)
                }
                check(committed) { "Canvas did not commit $id after Ink handoff" }
            }
            val questions = listOf(
                PracticeQuestion("one", "实验题一", "experiment", emptyList(), emptyList()),
                PracticeQuestion("two", "实验题二", "experiment", emptyList(), emptyList()),
                PracticeQuestion("choice", "当前选择题", "single_choice", listOf(PracticeOption("A", "A")), emptyList()),
            )
            val drafts = PracticeAnswerDrafts()
            drafts.set("choice", "A")
            check(drafts.answeredCount(questions.map { it.id }, snapshots.keys) == 3)
            val store = PrivateImageStore(targetContext)
            val ready = PracticeHandwritingPreparation.prepare(questions.map { drafts.toSubmission(it) }, snapshots) { q, snapshot ->
                val bytes = DraftSnapshotExport.jpeg(snapshot)
                val bitmap = checkNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size))
                try {
                    val pixels = IntArray(bitmap.width * bitmap.height)
                    bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
                    check(pixels.count { (it and 0xff) < 100 } > 20) { "Exported image has no readable ink" }
                } finally { bitmap.recycle() }
                store.save("local-smoke", bytes, "image/jpeg", "${q.id}.jpg")
            }
            check(ready.take(2).all { it.handwriting != null && it.answer == "[手写作答]" })
            check(ready.take(2).map { it.handwriting!!.fileName } == listOf("one.jpg", "two.jpg"))
            check(ready.last().answer == "A" && ready.last().handwriting == null)
            check(runCatching { DraftSnapshotExport.jpeg(DraftCanvasSnapshot()) }.isFailure)
            check(runCatching { DraftSnapshotExport.jpeg(snapshots.getValue("one").copy(
                backgroundImage = DraftBackgroundImage("missing", null, 100, 100, 0f, 0f, 1f),
            )) }.isFailure)
            store.clearStudent("local-smoke")

            lateinit var rapidCanvas: DraftCanvasView
            runOnMainSync {
                rapidCanvas = DraftCanvasView(activity)
                activity.setContentView(rapidCanvas)
            }
            waitForIdleSync()
            SystemClock.sleep(150)
            // All strokes end before the next render frame can hand them off to the canvas.
            // Starting another stroke must preserve every finished stroke waiting for that frame.
            val rapidStrokeCount = 20
            runOnMainSync {
                repeat(rapidStrokeCount) { stroke ->
                    val downTime = SystemClock.uptimeMillis()
                    listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE, MotionEvent.ACTION_UP).forEachIndexed { point, action ->
                        val properties = MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_STYLUS }
                        val coordinates = MotionEvent.PointerCoords().apply {
                            x = 40f + stroke * 12f + point * 2f; y = 100f + point * 35f; pressure = 0.5f; size = 1f
                        }
                        val event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, 1,
                            arrayOf(properties), arrayOf(coordinates), 0, 0, 1f, 1f, 0, 0,
                            android.view.InputDevice.SOURCE_STYLUS, 0)
                        rapidCanvas.dispatchTouchEvent(event)
                        event.recycle()
                    }
                }
            }
            val rapidDeadline = SystemClock.uptimeMillis() + 5_000
            var retainedStrokes = 0
            while (retainedStrokes != rapidStrokeCount && SystemClock.uptimeMillis() < rapidDeadline) {
                runOnMainSync { retainedStrokes = rapidCanvas.snapshot().strokes.size }
                if (retainedStrokes != rapidStrokeCount) SystemClock.sleep(25)
            }
            check(retainedStrokes == rapidStrokeCount) { "Rapid writing lost strokes: $retainedStrokes/$rapidStrokeCount" }

            lateinit var retryCanvas: DraftCanvasSnapshot
            runOnMainSync { retryCanvas = rapidCanvas.snapshot() }
            verifyTeacherPaperRetry(retryCanvas)

            runOnMainSync {
                activity.setContent { MaterialTheme {
                    PracticeGradingProgressDialog(PracticeSetSubmissionState(submitting = true, completed = 6, total = 10), {})
                } }
            }
            waitForIdleSync()
            SystemClock.sleep(800)
            uiAutomation.takeScreenshot()?.let { screenshot ->
                try {
                    File(targetContext.getExternalFilesDir(null), "grading-progress-smoke.png").outputStream().use {
                        check(screenshot.compress(Bitmap.CompressFormat.PNG, 100, it))
                    }
                } finally { screenshot.recycle() }
            }
            result.putString("result", "PASS: real pen events, 20 rapid strokes retained, partial-paper retry accepts handwriting/photo and preserves three receipts, two offscreen answer exports, question IDs, choice preservation, blank/missing-diagram failures, progress dialog")
            finish(Activity.RESULT_OK, result)
        } catch (error: Throwable) {
            result.putString("error", error.stackTraceToString())
            finish(Activity.RESULT_CANCELED, result)
        }
    }
}
