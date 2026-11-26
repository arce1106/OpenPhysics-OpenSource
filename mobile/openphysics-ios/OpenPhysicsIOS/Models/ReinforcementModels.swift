import Foundation

struct ReinforcementStartData: Decodable, Equatable {
    let isFirstTime: Bool
    let hasDiagnosed: Bool
    let recommendedKps: [ReinforcementRecommendedKnowledgePoint]
}

struct ReinforcementRecommendedKnowledgePoint: Decodable, Equatable {
    let kpId: String
    let kpName: String
    let mastery: Double
    let reason: String
}

struct ScopeDiagnosticKnowledgePointResult: Codable, Equatable, Identifiable {
    let id: String?
    let kpId: String
    let kpName: String
    let groupId: String?
    let groupName: String?
    let correctCount: Int
    let totalCount: Int
    let masteryBefore: Double
    let masteryAfter: Double
    let isWeak: Bool

    var stableID: String { id ?? kpId }

    private enum CodingKeys: String, CodingKey {
        case id
        case kpId
        case kpName
        case groupId
        case groupName
        case correctCount
        case totalCount
        case masteryBefore
        case masteryAfter
        case isWeak
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id)
        kpId = try container.decode(String.self, forKey: .kpId)
        kpName = try container.decode(String.self, forKey: .kpName)
        groupId = try container.decodeIfPresent(String.self, forKey: .groupId)
        groupName = try container.decodeIfPresent(String.self, forKey: .groupName)
        correctCount = try container.decode(Int.self, forKey: .correctCount)
        totalCount = try container.decode(Int.self, forKey: .totalCount)
        masteryBefore = try container.decode(Double.self, forKey: .masteryBefore)
        masteryAfter = try container.decode(Double.self, forKey: .masteryAfter)
        isWeak = try container.decodeIfPresent(Bool.self, forKey: .isWeak)
            ?? (masteryAfter < 0.6)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(id, forKey: .id)
        try container.encode(kpId, forKey: .kpId)
        try container.encode(kpName, forKey: .kpName)
        try container.encodeIfPresent(groupId, forKey: .groupId)
        try container.encodeIfPresent(groupName, forKey: .groupName)
        try container.encode(correctCount, forKey: .correctCount)
        try container.encode(totalCount, forKey: .totalCount)
        try container.encode(masteryBefore, forKey: .masteryBefore)
        try container.encode(masteryAfter, forKey: .masteryAfter)
        try container.encode(isWeak, forKey: .isWeak)
    }
}

struct ScopeDiagnosticResult: Codable, Equatable {
    let diagnosticAttemptId: String?
    let scopeType: String
    let scopeId: String
    let scopeName: String
    let kpResults: [ScopeDiagnosticKnowledgePointResult]
    let correctCount: Int
    let totalCount: Int
    let weakKpIds: [String]
    let recommendation: String
    let feedback: String

    var accuracyPercent: Int {
        guard totalCount > 0 else { return 0 }
        return Int((Double(correctCount) / Double(totalCount) * 100).rounded())
    }

}

struct ImprovementTask: Decodable, Equatable, Identifiable {
    let id: String
    let planId: String
    let kpId: String
    let kpName: String
    let groupId: String?
    let groupName: String?
    let correctCount: Int
    let totalCount: Int
    let masteryBefore: Double
    let masteryAfter: Double
    let isWeak: Bool
    let priority: Int
    let status: String
    let recommendedAction: String
    let reason: String

    func canPractice(planStatus: String) -> Bool {
        !["passed", "practiced"].contains(status) && planStatus != "completed"
    }

    var statusLabel: String {
        switch status {
        case "in_progress": return "进行中"
        case "practiced": return "已练习"
        case "needs_retest": return "待复测"
        case "passed": return "已通过"
        default: return "待完成"
        }
    }

    var actionLabel: String {
        switch recommendedAction {
        case "review_then_practice": return "先回看再练"
        case "challenge": return "进阶练习"
        case "retest": return "等待复测"
        default: return "专项练习"
        }
    }
}

struct ImprovementPlan: Decodable, Equatable, Identifiable {
    let id: String
    let studentId: String
    let diagnosticAttemptId: String
    let scopeType: String
    let scopeId: String
    let scopeName: String
    let createdAt: String
    let updatedAt: String?
    let completedAt: String?
    let correctCount: Int
    let totalCount: Int
    let weakCount: Int
    let status: String
    let currentTaskId: String?
    let sourceResult: ScopeDiagnosticResult?
    let tasks: [ImprovementTask]

    var isCompleted: Bool { status == "completed" }

    var currentTask: ImprovementTask? {
        guard !isCompleted else { return nil }
        if let currentTaskId,
           let current = tasks.first(where: {
               $0.id == currentTaskId && $0.canPractice(planStatus: status)
           }) {
            return current
        }
        return tasks
            .sorted { $0.priority < $1.priority }
            .first { $0.canPractice(planStatus: status) }
    }

    var readyForRetest: Bool {
        !isCompleted && currentTask == nil && status == "ready_for_retest"
    }

    var accuracyPercent: Int {
        guard totalCount > 0 else { return 0 }
        return Int((Double(correctCount) / Double(totalCount) * 100).rounded())
    }
}

struct ImprovementRetestSession: Decodable, Equatable {
    let attemptId: String
    let plan: ImprovementPlan
    let session: PracticeSession
}

struct ImprovementRetestTaskResult: Decodable, Equatable, Identifiable {
    let taskId: String
    let kpId: String
    let kpName: String
    let correctCount: Int
    let totalCount: Int
    let masteryBefore: Double?
    let masteryAfter: Double?
    let passed: Bool
    let nextStatus: String
    let feedback: String

