package cn.openphysics.androidapp.data.api

internal data class ApiTimeouts(
    val connectMs: Int,
    val readMs: Int,
)

private const val CONNECT_TIMEOUT_MS = 10_000
private const val DEFAULT_READ_TIMEOUT_MS = 20_000
private const val RICH_CONTENT_LIST_READ_TIMEOUT_MS = 60_000
private const val AI_GRADING_READ_TIMEOUT_MS = 120_000
private const val PAPER_BATCH_READ_TIMEOUT_MS = 330_000

internal fun apiTimeoutsFor(path: String): ApiTimeouts {
    val normalized = path.substringBefore('?')
    val readMs = when (normalized) {
        "/review",
        "/history/answers" -> RICH_CONTENT_LIST_READ_TIMEOUT_MS
        "/practice/submit-paper-batch" -> PAPER_BATCH_READ_TIMEOUT_MS
        "/practice/submit-photo",
        "/practice/process-evidence" -> AI_GRADING_READ_TIMEOUT_MS
        else -> DEFAULT_READ_TIMEOUT_MS
    }
    return ApiTimeouts(
        connectMs = CONNECT_TIMEOUT_MS,
        readMs = readMs,
    )
}
