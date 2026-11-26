import Foundation

struct ReviewData: Decodable, Equatable {
    let groups: [ReviewGroup]
    let clearanceProgress: ReviewClearanceProgress
    let reviewCenter: ReviewCenter?

    var allMistakes: [ReviewMistake] {
        groups.flatMap(\.mistakes)
    }

    var pendingCount: Int {
        reviewCenter?.totalPending ?? allMistakes.count
    }

    var clearancePercent: Int {
        guard clearanceProgress.total > 0 else { return 0 }
        return min(
            100,
            max(
                0,
                Int(
                    (
                        Double(clearanceProgress.reviewed)
                            / Double(clearanceProgress.total)
                            * 100
                    ).rounded()
                )
            )
        )
    }
}

struct ReviewClearanceProgress: Decodable, Equatable {
    let reviewed: Int
    let total: Int
}

struct AnswerHistoryKnowledgePoint: Decodable, Equatable {
    let name: String
}

struct AnswerHistoryRecord: Decodable, Equatable, Identifiable {
    let id: Int
    let questionId: String
    let stemText: String?
    let stemRendered: RenderedRichContent?
    let questionType: String?
    let options: [PracticeOption]?
    let images: [QuestionImage]?
    let knowledgePoints: [AnswerHistoryKnowledgePoint]?
    let givenAnswer: String?
    let isCorrect: Bool
    let correctAnswer: String?
    let correctAnswerRendered: RenderedRichContent?
    let explanation: String?
    let explanationRendered: RenderedRichContent?
    let processGrading: ReviewProcessGrading?
    let reviewedAt: String?
    let timeSpentMs: Int?
    let createdAt: String?
    var lessonVideo: LessonVideoSummary? = nil

    var needsHumanReview: Bool {
        processGrading?.needsHumanReview == true
    }

    var knowledgePointNames: [String] {
        knowledgePoints?.map(\.name).filter { !$0.isEmpty } ?? []
    }

    var paneDictionary: [String: Any] {
        [
            "id": id,
            "question_id": questionId,
            "lesson_video": reviewJSONValue(lessonVideo?.paneDictionary),
            "stem_text": stemText ?? "",
            "stem_rendered": reviewJSONValue(stemRendered?.jsonObject),
            "question_type": questionType ?? "",
            "options": (options ?? []).map {
                [
                    "label": $0.label,
                    "text": $0.text,
                    "rendered": reviewJSONValue($0.rendered?.jsonObject),
                    "text_rendered": reviewJSONValue($0.textRendered?.jsonObject),
                ]
            },
            "images": (images ?? []).map {
                [
                    "image_path": $0.imagePath,
                    "image_type": reviewJSONValue($0.imageType),
                    "description": reviewJSONValue($0.description),
                ]
            },
            "knowledge_points": knowledgePointNames.map { ["name": $0] },
            "given_answer": givenAnswer ?? "",
            "is_correct": isCorrect,
            "correct_answer": correctAnswer ?? "",
            "correct_answer_rendered": reviewJSONValue(
                correctAnswerRendered?.jsonObject
            ),
            "explanation": explanation ?? "",
            "explanation_rendered": reviewJSONValue(
                explanationRendered?.jsonObject
            ),
            "process_grading": processGrading?.paneDictionary
                ?? ["needs_human_review": false],
            "reviewed_at": reviewJSONValue(reviewedAt),
            "created_at": createdAt ?? "",
        ]
    }

    var reviewSummary: ReviewMistake {
        ReviewMistake(
            answerId: id,
            questionId: questionId,
            stemText: stemText ?? "",
            stemRendered: stemRendered,
            questionType: questionType,
            options: options,
            images: images,
            givenAnswer: givenAnswer,
            givenAnswerRendered: nil,
            correctAnswer: correctAnswer,
            correctAnswerRendered: correctAnswerRendered,
            explanation: explanation,
            explanationRendered: explanationRendered,
            misconception: nil,
            processGrading: processGrading,
            createdAt: createdAt,
            lessonVideo: lessonVideo
        )
    }
}

struct ReviewGroup: Decodable, Equatable, Identifiable {
    let kpId: String
    let kpName: String
    let wrongCount: Int
    let mistakes: [ReviewMistake]

    var id: String { kpId }
}

struct ReviewMistake: Decodable, Equatable, Identifiable {
    let answerId: Int
    let questionId: String
    let stemText: String
    let stemRendered: RenderedRichContent?
    let questionType: String?
    let options: [PracticeOption]?
    let images: [QuestionImage]?
    let givenAnswer: String?
    let givenAnswerRendered: RenderedRichContent?
    let correctAnswer: String?
    let correctAnswerRendered: RenderedRichContent?
    let explanation: String?
    let explanationRendered: RenderedRichContent?
    let misconception: ReviewMisconception?
    let processGrading: ReviewProcessGrading?
    let createdAt: String?
    var lessonVideo: LessonVideoSummary? = nil

