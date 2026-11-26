package cn.openphysics.androidapp.ui

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.domain.RenderedRichContent

private val shortAnswerQuestionTypes = setOf(
    "fill_in_blank",
    "knowledge_fill_in_blank",
)

private val longAnswerQuestionTypes = setOf(
    "problem_solving",
    "comprehensive",
    "experiment",
    "graph_construction",
)

private val imagePlaceholderRegex by lazy {
    Regex("""\{\{IMG:(\d+)\}\}""")
}
private val scriptElementRegex = Regex("""(?is)<script\b[^>]*>.*?</script\s*>""")
private val imageElementRegex = Regex("""(?is)<img\b[^>]*>""")
private val imageIndexAttributeRegex =
    Regex("""(?i)\bdata-openphysics-image-index\s*=\s*["'](\d+)["']""")
private val imageSourceAttributeRegex = Regex("""(?i)\bsrc\s*=\s*(["'])(.*?)\1""")
private val activePrintWebViews = mutableSetOf<WebView>()
private const val PrintPageLoadFallbackMs = 5_000L
private const val PrintWebViewRetentionMs = 10 * 60 * 1_000L

private data class PrintableQuestion(
    val id: String,
    val stem: String,
    val questionType: String,
    val options: List<PracticeOption>,
    val images: List<QuestionImage>,
    val stemRendered: RenderedRichContent?,
)

fun buildPracticePrintHtml(
    title: String,
    questions: List<PracticeQuestion>,
    subtitle: String = "",
): String = buildPrintableQuestionSetHtml(
    title = title,
    subtitle = subtitle,
    questions = questions.map { question ->
        PrintableQuestion(
            id = question.id,
            stem = question.stem,
            questionType = question.questionType,
            options = question.options,
            images = question.images,
            stemRendered = question.stemRendered,
        )
    },
)

private fun buildPrintableQuestionSetHtml(
    title: String,
    subtitle: String,
    questions: List<PrintableQuestion>,
): String {
    val questionItems = questions.mapIndexed { index, question ->
        buildPrintableQuestionHtml(index, question)
    }.joinToString("\n")
    val subtitleHtml = subtitle.takeIf { it.isNotBlank() }
        ?.let { "<p>${escapeHtml(it)}</p>" }
        .orEmpty()
    return """
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link rel="stylesheet" href="katex/katex.min.css">
          <style>
            @page { size: A4; margin: 12mm; }
            * { box-sizing: border-box; box-shadow: none !important; text-shadow: none !important; }
            html, body { margin: 0; padding: 0; background: #fff; color: #111827; }
            body {
              font-family: sans-serif;
              font-size: 12px;
              line-height: 1.55;
              overflow-wrap: break-word;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .print-sheet { width: 100%; }
            .print-sheet-header {
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 24px;
              border-bottom: 2px solid #111827;
              padding-bottom: 10px;
              margin-bottom: 16px;
            }
            .print-sheet-header h1 { font-size: 22px; line-height: 1.3; margin: 0 0 4px; }
            .print-sheet-header p { color: #4b5563; font-size: 12px; margin: 0; }
            .print-meta { display: flex; gap: 18px; white-space: nowrap; }
            .print-question { break-inside: avoid-page; page-break-inside: avoid; border-bottom: 2px solid #111827; padding: 0 0 14px; margin-bottom: 14px; }
            .print-question-title { break-after: avoid-page; page-break-after: avoid; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #111827; font-size: 13px; font-weight: 700; margin-bottom: 6px; }
            .print-question-code { color: #6b7280; font-family: monospace; font-size: 10px; font-weight: 700; }
            .print-question-stem { font-size: 12px; line-height: 1.75; margin-bottom: 8px; orphans: 3; widows: 3; }
            .print-question-stem p { margin: 0 0 6px; }
            .print-question-stem p:last-child { margin-bottom: 0; }
            .print-option, .print-question-images, .print-answer-box { break-inside: avoid; page-break-inside: avoid; }
            .print-question-images { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4mm 6mm; margin: 5mm 0 3mm; }
            .question-image, .openphysics-rich-image { display: block; width: auto; max-width: 58mm; max-height: 38mm; object-fit: contain; margin: 3mm auto; }
            .print-question-images-multiple .question-image { max-width: 42mm; max-height: 30mm; }
            .print-inline-image { display: block; width: auto; max-width: 58mm; max-height: 38mm; object-fit: contain; margin: 3mm auto; }
            .print-options { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin: 8px 0 10px; }
            .print-option { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 1.6; }
            .print-option-label { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 20px; width: 20px; height: 20px; border: 1px solid #6b7280; font-size: 11px; font-weight: 700; }
            .print-option-label-single { border-radius: 50%; }
            .print-option-label-multiple { border-radius: 4px; }
            .print-option-content { min-width: 0; }
            .print-option-content .openphysics-rich-image {
              max-width: 34mm;
              max-height: 24mm;
              border: 1px solid #d1d5db;
            }
            .print-answer-box { position: relative; border: 1px dashed #9ca3af; border-radius: 4px; margin-top: 8px; }
            .print-answer-box-short { min-height: 34px; }
            .print-answer-box-large { min-height: 170px; background-image: repeating-linear-gradient(to bottom, transparent, transparent 27px, #e5e7eb 28px); }
            .print-answer-box span { position: absolute; top: -9px; left: 10px; background: #fff; color: #6b7280; padding: 0 4px; font-size: 10px; }
            .print-question-dense .print-question-stem { font-size: 11px; line-height: 1.58; }
            .print-question-dense .question-image,
            .print-question-dense .openphysics-rich-image,
            .print-question-dense .print-inline-image { max-height: 28mm; }
            .print-question-dense .print-options { gap: 4px 12px; margin: 6px 0 8px; }
            .print-question-dense .print-answer-box-large { min-height: 112px; }
            .katex-display { max-width: 100%; margin: 0.35em 0; overflow: visible; }
            .openphysics-table-wrap, .markdown-table-wrap { display: block; width: 100%; margin: 8px 0; }
            .openphysics-rich-table, .markdown-table { width: auto; max-width: 100%; border-collapse: collapse; font-size: 11px; }
            .openphysics-rich-table th, .openphysics-rich-table td,
            .markdown-table th, .markdown-table td { border: 1px solid #9ca3af; padding: 4px 8px; text-align: center; }
            .openphysics-rich-table tr, .markdown-table tr { break-inside: avoid; page-break-inside: avoid; }
          </style>
        </head>
        <body>
          <main class="print-sheet">
            <header class="print-sheet-header">
              <div>
                <h1>${escapeHtml(title)}</h1>
                $subtitleHtml
              </div>
              <div class="print-meta">
                <span>姓名：__________</span>
                <span>日期：__________</span>
              </div>
            </header>
            <div class="print-questions">
              $questionItems
            </div>
          </main>
        </body>
        </html>
    """.trimIndent()
}

