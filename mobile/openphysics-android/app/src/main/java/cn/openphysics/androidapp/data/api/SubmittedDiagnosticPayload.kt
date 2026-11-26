package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.domain.SubmittedDiagnosticAnswer
import org.json.JSONArray
import org.json.JSONObject

internal object SubmittedDiagnosticPayload {
    fun answersJson(answers: List<SubmittedDiagnosticAnswer>): JSONArray {
        return JSONArray().apply {
            answers.forEach { answer ->
                put(
                    JSONObject()
                        .put("answer_id", answer.answerId)
                        .put("mastery_update", masteryUpdateJson(answer)),
                )
            }
        }
    }

    private fun masteryUpdateJson(answer: SubmittedDiagnosticAnswer): JSONObject {
        return JSONObject().apply {
            answer.masteryUpdate.forEach { (kpId, update) ->
                put(
                    kpId,
                    JSONObject()
                        .put("before", update.before)
                        .put("after", update.after)
                        .put("name", update.name),
                )
            }
        }
    }
}
