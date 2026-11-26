package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.domain.CardSection
import cn.openphysics.androidapp.domain.CardSectionContent
import cn.openphysics.androidapp.domain.FormulaVariable
import cn.openphysics.androidapp.domain.KnowledgeCard
import cn.openphysics.androidapp.domain.LearnBundle
import cn.openphysics.androidapp.domain.LearnExample
import cn.openphysics.androidapp.domain.LearnProgressItem
import cn.openphysics.androidapp.domain.SimulationContent
import cn.openphysics.androidapp.domain.SlideDeck
import cn.openphysics.androidapp.domain.SlideItem
import cn.openphysics.androidapp.domain.VideoItem
import org.json.JSONArray
import org.json.JSONObject

object LearnBundleParsers {
    fun parse(json: JSONObject, defaultKpId: String, videos: List<VideoItem>): LearnBundle {
        val kpId = json.optText("kp_id", defaultKpId)
        val kpName = json.optText("kp_name", defaultKpId)
        return LearnBundle(
            kpId = kpId,
            kpName = kpName,
            card = parseCard(json.optJSONObject("card"), kpName),
            videos = videos,
            slides = parseSlides(json.optJSONObject("slides")),
            simulations = json.optJSONArray("simulations").mapObjects { item ->
                SimulationContent(
                    id = item.optText("content_id", item.optText("id")),
                    title = item.optText("title", item.optText("name", "互动模拟")),
                    type = item.optText("type", "interactive"),
                    html = item.optText("html"),
                    consumed = item.optBoolean("consumed", false),
                )
            }.filter { it.id.isNotBlank() || it.title.isNotBlank() },
            examples = json.optJSONArray("examples").mapObjects { item ->
                LearnExample(
                    title = item.optText("title", item.optText("name", "示例")),
                    body = LearnContentText.extract(item.optJSONObject("body")),
                    consumed = item.optBoolean("consumed", false),
                )
            }.filter { it.title.isNotBlank() },
            progress = parseProgress(json.optJSONObject("progress")),
        )
    }

    private fun parseCard(json: JSONObject?, kpName: String): KnowledgeCard? {
        if (json == null) return null
        return KnowledgeCard(
            contentId = json.optText("content_id"),
            title = json.optText("title", kpName.ifBlank { "知识卡片" }),
            consumed = json.optBoolean("consumed", false),
            sections = json.optJSONArray("sections").mapObjects { section ->
                val content = section.optJSONObject("content")
                val formula = content?.optText("formula").orEmpty()
                CardSection(
                    title = section.optText("title", "学习要点"),
                    type = section.optText("type", "concept"),
                    text = LearnContentText.extract(content),
                    rendered = section.optJSONObject("rendered").toRenderedRichContentOrNull()
                        ?: section.optJSONObject("text_rendered").toRenderedRichContentOrNull()
                        ?: content?.optJSONObject("rendered").toRenderedRichContentOrNull()
                        ?: content?.optJSONObject("text_rendered").toRenderedRichContentOrNull(),
                    content = CardSectionContent(
                        html = content?.optText("html").orEmpty(),
                        latex = content?.optText("latex", formula).orEmpty(),
                        variableTable = content?.optJSONArray("variable_table").mapObjects { variable ->
                            FormulaVariable(
                                symbol = variable.optText("symbol"),
                                name = variable.optText("name"),
                                unit = variable.optText("unit"),
                            )
                        },
                        svg = content?.optText("svg").orEmpty(),
                        stem = content?.optText("stem").orEmpty(),
                        solution = content?.optText("solution").orEmpty(),
                        keyTakeaway = content?.optText("key_takeaway").orEmpty(),
                        items = content?.optJSONArray("items").mapValues(),
                    ),
                )
            },
        )
    }

    private fun parseSlides(json: JSONObject?): SlideDeck? {
        if (json == null) return null
        val items = (json.optJSONArray("items") ?: json.optJSONArray("slides")).mapObjects { item ->
            val blocks = item.optJSONArray("blocks")
            val blockBodies = blocks.mapObjects { block ->
                LearnContentText.extract(block.optJSONObject("content"))
            }.filter { it.isNotBlank() }
            val blockRendered = blocks.mapObjects { block ->
                block.optJSONObject("content_rendered").toRenderedRichContentOrNull()
            }
            val rendered = item.optJSONObject("rendered").toRenderedRichContentOrNull()
                ?: item.optJSONObject("body_rendered").toRenderedRichContentOrNull()
                ?: item.optJSONObject("text_rendered").toRenderedRichContentOrNull()
                ?: blockRendered.singleOrNull()
            SlideItem(
                title = item.optText("title", "微课片段"),
                body = item.optText("body", item.optText("text")).ifBlank {
                    blockBodies.joinToString("\n\n")
                },
                rendered = rendered,
            )
        }
        return SlideDeck(
            title = json.optText("title", "微课"),
            items = items,
        )
    }

    private fun parseProgress(json: JSONObject?): Map<String, LearnProgressItem> {
        if (json == null) return emptyMap()
        return json.keys().asSequence().mapNotNull { key ->
            val item = json.optJSONObject(key) ?: return@mapNotNull null
            key to LearnProgressItem(
                consumed = item.optInt("consumed", 0),
                total = item.optInt("total", 0),
            )
        }.toMap()
    }
}

private fun JSONObject.optText(key: String, fallback: String = ""): String {
    if (!has(key) || isNull(key)) return fallback
    return optString(key, fallback).trim()
}

private inline fun <T> JSONArray?.mapObjects(crossinline transform: (JSONObject) -> T): List<T> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index -> optJSONObject(index)?.let(transform) }
}

private fun JSONArray?.mapValues(): List<String> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index ->
        opt(index)?.toString()?.takeIf { it.isNotBlank() }
    }
}
