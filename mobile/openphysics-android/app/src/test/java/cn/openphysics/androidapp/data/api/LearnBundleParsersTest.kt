package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.domain.VideoItem
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class LearnBundleParsersTest {
    @Test
    fun `parses web aligned learn bundle resources`() {
        val bundle = LearnBundleParsers.parse(
            json = JSONObject()
                .put("kp_id", "kp_force")
                .put("kp_name", "力的合成")
                .put(
                    "card",
                    JSONObject()
                        .put("content_id", "card_force")
                        .put("title", "力的合成知识卡")
                        .put("consumed", true)
                        .put(
                            "sections",
                            JSONArray().put(
                                JSONObject()
                                    .put("title", "概念")
                                    .put("type", "concept")
                                    .put(
                                        "content",
                                        JSONObject()
                                            .put("text", "合力等效替代分力。")
                                            .put("latex", "F=ma")
                                            .put(
                                                "variable_table",
                                                JSONArray().put(
                                                    JSONObject()
                                                        .put("symbol", "F")
                                                        .put("name", "合力")
                                                        .put("unit", "N"),
                                                ),
                                            )
                                            .put("items", JSONArray().put("先确定研究对象")),
                                    )
                                    .put("text_rendered", renderedJson("<p>合力等效替代分力。</p>")),
                            ),
                        ),
                )
                .put(
                    "slides",
                    JSONObject()
                        .put("title", "微课")
                        .put(
                            "slides",
                            JSONArray().put(
                                JSONObject()
                                    .put("title", "平行四边形定则")
                                    .put(
                                        "blocks",
                                        JSONArray().put(
                                            JSONObject()
                                                .put("content", JSONObject().put("text", "作图理解合力。"))
                                                .put("content_rendered", renderedJson("<p>作图理解合力。</p>")),
                                        ),
                                    ),
                            ),
                        ),
                )
                .put(
                    "simulations",
                    JSONArray().put(
                        JSONObject()
                            .put("content_id", "sim_force")
                            .put("title", "合力拖拽实验")
                            .put("html", "<div>interactive</div>")
                            .put("consumed", true),
                    ),
                )
                .put(
                    "examples",
                    JSONArray().put(
                        JSONObject()
                            .put("title", "例题 1")
                            .put("body", JSONObject().put("stem", "求两个力的合力"))
                            .put("consumed", true),
                    ),
                )
                .put("progress", JSONObject().put("card", JSONObject().put("consumed", 1).put("total", 1))),
            defaultKpId = "fallback",
            videos = listOf(VideoItem("讲解", "https://example.com/video", "老师", "lecture")),
        )

        assertEquals("kp_force", bundle.kpId)
        assertEquals("力的合成知识卡", bundle.card?.title)
        assertEquals("<p>合力等效替代分力。</p>", bundle.card?.sections?.single()?.rendered?.html)
        assertEquals("F=ma", bundle.card?.sections?.single()?.content?.latex)
        assertEquals("合力", bundle.card?.sections?.single()?.content?.variableTable?.single()?.name)
        assertEquals(listOf("先确定研究对象"), bundle.card?.sections?.single()?.content?.items)
        assertEquals("微课", bundle.slides?.title)
        assertEquals("平行四边形定则", bundle.slides?.items?.single()?.title)
        assertEquals("<p>作图理解合力。</p>", bundle.slides?.items?.single()?.rendered?.html)
        assertEquals("sim_force", bundle.simulations.single().id)
        assertEquals("合力拖拽实验", bundle.simulations.single().title)
        assertEquals("<div>interactive</div>", bundle.simulations.single().html)
        assertEquals(true, bundle.simulations.single().consumed)
        assertEquals("例题 1", bundle.examples.single().title)
        assertEquals("题目：求两个力的合力", bundle.examples.single().body)
        assertEquals(true, bundle.examples.single().consumed)
        assertEquals(1, bundle.progress["card"]?.consumed)
        assertEquals(1, bundle.progress["card"]?.total)
        assertEquals("讲解", bundle.videos.single().title)
    }

    private fun renderedJson(html: String): JSONObject {
        return JSONObject()
            .put("html", html)
            .put("plain_text", "plain")
            .put("renderer", "katex")
            .put("renderer_version", "0.16.45")
            .put("content_hash", "hash")
            .put("has_math", false)
            .put("has_image", false)
            .put("has_markdown_table", false)
            .put("errors", JSONArray())
    }
}
