import Foundation

enum LearningCatalogTopicLayer: String, Codable, CaseIterable, Identifiable {
    case diagnostic
    case foundation
    case breakthrough
    case transfer
    case paper

    var id: String { rawValue }

    var title: String {
        switch self {
        case .diagnostic: return "专题摸底"
        case .foundation: return "基础巩固"
        case .breakthrough: return "典型突破"
        case .transfer: return "综合迁移"
        case .paper: return "专题套卷"
        }
    }

    var questionCount: Int {
        switch self {
        case .diagnostic: return 8
        case .paper: return 10
        case .foundation: return 5
        case .breakthrough, .transfer: return 4
        }
    }

    var number: String {
        switch self {
        case .foundation: return "01"
        case .breakthrough: return "02"
        case .transfer: return "03"
        case .diagnostic, .paper: return ""
        }
    }

    var description: String {
        switch self {
        case .diagnostic:
            return "先完成整组题目，再统一查看批改结果。"
        case .foundation:
            return "5 题 · 专题内基础梯度 · 题型按专题特点安排。"
        case .breakthrough:
            return "4 题 · 专题内中段梯度 · 突出典型模型与关键方法。"
        case .transfer:
            return "4 题 · 专题内较高梯度 · 侧重综合迁移与复杂情境。"
        case .paper:
            return "混合基础、典型和综合题，共 10 题，适合阶段验收与限时训练。"
        }
    }
}

struct LearningCatalogMappingSummary: Decodable, Equatable {
    let knowledgePointCount: Int
    let labelRuleCount: Int
    let questionOverrideCount: Int
}

struct LearningCatalogResume: Decodable {
    let nodeId: String?
    let lastPracticed: String?
}

struct LearningCatalogNode: Decodable, Equatable, Identifiable {
    let id: String
    let code: String
    let nodeType: String
    let title: String
    let description: String?
    let sortOrder: Int
    let mappingSummary: LearningCatalogMappingSummary
    let children: [LearningCatalogNode]
    let displayCode: String?

    enum CodingKeys: String, CodingKey {
        case id
        case code
        case nodeType
        case title
        case description
        case sortOrder
        case config
        case mappingSummary
        case children
    }

    private enum ConfigCodingKeys: String, CodingKey {
        case displayCode
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        code = try container.decode(String.self, forKey: .code)
        nodeType = try container.decode(String.self, forKey: .nodeType)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        sortOrder = try container.decode(Int.self, forKey: .sortOrder)
        mappingSummary = try container.decode(
            LearningCatalogMappingSummary.self,
            forKey: .mappingSummary
        )
        children = try container.decodeIfPresent(
            [LearningCatalogNode].self,
            forKey: .children
        ) ?? []

        if let config = try? container.nestedContainer(
            keyedBy: ConfigCodingKeys.self,
            forKey: .config
        ) {
            if let stringCode = try? config.decode(String.self, forKey: .displayCode) {
                displayCode = stringCode
            } else if let numericCode = try? config.decode(Int.self, forKey: .displayCode) {
                displayCode = String(format: "%02d", numericCode)
            } else {
                displayCode = nil
            }
        } else {
            displayCode = nil
        }
    }

    var topicDisplayCode: String {
        if let displayCode, !displayCode.isEmpty { return displayCode }
        let fallback = code.replacingOccurrences(of: "topic_", with: "")
        return fallback.isEmpty ? code : fallback
    }

    var topics: [LearningCatalogNode] {
        children.filter { $0.nodeType == "topic" }.sorted { $0.sortOrder < $1.sortOrder }
    }
}

struct LearningCatalogData: Decodable, Equatable {
    let id: String
    let code: String
    let name: String
    let description: String?
    let version: Int
    let enabled: Bool
    let sortOrder: Int
    let nodeCount: Int
    let topicCount: Int
    let nodes: [LearningCatalogNode]

    var knowledgeBlocks: [LearningCatalogNode] {
        nodes.filter { $0.nodeType == "block" }.sorted { $0.sortOrder < $1.sortOrder }
    }

    func topic(id: String) -> LearningCatalogNode? {
        knowledgeBlocks.lazy.flatMap(\.topics).first { $0.id == id }
    }
}

struct LearningCatalogTopicOverview: Decodable, Equatable {
    let catalogCode: String
    let nodeId: String
    let topicCode: String
    let title: String
    let description: String?
    let status: String
    let statusLabel: String
    let recommendedLayer: LearningCatalogTopicLayer
    let recommendedLayerName: String
    let nextAction: String
    let coreKnowledgePointCount: Int
    let attemptedKnowledgePointCount: Int
    let masteredKnowledgePointCount: Int
    let needsReviewKnowledgePointCount: Int
    let averageMastery: Double
    var performanceScore: Double? = nil
    var evidenceCount: Int? = nil
    let lastPracticed: String?
    var teacherPapers: [TeacherPaper]? = nil

    var topicPerformanceLabel: String {
        performanceScore.map { "\(Int(($0 * 100).rounded()))% 专题作答表现" } ?? "专题表现待检测"
    }

    var untestedKnowledgePointCount: Int { max(0, coreKnowledgePointCount - attemptedKnowledgePointCount) }

    var averageMasteryPercent: Int {
        Int((averageMastery * 100).rounded())
    }

    var hasLearningEvidence: Bool {
        attemptedKnowledgePointCount > 0
    }