    var id: String { taskId }
}

struct ImprovementRetestResult: Decodable, Equatable {
    let attemptId: String
    let plan: ImprovementPlan
    let correctCount: Int
    let totalCount: Int
    let passedCount: Int
    let needsRetestCount: Int
    let taskResults: [ImprovementRetestTaskResult]

    var accuracyPercent: Int {
        guard totalCount > 0 else { return 0 }
        return Int((Double(correctCount) / Double(totalCount) * 100).rounded())
    }
}

struct ImprovementReport: Decodable, Equatable {
    let summary: ImprovementReportSummary
}

struct ImprovementReportSummary: Decodable, Equatable {
    let planId: String
    let scopeType: String
    let scopeId: String
    let scopeName: String
    let planStatus: String
    let diagnosticCorrectCount: Int
    let diagnosticTotalCount: Int
    let diagnosticAccuracy: Double
    let taskCount: Int
    let weakTaskCount: Int
    let passedTaskCount: Int
    let needsRetestTaskCount: Int
    let practicedTaskCount: Int
    let pendingTaskCount: Int
    let retestAttemptCount: Int
    let latestRetestAccuracy: Double?
    let completed: Bool
}

struct ScopeDiagnosticAttemptListItem: Decodable, Equatable, Identifiable {
    let attemptId: String
    let scopeType: String
    let scopeId: String
    let scopeName: String
    let diagnosticType: String
    let createdAt: String
    let submittedAt: String
    let correctCount: Int
    let totalCount: Int
    let weakCount: Int
    let recommendation: String?
    let feedback: String?
    let linkedPlanId: String?
    let linkedPlanStatus: String?
    let linkedReportAvailable: Bool

    var id: String { attemptId }
}

struct ScopeDiagnosticAttemptListResponse: Decodable, Equatable {
    let items: [ScopeDiagnosticAttemptListItem]
    let total: Int
    let limit: Int
    let offset: Int
}

struct ScopeDiagnosticAttemptDetail: Decodable, Equatable, Identifiable {
    let attemptId: String
    let studentId: String
    let scopeType: String
    let scopeId: String
    let scopeName: String
    let diagnosticType: String
    let status: String
    let createdAt: String
    let submittedAt: String
    let correctCount: Int
    let totalCount: Int
    let weakCount: Int
    let weakKpIds: [String]
    let recommendation: String?
    let feedback: String?
    let kpResults: [ScopeDiagnosticKnowledgePointResult]
    let linkedPlanId: String?
    let linkedPlanStatus: String?
    let linkedReportAvailable: Bool

    var id: String { attemptId }

    var accuracyPercent: Int {
        guard totalCount > 0 else { return 0 }
        return Int((Double(correctCount) / Double(totalCount) * 100).rounded())
    }
}

struct ReinforcementChapterPlan: Equatable, Identifiable {
    let chapter: SyncChapter
    let recommendedKnowledgePoints: [SyncKnowledgePoint]

    var id: String { chapter.id }
    var volume: String { chapter.volume }
    var name: String { chapter.name }
    var knowledgePoints: [SyncKnowledgePoint] { chapter.knowledgePoints }
    var masteredCount: Int { chapter.masteredCount }
    var averageMasteryPercent: Int { chapter.averageMasteryPercent }
    var weakCount: Int { recommendedKnowledgePoints.count }
    var firstWeakKnowledgePoint: SyncKnowledgePoint? {
        recommendedKnowledgePoints.first
    }

    var statusLabel: String {
        if weakCount > 0 { return "有薄弱" }
        if averageMasteryPercent == 0 { return "未开始" }
        if averageMasteryPercent < 40 { return "待检测" }
        if averageMasteryPercent < 70 { return "可提升" }
        if masteredCount == knowledgePoints.count, !knowledgePoints.isEmpty {
            return "已稳定"
        }
        return "可提升"
    }
}

extension SyncDirectory {
    func reinforcementChapterPlans(
        start: ReinforcementStartData
    ) -> [ReinforcementChapterPlan] {
        let recommendationOrder = Dictionary(
            uniqueKeysWithValues: start.recommendedKps.enumerated().map {
                ($0.element.kpId, $0.offset)
            }
        )
        return volumes.flatMap { volume in
            chapters(in: volume).map { chapter in
                let recommendations = chapter.knowledgePoints
                    .filter { recommendationOrder[$0.id] != nil }
                    .sorted {
                        recommendationOrder[$0.id, default: .max]
                            < recommendationOrder[$1.id, default: .max]
                    }
                return ReinforcementChapterPlan(
                    chapter: chapter,
                    recommendedKnowledgePoints: recommendations
                )
            }
        }
    }

    func preferredReinforcementChapter(
        in plans: [ReinforcementChapterPlan],
        start: ReinforcementStartData
    ) -> ReinforcementChapterPlan? {
        plans
            .compactMap { plan -> (ReinforcementChapterPlan, Date)? in
                guard let date = plan.knowledgePoints.compactMap(\.lastPracticedDate).max()
                else { return nil }
                return (plan, date)
            }
            .max { $0.1 < $1.1 }?.0
            ?? start.recommendedKps.compactMap { recommendation in
                plans.first { plan in
                    plan.knowledgePoints.contains { $0.id == recommendation.kpId }
                }
            }.first
            ?? plans.first { $0.weakCount > 0 }
            ?? plans.first { $0.averageMasteryPercent < 70 }
            ?? plans.first
    }
}
