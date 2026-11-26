package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.runtime.Composable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

private val inlineDollarFormula = Regex("""(?<!\\)\$[^$\n]+(?<!\\)\$""")
private val existingMathDelimiter = Regex("""(\$|\\\(|\\\[)""")
private val nakedMathFragment = Regex("""[A-Za-zα-ωΑ-Ω0-9_{}^\\+\-*/=<>≈().,\s]+""")
private val formulaHint = Regex("""(\\[A-Za-z]+|[=<>≈]|[_^]\{?|m/s|[A-Za-zα-ωΑ-Ω]\s*[+\-*/=<>≈])""")
private val letterOrDigit = Regex("""[A-Za-zα-ωΑ-Ω0-9]""")

fun hasFormulaText(text: String): Boolean {
    val normalized = normalizeMathText(text)
    return inlineDollarFormula.containsMatchIn(normalized) ||
        normalized.contains("\\(") ||
        normalized.contains("\\[") ||
        normalized.contains("\\frac") ||
        normalized.contains("\\text") ||
        normalized.contains("\\ll") ||
        normalized.contains("_") && normalized.contains("{") ||
        normalized.contains("^") && normalized.contains("{")
}

@Composable
fun RichText(
    text: String,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    onClick: (() -> Unit)? = null,
    color: Color = Color(0xFF697386),
) {
    if (text.isBlank()) return
    val textModifier = if (onClick != null) modifier.clickable(onClick = onClick) else modifier
    Text(
        text = toReadablePhysicsText(text),
        modifier = textModifier,
        style = MaterialTheme.typography.bodyMedium,
        color = color,
    )
}

fun normalizePhysicsRichTextInput(text: String): String {
    return normalizeMathText(normalizeSuperscripts(cleanText(text)))
}

@Composable
fun PhysicsRichText(
    text: String,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    onClick: (() -> Unit)? = null,
    color: Color = Color(0xFF697386),
) {
    val normalized = normalizePhysicsRichTextInput(text)
    if (normalized.isBlank()) return
    RichText(text = normalized, modifier = modifier, compact = compact, onClick = onClick, color = color)
}

fun toReadablePhysicsText(text: String): String {
    return unwrapLatexDelimiters(normalizeMathText(cleanText(text)))
}

private fun repairLatexText(text: String): String {
    return text
        .replace("\u000crac", "\\frac")
        .replace("\u000c rac", "\\frac")
        .replace("\u0008eta", "\\beta")
        .replace("\u0008ar", "\\bar")
        .replace("\u0008oldsymbol", "\\boldsymbol")
        .replace("\theta", "\\theta")
        .replace("\times", "\\times")
        .replace("\text", "\\text")
        .replace("\tan", "\\tan")
        .replace("\right", "\\right")
        .replace("\rho", "\\rho")
        .replace("\neq", "\\neq")
        .replace("\nabla", "\\nabla")
}

fun normalizeMathText(text: String): String {
    if (text.isBlank()) return text
    var normalized = autoDelimitNakedMath(repairLatexText(text))
    if (!normalized.contains("$")) return normalized
    var previous: String
    do {
        previous = normalized
        normalized = normalized
            .replace(Regex("""\$([^$]*\d)\$\.(\d+)""")) { match ->
                "$${match.groupValues[1]}.${match.groupValues[2]}$"
            }
            .replace(Regex("""(^|[^$])(\d+)\.\$([0-9][^$]*)\$""")) { match ->
                "${match.groupValues[1]}$${match.groupValues[2]}.${match.groupValues[3]}$"
            }
            .replace(Regex("""_\{([^{}]+)\}_\{\.\}_\{([^{}]+)\}"""), "_{$1.$2}")
            .replace(Regex("""\$([^$]*=[^$]*\d(?:\.\d+)?)\$([A-Za-zα-ωΑ-ΩΔ][A-Za-z0-9_{}]*)""")) { match ->
                "$${match.groupValues[1]}${match.groupValues[2]}$"
            }
            .replace(Regex("""(^|[^A-Za-z0-9_$])([A-Za-zα-ωΑ-ΩΔ][A-Za-z0-9_{}]*)=\$([^$]+)\$""")) { match ->
                "${match.groupValues[1]}$${match.groupValues[2]}=${match.groupValues[3]}$"
            }
            .replace(Regex("""\$([^$\n]+)\$\((\d+(?:\.\d+)?)\$([^$\n]+)\$\)(\^\{[^}]+\})?""")) { match ->
                "$${match.groupValues[1]}(${match.groupValues[2]}${match.groupValues[3]})${match.groupValues[4]}$"
            }
            .replace(Regex("""\$\((\d+(?:\.\d+)?)\$([^$\n]+)\$\)(\^\{[^}]+\})?""")) { match ->
                "$(${match.groupValues[1]}${match.groupValues[2]})${match.groupValues[3]}$"
            }
            .replace(Regex("""\((\d+(?:\.\d+)?)\$([^$\n]+)\$([\-+\d]+)\)""")) { match ->
                "$(${match.groupValues[1]}${match.groupValues[2]}${match.groupValues[3]})$"
            }
            .replace(Regex("""\$([^$]+)\$\(([^$]*)\$([^$]+)\$""")) { match ->
                "$${match.groupValues[1]}(${match.groupValues[2]}${match.groupValues[3]}$"
            }
            .replace(Regex("""\$([^$\n]+)\$\$([^$\n]+)\$""")) { match ->
                "$${match.groupValues[1]}${match.groupValues[2]}$"
            }
            .replace(Regex("""(^|[^第${'$'}_^])(\d+(?:\.\d+)?)${'$'}([^${'$'}\n]+)${'$'}""")) { match ->
                "${match.groupValues[1]}$${match.groupValues[2]}${match.groupValues[3]}$"
            }
    } while (previous != normalized)
    return normalized
}