    var id: Int { answerId }

    var misconceptionName: String {
        readableMisconceptionName ?? "待复盘"
    }

    /// Hides an internal id (e.g. "self_review_needed") that an older server sends as the name.
    var readableMisconceptionName: String? {
        guard let name = misconception?.name.trimmingCharacters(in: .whitespacesAndNewlines),
              !name.isEmpty, name.range(of: "^[A-Za-z0-9_]+$", options: .regularExpression) == nil
        else { return nil }
        return name
    }

    var paneSummaryDictionary: [String: Any] {
        [
            "answer_id": answerId,
            "lesson_video": reviewJSONValue(lessonVideo?.paneDictionary),
            "question_id": questionId,
            "stem_text": stemText,
            "question_type": questionType ?? "",
            "misconception_name": readableMisconceptionName ?? "",
            "created_at": createdAt ?? "",
            "answer_images": answerImageDictionaries,
            "process_grading": [
                "needs_human_review": processGrading?.needsHumanReview ?? false,
            ],
        ]
    }

    var paneDetailDictionary: [String: Any] {
        var object = paneSummaryDictionary
        object["stem_rendered"] = reviewJSONValue(stemRendered?.jsonObject)
        object["options"] = (options ?? []).map {
            [
                "label": $0.label,
                "text": $0.text,
                "rendered": reviewJSONValue($0.rendered?.jsonObject),
                "text_rendered": reviewJSONValue($0.textRendered?.jsonObject),
            ]
        }
        object["images"] = (images ?? []).map {
            [
                "image_path": $0.imagePath,
                "image_type": reviewJSONValue($0.imageType),
                "description": reviewJSONValue($0.description),
            ]
        }
        object["given_answer"] = givenAnswer ?? ""
        object["given_answer_rendered"] = reviewJSONValue(givenAnswerRendered?.jsonObject)
        object["correct_answer"] = correctAnswer ?? ""
        object["correct_answer_rendered"] = reviewJSONValue(
            correctAnswerRendered?.jsonObject
        )
        object["explanation"] = explanation ?? ""
        object["explanation_rendered"] = reviewJSONValue(
            explanationRendered?.jsonObject
        )
        // No grading object (e.g. a choice question): send none. A placeholder made the
        // Pane draw an empty 「过程批改」 block with four 「未判断」 cells.
        object["process_grading"] = reviewJSONValue(processGrading?.paneDictionary)
        return object
    }

    /// The same result-first `practice_result` page the phone shows after grading (and Android
    /// shows for a mistake): verdict, first problem and next step before the original question.
    var panePracticeResultDictionary: [String: Any] {
        let detail = paneDetailDictionary
        let question: [String: Any] = [
            "id": questionId,
            "stem_text": stemText,
            "stem_rendered": detail["stem_rendered"] ?? NSNull(),
            "question_type": questionType ?? "",
            "options": detail["options"] ?? [],
            "images": detail["images"] ?? [],
            "correct_answer": correctAnswer ?? "",
            "correct_answer_rendered": detail["correct_answer_rendered"] ?? NSNull(),
            "explanation": explanation ?? "",
            "explanation_rendered": detail["explanation_rendered"] ?? NSNull(),
        ]
        let given = givenAnswer ?? ""
        let labels = options?.isEmpty == false
            ? Array(Set(given.uppercased().filter { $0.isLetter && $0.isASCII }.map(String.init))).sorted()
            : []
        return [
            "question": question,
            "givenAnswer": given,
            "selectedOptions": labels,
            "showAnswerSummary": true,
            "answerState": [
                "submitted": true,
                "correct": false,
                "correctAnswer": correctAnswer ?? "",
                "correctAnswerRendered": detail["correct_answer_rendered"] ?? NSNull(),
                "explanation": explanation ?? "",
                "explanation_rendered": detail["explanation_rendered"] ?? NSNull(),
                "processGrading": detail["process_grading"] ?? NSNull(),
                "detectedMisconception": readableMisconceptionName.map { ["name": $0] as Any } ?? NSNull(),
            ] as [String: Any],
        ]
    }

    private var answerImageDictionaries: [[String: Any]] {
        processGrading?.allAnswerImagePaths.map {
            [
                "image_path": $0,
                "image_type": "answer",
                "description": "学生作答",
            ]
        } ?? []
    }
}

struct ReviewMisconception: Decodable, Equatable {
    let id: String
    let name: String
}