private fun buildPrintableQuestionHtml(index: Int, question: PrintableQuestion): String {
    val densityClass = if (questionUsesDensePrintLayout(question)) " print-question-dense" else ""
    val stemHtml = printableRichHtml(question.stem, question.stemRendered, question.images)
    val promptImages = question.images.filter { image ->
        image.imageType != "explanation" && image.imageType != "option"
    }
    val attachedImagesHtml = if (
        promptImages.isNotEmpty() &&
        !question.stem.contains(imagePlaceholderRegex) &&
        question.stemRendered?.hasImage != true
    ) {
        val imageDensityClass = if (promptImages.size > 1) {
            "print-question-images-multiple"
        } else {
            "print-question-images-single"
        }
        promptImages.joinToString(
            prefix = "<div class=\"print-question-images $imageDensityClass\">",
            postfix = "</div>",
            separator = "",
        ) { image -> printImageHtml(image, "question-image") }
    } else {
        ""
    }
    val optionsHtml = question.options.takeIf { it.isNotEmpty() }?.joinToString(
        prefix = "<div class=\"print-options\">",
        postfix = "</div>",
        separator = "",
    ) { option ->
        val markerClass = if (question.questionType == "multiple_choice") {
            "print-option-label-multiple"
        } else {
            "print-option-label-single"
        }
        val rendered = option.textRendered ?: option.rendered
        """
          <div class="print-option">
            <span class="print-option-label $markerClass">${escapeHtml(option.label)}</span>
            <span class="print-option-content">${printableRichHtml(option.text, rendered, question.images)}</span>
          </div>
        """.trimIndent()
    }.orEmpty()
    val answerHtml = buildAnswerAreaHtml(question)
    return """
        <article class="print-question$densityClass" data-question-id="${escapeHtml(question.id)}">
          <div class="print-question-title">
            <span>第 ${index + 1} 题</span>
            <span class="print-question-code">Q:${escapeHtml(question.id)}</span>
          </div>
          <div class="print-question-stem">$stemHtml</div>
          $attachedImagesHtml
          $optionsHtml
          $answerHtml
        </article>
    """.trimIndent()
}

private fun buildAnswerAreaHtml(question: PrintableQuestion): String {
    if (question.options.isNotEmpty()) return ""
    val answerClass = if (question.questionType in shortAnswerQuestionTypes) {
        "print-answer-box-short"
    } else {
        "print-answer-box-large"
    }
    return "<div class=\"print-answer-box $answerClass\"><span>作答区</span></div>"
}

private fun questionUsesDensePrintLayout(question: PrintableQuestion): Boolean {
    val textLength = question.stem.length + question.options.sumOf { option -> option.text.length }
    return textLength >= 360 ||
        question.images.size > 1 ||
        question.stemRendered?.hasMarkdownTable == true ||
        question.questionType in longAnswerQuestionTypes && textLength >= 260
}