    var recentPracticeLabel: String {
        guard let lastPracticed else { return "暂无复习记录" }
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds,
        ]
        let date = fractionalFormatter.date(from: lastPracticed)
            ?? ISO8601DateFormatter().date(from: lastPracticed)
        guard let date else { return "已有复习记录" }
        let displayFormatter = DateFormatter()
        displayFormatter.locale = Locale(identifier: "zh_CN")
        displayFormatter.dateFormat = "M月d日"
        return "最近复习 \(displayFormatter.string(from: date))"
    }
}

struct LearningCatalogPracticeContext: Equatable {
    let catalogCode: String
    let nodeId: String
    let topicTitle: String
    let layer: LearningCatalogTopicLayer
    let questionCount: Int
}

struct TeacherPaper: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let questionCount: Int
    let hasVideo: Bool
    let attemptId: String?
    let status: String
    let submittedAt: String?
    let completedAt: String?
    let attemptToken: String?
    /// Teacher homework once finished, as in TeacherHomework.
    var scorePercent: Int? = nil
    var resultsReleased: Bool? = nil

    var isCompleted: Bool { status == "completed" }
    var homeworkScore: HomeworkScore? { HomeworkScore(percent: scorePercent, released: resultsReleased) }
    var entryTitle: String {
        switch status {
        case "completed": return "查看答卷"
        case "grading": return "继续批改"
        default: return "开始作答"
        }
    }
}

/// A finished homework's score out of 100, on the teacher's points. Until released it is the
/// app's own grading, which the teacher's review may still change.
struct HomeworkScore: Equatable {
    let percent: Int
    let released: Bool

    init?(percent: Int?, released: Bool?) {
        guard let percent else { return nil }
        self.percent = percent
        self.released = released ?? false
    }

    var label: String { "\(percent) 分" }
    var note: String { released ? "老师已审核" : "AI 批改，老师审核后可能调整" }
}

/// The home card shows one homework: the newest unfinished one, otherwise the newest finished one.
/// Older finished homework is reopened from 作业记录; other unfinished ones fold under the first.
/// The server lists homework newest first.
struct HomeTeacherHomework: Equatable {
    let primary: TeacherHomework?
    let otherPending: [TeacherHomework]

    init(_ items: [TeacherHomework]) {
        let pending = items.filter { $0.status != "completed" }
        let primary = pending.first ?? items.first
        self.primary = primary
        otherPending = pending.filter { $0.attemptId != primary?.attemptId }
    }

    func rows(expanded: Bool) -> [TeacherHomework] {
        (primary.map { [$0] } ?? []) + (expanded ? otherPending : [])
    }

    func moreLabel(expanded: Bool) -> String? {
        guard !otherPending.isEmpty else { return nil }
        return expanded ? "收起" : "还有 \(otherPending.count) 份作业待完成"
    }
}

/// Personalized homework a teacher sent to this account; answered like a fixed paper.
struct TeacherHomework: Decodable, Equatable, Identifiable {
    let attemptId: String
    let assignmentId: String
    let title: String
    let className: String
    let questionCount: Int
    let gradedCount: Int
    /// in_progress: answering; grading: submitted, answers being graded; completed: done.
    let status: String
    let publishedAt: String?
    /// "paper": a scanned paper the teacher has graded, listed with its results.
    var delivery: String? = nil
    /// Finished work only: out of 100, see HomeworkScore.
    var scorePercent: Int? = nil
    var resultsReleased: Bool? = nil

    var id: String { attemptId }
    var homeworkScore: HomeworkScore? { HomeworkScore(percent: scorePercent, released: resultsReleased) }
    var kindLabel: String { delivery == "paper" ? "纸质作业 · 已出成绩" : "老师作业" }

    var actionTitle: String {
        switch status {
        case "completed": return "查看结果"
        case "grading": return "继续批改"
        default: return "去作答"
        }
    }

    var detail: String {
        switch status {
        case "completed": return "\(className) · \(questionCount) 题 · \(homeworkScore?.label ?? "已完成")"
        case "grading": return "\(className) · 已批改 \(gradedCount)/\(questionCount)"
        default: return "\(className) · \(questionCount) 题"
        }
    }
}

struct LessonVideoSummary: Decodable, Equatable {
    let id: String
    let title: String
    let durationSeconds: Int
    let available: Bool
    let lockedReason: String?

    var paneDictionary: [String: Any] {
        ["id": id, "title": title, "duration_seconds": durationSeconds,
         "available": available, "locked_reason": lockedReason ?? "整套批改完成后可看视频讲解"]
    }
}

struct LessonVideoPlayback: Decodable {
    let questionId: String
    let title: String
    let durationSeconds: Int
    let videoUrl: String
}

struct LearningCatalogPracticeSummary: Equatable {
    let correctCount: Double
    let totalCount: Int

    var accuracyPercent: Int {
        guard totalCount > 0 else { return 0 }
        return Int((Double(correctCount) / Double(totalCount) * 100).rounded())
    }

    var scoreLabel: String {
        if correctCount.rounded() == correctCount {
            return String(Int(correctCount))
        }
        return String(format: "%.1f", correctCount)
    }

    var isPerfect: Bool {
        totalCount > 0 && correctCount >= Double(totalCount) - 0.001
    }

    var headline: String {
        guard isPerfect else {
            return "本轮已经暴露出需要修复的位置，先把错因解决。"
        }
        return "本轮方法比较稳定，可以继续向综合题推进。"
    }
}