struct ReviewProcessGrading: Codable, Equatable {
    let feedback: String?
    let feedbackRendered: RenderedRichContent?
    let firstError: String?
    let firstErrorRendered: RenderedRichContent?
    let nextAction: String?
    let nextActionRendered: RenderedRichContent?
    let gradingBasis: String?
    let gradingBasisRendered: RenderedRichContent?
    let answerImagePath: String?
    let answerImagePaths: [String]?
    let answerCropImagePath: String?
    let answerPageImagePath: String?
    let answerPageImagePaths: [String]?
    let answerSource: String?
    let processEvidenceKind: String?
    let processEvidenceImagePath: String?
    let needsHumanReview: Bool?
    let processScore: Double?
    let processScorePercent: Double?
    let score: Double?
    let maxScore: Double?
    let modelCorrect: Bool?
    let equationCorrect: Bool?
    let calculationCorrect: Bool?
    let unitCorrect: Bool?
    let errorType: String?
    let errorTypeName: String?
    let gradingConfidence: Double?
    let confidenceLevel: String?
    let stepScores: [ReviewProcessStepScore]?

    var allAnswerImagePaths: [String] {
        var values = answerImagePaths ?? []
        if let answerImagePath { values.append(answerImagePath) }
        if let answerCropImagePath { values.append(answerCropImagePath) }
        if let answerPageImagePath { values.append(answerPageImagePath) }
        values.append(contentsOf: answerPageImagePaths ?? [])
        return values.reduce(into: [String]()) { result, value in
            if !value.isEmpty, !result.contains(value) {
                result.append(value)
            }
        }
    }

    var paneDictionary: [String: Any] {
        [
            "feedback": feedback ?? "",
            "feedback_rendered": reviewJSONValue(feedbackRendered?.jsonObject),
            "first_error": firstError ?? "",
            "first_error_rendered": reviewJSONValue(firstErrorRendered?.jsonObject),
            "next_action": nextAction ?? "",
            "next_action_rendered": reviewJSONValue(nextActionRendered?.jsonObject),
            "grading_basis": gradingBasis ?? "",
            "grading_basis_rendered": reviewJSONValue(gradingBasisRendered?.jsonObject),
            "needs_human_review": needsHumanReview ?? false,
            "process_score": reviewJSONValue(processScore),
            "process_score_percent": reviewJSONValue(processScorePercent),
            "score": reviewJSONValue(score),
            "max_score": reviewJSONValue(maxScore),
            "model_correct": reviewJSONValue(modelCorrect),
            "equation_correct": reviewJSONValue(equationCorrect),
            "calculation_correct": reviewJSONValue(calculationCorrect),
            "unit_correct": reviewJSONValue(unitCorrect),
            "error_type": errorType ?? "",
            "error_type_name": errorTypeName ?? "",
            "grading_confidence": reviewJSONValue(gradingConfidence),
            "confidence_level": confidenceLevel ?? "",
            "answer_image_paths": allAnswerImagePaths,
            "answer_source": answerSource ?? "",
            "process_evidence_kind": processEvidenceKind ?? "",
            "process_evidence_image_path": processEvidenceImagePath ?? "",
            "step_scores": (stepScores ?? []).map {
                [
                    "name": $0.name ?? "",
                    "score": reviewJSONValue($0.score),
                    "max_score": reviewJSONValue($0.maxScore),
                    "comment": $0.comment ?? "",
                ]
            },
        ]
    }
}

struct ReviewProcessStepScore: Codable, Equatable {
    let name: String?
    let score: Double?
    let maxScore: Double?
    let comment: String?
}

struct ReviewCenter: Decodable, Equatable {
    let totalPending: Int
    let primaryFocus: ReviewErrorGroup?
    let errorGroups: [ReviewErrorGroup]
    let reviewSteps: [ReviewStep]
    let stageCounts: [String: Int]
}

struct ReviewErrorGroup: Decodable, Equatable, Identifiable {
    let errorType: String
    let errorName: String
    let count: Int
    let kpNames: [String]
    let sampleAnswerId: Int?
    let sampleQuestionId: String?
    let firstError: String
    let nextAction: String

    var id: String { errorType }
}

struct ReviewStep: Decodable, Equatable, Identifiable {
    let title: String
    let description: String

    var id: String { title }
}

struct ReviewVariationData: Decodable, Equatable {
    let variations: [ReviewVariationQuestion]
}

struct ReviewVariationQuestion: Decodable, Equatable {
    let variationType: String
    let title: String
    let reason: String
    let question: PracticeQuestion
}

struct ReviewRetryData: Decodable, Equatable {
    let question: PracticeQuestion?
}

struct CompleteReviewResponse: Decodable, Equatable {
    let cleared: Bool
    /// Why the server kept the mistake open, e.g. the retry still awaits confirmation.
    var detail: String? = nil
}

private func reviewJSONValue(_ value: Any?) -> Any {
    value ?? NSNull()
}