private fun printableRichHtml(
    text: String,
    rendered: RenderedRichContent?,
    images: List<QuestionImage>,
): String {
    if (rendered?.html?.isNotBlank() == true && rendered.errors.isEmpty()) {
        return rewritePrintableImageSources(
            html = rendered.html.replace(scriptElementRegex, ""),
            images = images,
        )
    }
    if (!text.contains(imagePlaceholderRegex)) return escapeTextWithBreaks(text)
    return buildString {
        var cursor = 0
        imagePlaceholderRegex.findAll(text).forEach { match ->
            append(escapeTextWithBreaks(text.substring(cursor, match.range.first)))
            val imageIndex = match.groupValues[1].toIntOrNull()
            val image = imageIndex?.let(images::getOrNull)
            if (image != null) append(printImageHtml(image, "print-inline-image"))
            cursor = match.range.last + 1
        }
        append(escapeTextWithBreaks(text.substring(cursor)))
    }
}

private fun rewritePrintableImageSources(
    html: String,
    images: List<QuestionImage>,
): String {
    if (images.isEmpty() || !html.contains("<img", ignoreCase = true)) return html
    return imageElementRegex.replace(html) { element ->
        val tag = element.value
        val sourceMatch = imageSourceAttributeRegex.find(tag)
        val source = sourceMatch?.groupValues?.getOrNull(2).orEmpty()
        val imageIndex = imageIndexAttributeRegex.find(tag)
            ?.groupValues
            ?.getOrNull(1)
            ?.toIntOrNull()
        val image = imageIndex?.let(images::getOrNull)
            ?: images.firstOrNull { candidate ->
                source == candidate.imagePath || source == candidate.imageUrl
            }
            ?: return@replace tag
        val absoluteSource = image.imageUrl.ifBlank { image.imagePath }
        if (absoluteSource.isBlank() || absoluteSource == source) return@replace tag
        val escapedSource = escapeHtml(absoluteSource)
        if (sourceMatch != null) {
            tag.replaceRange(
                sourceMatch.range,
                "src=\"${escapedSource}\"",
            )
        } else {
            tag.replaceFirst(">", " src=\"${escapedSource}\">")
        }
    }
}

private fun printImageHtml(image: QuestionImage, cssClass: String): String {
    val source = image.imageUrl.ifBlank { image.imagePath }
    return "<img class=\"$cssClass\" src=\"${escapeHtml(source)}\" alt=\"${escapeHtml(image.description.ifBlank { "题目附图" })}\">"
}

fun startPracticePrintJob(
    context: Context,
    title: String,
    questions: List<PracticeQuestion>,
    subtitle: String = "",
) {
    runCatching {
        startHtmlPrintJob(
            context = context,
            jobName = title.ifBlank { "OpenPhysics练习" },
            html = buildPracticePrintHtml(title, questions, subtitle),
        )
    }.onFailure {
        showPrintFailure(context)
    }
}

private fun startHtmlPrintJob(context: Context, jobName: String, html: String) {
    val printManager = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
    val mainHandler = Handler(Looper.getMainLooper())
    val webView = WebView(context)
    lateinit var loadFallback: Runnable
    val cleanup = Runnable {
        mainHandler.removeCallbacks(loadFallback)
        activePrintWebViews.remove(webView)
        webView.stopLoading()
        webView.destroy()
    }
    var printStarted = false
    fun launchPrint(view: WebView) {
        if (printStarted) return
        printStarted = true
        mainHandler.removeCallbacks(loadFallback)
        runCatching {
            val adapter = view.createPrintDocumentAdapter(jobName)
            printManager.print(
                jobName,
                adapter,
                PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                    .build(),
            )
            mainHandler.postDelayed(cleanup, PrintWebViewRetentionMs)
        }.onFailure {
            cleanup.run()
            showPrintFailure(context)
        }
    }
    loadFallback = Runnable { launchPrint(webView) }
    activePrintWebViews += webView
    webView.settings.javaScriptEnabled = false
    webView.settings.allowFileAccess = true
    webView.webViewClient = object : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String?) {
            mainHandler.postDelayed({ launchPrint(view) }, 300L)
        }
    }
    webView.loadDataWithBaseURL("file:///android_asset/", html, "text/html", "UTF-8", null)
    mainHandler.postDelayed(loadFallback, PrintPageLoadFallbackMs)
}

private fun showPrintFailure(context: Context) {
    Toast.makeText(context, "无法打开打印服务，请稍后重试", Toast.LENGTH_SHORT).show()
}

private fun escapeTextWithBreaks(value: String): String = escapeHtml(value).replace("\n", "<br>")

private fun escapeHtml(value: String): String {
    return value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;")
}