private fun autoDelimitNakedMath(text: String): String {
    if (text.isBlank() || existingMathDelimiter.containsMatchIn(text)) return text
    val normalized = normalizeSuperscripts(text)
    val trimmed = normalized.trim()
    val hasChinese = trimmed.contains(Regex("""[\u4e00-\u9fff]"""))
    if (looksLikeFormulaFragment(trimmed) && (!hasChinese || trimmed.contains("\\text{"))) {
        val leading = normalized.takeWhile { it.isWhitespace() }
        val trailing = normalized.takeLastWhile { it.isWhitespace() }
        return "$leading$$trimmed$$trailing"
    }
    return nakedMathFragment.replace(normalized) { match ->
        val fragment = match.value
        if (!looksLikeFormulaFragment(fragment)) {
            fragment
        } else {
            val leading = fragment.takeWhile { it.isWhitespace() }
            val trailing = fragment.takeLastWhile { it.isWhitespace() }
            "$leading$${fragment.trim()}$$trailing"
        }
    }
}

private fun normalizeSuperscripts(text: String): String {
    return text
        .replace("²", "^{2}")
        .replace("³", "^{3}")
        .replace(Regex("""\^([A-Za-z0-9])"""), "^{$1}")
}

private fun looksLikeFormulaFragment(text: String): Boolean {
    val trimmed = text.trim()
    if (trimmed.isBlank() || !letterOrDigit.containsMatchIn(trimmed) || !formulaHint.containsMatchIn(trimmed)) {
        return false
    }
    return Regex("""[=<>≈]|\\[A-Za-z]+|[_^]\{?""").containsMatchIn(trimmed)
}

private fun unwrapLatexDelimiters(text: String): String {
    var output = text
        .replace("\\(", "$")
        .replace("\\)", "$")
        .replace("\\[", "$")
        .replace("\\]", "$")
    output = inlineDollarFormula.replace(output) { match ->
        normalizeLatexInline(match.value.removePrefix("$").removeSuffix("$"))
    }
    return normalizeLatexInline(output)
}

private fun normalizeLatexInline(formula: String): String {
    var output = formula
        .replace("\\sim", "～")
        .replace("\\times", "×")
        .replace("\\cdot", "·")
        .replace("\\Delta", "Δ")
        .replace("\\theta", "θ")
        .replace("\\omega", "ω")
        .replace("\\pi", "π")
        .replace("\\ll", "≪")
    output = Regex("""\\text\{([^{}]+)\}""").replace(output) { match ->
        match.groupValues[1]
    }
    output = Regex("""\\frac\{([^{}]+)\}\{([^{}]+)\}""").replace(output) { match ->
        "(${match.groupValues[1]})/(${match.groupValues[2]})"
    }
    output = Regex("""_\{([^{}]+)\}""").replace(output) { match -> toSubscriptOrReadableIndex(match.groupValues[1]) }
    output = Regex("""_([A-Za-z0-9+\-=])""").replace(output) { match -> toSubscript(match.groupValues[1]) }
    output = Regex("""\^\{([^{}]+)\}""").replace(output) { match -> toSuperscript(match.groupValues[1]) }
    output = Regex("""\^([A-Za-z0-9+\-=])""").replace(output) { match -> toSuperscript(match.groupValues[1]) }
    return output
        .replace("\\", "")
        .replace(Regex("""\s*～\s*"""), "～")
}

private fun toSubscript(text: String): String = text.map { subscriptMap[it] ?: it }.joinToString("")

private fun toSubscriptOrReadableIndex(text: String): String {
    val converted = toSubscript(text)
    return if (converted == text && text.any { it.isLetter() }) {
        "_($text)"
    } else {
        converted
    }
}

private fun toSuperscript(text: String): String = text.map { superscriptMap[it] ?: it }.joinToString("")

private val subscriptMap = mapOf(
    '0' to '₀',
    '1' to '₁',
    '2' to '₂',
    '3' to '₃',
    '4' to '₄',
    '5' to '₅',
    '6' to '₆',
    '7' to '₇',
    '8' to '₈',
    '9' to '₉',
    '+' to '₊',
    '-' to '₋',
    '=' to '₌',
    'n' to 'ₙ',
    'm' to 'ₘ',
    't' to 'ₜ',
    'i' to 'ᵢ',
    'j' to 'ⱼ',
    'a' to 'ₐ',
    'x' to 'ₓ',
)

private val superscriptMap = mapOf(
    '0' to '⁰',
    '1' to '¹',
    '2' to '²',
    '3' to '³',
    '4' to '⁴',
    '5' to '⁵',
    '6' to '⁶',
    '7' to '⁷',
    '8' to '⁸',
    '9' to '⁹',
    '+' to '⁺',
    '-' to '⁻',
    '=' to '⁼',
    'n' to 'ⁿ',
    'i' to 'ⁱ',
)
