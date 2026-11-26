import Foundation

struct PracticeSession: Decodable, Equatable {
    let studentId: String?
    let sessionType: String
    let strategy: String
    let sessionObjective: String
    let questions: [PracticeQuestion]
    var teacherPaper: TeacherPaper? = nil
    var answers: [String: SubmitAnswerResult]? = nil
}

struct PracticeSubmissionSourceSummary: Equatable {
    let choice: Int
    let text: Int
    let handwriting: Int
    let photo: Int
    let selfReview: Int
    let unanswered: Int

    var answered: Int {
        choice + text + handwriting + photo + selfReview
    }

    var displayText: String {
        var parts = ["已作答 \(answered)"]
        if choice > 0 { parts.append("选择 \(choice)") }
        if text > 0 { parts.append("文字 \(text)") }
        if handwriting > 0 { parts.append("手写 \(handwriting)") }
        if photo > 0 { parts.append("照片 \(photo)") }
        if selfReview > 0 { parts.append("自评 \(selfReview)") }
        if unanswered > 0 { parts.append("未作答 \(unanswered)") }
        return parts.joined(separator: " · ")
    }
}

struct PracticeQuestion: Decodable, Equatable, Identifiable {
    let id: String
    let stemText: String
    let questionType: String
    let options: [PracticeOption]
    let images: [QuestionImage]
    let stemRendered: RenderedRichContent?
    let answer: String?
    let correctAnswer: String?
    let correctAnswerRendered: RenderedRichContent?
    let explanation: String?
    let explanationRendered: RenderedRichContent?
    let targetKnowledgePointId: String?
    var topicContext: [String: String]? = nil

    var isChoice: Bool { !options.isEmpty }
    var isMultipleChoice: Bool { questionType == "multiple_choice" }

    var supportsSelfReview: Bool {
        SelfReview.supportedQuestionTypes.contains(questionType)
    }

    var selfReviewAnswer: String {
        correctAnswer ?? answer ?? ""
    }

    var initialSelfReviewItems: [SelfReviewItem] {
        SelfReview.items(answer: selfReviewAnswer, stem: stemText)
    }

    var draftImages: [QuestionImage] {
        images.filter {
            $0.imageType != "explanation" && $0.imageType != "option"
        }
    }
}

struct PracticeOption: Decodable, Equatable, Identifiable {
    let label: String
    let text: String
    let rendered: RenderedRichContent?
    let textRendered: RenderedRichContent?

    var id: String { label }
}

struct QuestionImage: Decodable, Equatable, Identifiable {
    let imagePath: String
    let imageType: String?
    let description: String?

    var id: String { imagePath }
}

struct RenderedRichContent: Codable, Equatable {
    let html: String
    let plainText: String
    let renderer: String
    let rendererVersion: String
    let contentHash: String
    let hasMath: Bool
    let hasImage: Bool
    let hasMarkdownTable: Bool
    let errors: [RenderedRichContentError]
}

struct RenderedRichContentError: Codable, Equatable {
    let type: String
    let message: String
    let latex: String?
    let position: Int?
}

struct SubmitAnswerResult: Decodable, Equatable {
    let answerId: Int?
    let isCorrect: Bool
    let correctAnswer: String
    let correctAnswerRendered: RenderedRichContent?
    let explanation: String?
    let explanationRendered: RenderedRichContent?
    let masteryUpdate: [String: MasteryUpdate]
    let detectedMisconception: DetectedMisconception?
    let aiFeedback: String?
    let aiFeedbackRendered: RenderedRichContent?
    let extractedAnswer: String?
    let processGrading: ReviewProcessGrading?
    let cleared: Bool?
    let idempotentReplay: Bool
    var givenAnswer: String? = nil
    var lessonVideo: LessonVideoSummary? = nil
}

struct ProcessEvidenceResponse: Decodable, Equatable {
    let answerId: Int
    let questionId: String
    let processGrading: ReviewProcessGrading
}

struct MasteryUpdate: Codable, Equatable {
    let before: Double
    let after: Double
    let name: String
}

struct SubmittedDiagnosticAnswer: Encodable, Equatable {
    let answerId: Int
    let masteryUpdate: [String: MasteryUpdate]

    enum CodingKeys: String, CodingKey {
        case answerId = "answer_id"
        case masteryUpdate = "mastery_update"
    }
}

struct KpDiagnosticResult: Decodable, Equatable {
    let kpId: String
    let kpName: String
    let correctCount: Int
    let totalCount: Int
    let masteryBefore: Double
    let masteryAfter: Double
    let recommendation: String
    let feedback: String

    var recommendationLabel: String {
        switch recommendation {
        case "mastered": return "已掌握"
        case "practice": return "有基础，需巩固"
        default: return "建议先学习"
        }
    }

    var recommendationSymbol: String {
        switch recommendation {
        case "mastered": return "checkmark.seal.fill"
        case "practice": return "figure.strengthtraining.traditional"
        default: return "book.fill"
        }
    }
}

struct DetectedMisconception: Decodable, Equatable {
    let name: String
}

enum SelfReviewStatus: String, Codable, CaseIterable, Identifiable {
    case correct
    case partial
    case wrong

    var id: String { rawValue }

    var title: String {
        switch self {
        case .correct: return "全对"
        case .partial: return "半对"
        case .wrong: return "不会"
        }
    }
}

struct SelfReviewItem: Equatable, Identifiable {
    let label: String
    var status: SelfReviewStatus?

    var id: String { label }
}

enum SelfReview {
    static let supportedQuestionTypes: Set<String> = [
        "problem_solving",
        "comprehensive",
        "experiment",
        "graph_construction",
        "fill_in_blank",
        "knowledge_fill_in_blank",
    ]

    static func items(answer: String, stem: String) -> [SelfReviewItem] {
        let source = "\(answer)\n\(stem)"
        guard let expression = try? NSRegularExpression(pattern: #"\(\s*\d+\s*\)"#) else {
            return [SelfReviewItem(label: "整题", status: nil)]
        }
        let range = NSRange(source.startIndex..<source.endIndex, in: source)
        var seen = Set<String>()
        let labels = expression.matches(in: source, range: range).compactMap { match -> String? in
            guard let matchRange = Range(match.range, in: source) else { return nil }
            let label = String(source[matchRange])
                .replacingOccurrences(of: " ", with: "")
                .replacingOccurrences(of: "\t", with: "")
                .replacingOccurrences(of: "\n", with: "")
            return seen.insert(label).inserted ? label : nil
        }
        if labels.isEmpty {
            return [SelfReviewItem(label: "整题", status: nil)]
        }
        return labels.map { SelfReviewItem(label: $0, status: nil) }
    }
}

extension PracticeQuestion {
    func paneDictionary() -> [String: Any] {
        [
            "id": id,
            "stem_text": stemText,
            "stem_rendered": jsonValue(stemRendered?.jsonObject),
            "question_type": questionType,
            "options": options.map(\.paneDictionary),
            "images": images.map(\.paneDictionary),
            "answer": jsonValue(answer),
            "correct_answer": jsonValue(correctAnswer),
            "correct_answer_rendered": jsonValue(correctAnswerRendered?.jsonObject),
            "explanation": jsonValue(explanation),
            "explanation_rendered": jsonValue(explanationRendered?.jsonObject),
        ]
    }
}

private extension PracticeOption {
    var paneDictionary: [String: Any] {
        [
            "label": label,
            "text": text,
            "rendered": jsonValue(rendered?.jsonObject),
            "text_rendered": jsonValue(textRendered?.jsonObject),
        ]
    }
}

private extension QuestionImage {
    var paneDictionary: [String: Any] {
        [
            "image_path": imagePath,
            "image_type": jsonValue(imageType),
            "description": jsonValue(description),
        ]
    }
}

extension RenderedRichContent {
    var jsonObject: [String: Any] {
        [
            "html": html,
            "plain_text": plainText,
            "renderer": renderer,
            "renderer_version": rendererVersion,
            "content_hash": contentHash,
            "has_math": hasMath,
            "has_image": hasImage,
            "has_markdown_table": hasMarkdownTable,
            "errors": errors.map {
                [
                    "type": $0.type,
                    "message": $0.message,
                    "latex": jsonValue($0.latex),
                    "position": jsonValue($0.position),
                ]
            },
        ]
    }
}

extension SubmitAnswerResult {
    func replacingProcessGrading(
        _ processGrading: ReviewProcessGrading
    ) -> SubmitAnswerResult {
        SubmitAnswerResult(
            answerId: answerId,
            isCorrect: isCorrect,
            correctAnswer: correctAnswer,
            correctAnswerRendered: correctAnswerRendered,
            explanation: explanation,
            explanationRendered: explanationRendered,
            masteryUpdate: masteryUpdate,
            detectedMisconception: detectedMisconception,
            aiFeedback: aiFeedback,
            aiFeedbackRendered: aiFeedbackRendered,
            extractedAnswer: extractedAnswer,
            processGrading: processGrading,
            cleared: cleared,
            idempotentReplay: idempotentReplay,
            givenAnswer: givenAnswer,
            lessonVideo: lessonVideo
        )
    }

    var paneAnswerState: [String: Any] {
        [
            "submitted": true,
            "correct": isCorrect,
            "correctAnswer": correctAnswer,
            "correctAnswerRendered": jsonValue(correctAnswerRendered?.jsonObject),
            "explanation": explanation ?? "",
            "explanation_rendered": jsonValue(explanationRendered?.jsonObject),
            "aiFeedback": aiFeedback ?? "",
            "aiFeedbackRendered": jsonValue(aiFeedbackRendered?.jsonObject),
            "extractedAnswer": extractedAnswer ?? "",
            "processGrading": jsonValue(processGrading?.paneDictionary),
            "detectedMisconception": jsonValue(detectedMisconception.map { ["name": $0.name] }),
            "masteryUpdate": masteryUpdate.mapValues {
                ["before": $0.before, "after": $0.after, "name": $0.name]
            },
        ]
    }
}

private func jsonValue(_ value: Any?) -> Any {
    value ?? NSNull()
}
