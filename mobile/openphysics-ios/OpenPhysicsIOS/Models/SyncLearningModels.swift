import Foundation

struct SyncDirectory: Decodable, Equatable {
    let kps: [SyncKnowledgePoint]
    let stats: SyncDirectoryStats
    let relations: [SyncDirectoryRelation]

    var volumes: [String] {
        orderedUnique(kps.compactMap(\.volume).filter { !$0.isEmpty })
    }

    func chapters(in volume: String) -> [SyncChapter] {
        let points = kps.filter { $0.volume == volume }
        return orderedUnique(points.compactMap(\.chapter).filter { !$0.isEmpty }).map { chapter in
            SyncChapter(
                volume: volume,
                name: chapter,
                knowledgePoints: points.filter { $0.chapter == chapter }
            )
        }
    }

    /// Where the sync page opens: the point practised most recently, as on the web
    /// (`pickInitialSyncKp`), so the student lands where they left off.
    func initialKnowledgePoint(in points: [SyncKnowledgePoint]) -> SyncKnowledgePoint? {
        points
            .filter { $0.lastPracticedDate != nil }
            .max { ($0.lastPracticedDate ?? .distantPast) < ($1.lastPracticedDate ?? .distantPast) }
            ?? recommendedKnowledgePoint(in: points)
    }

    /// The chapter's 「推荐」 point — same rule as the web (`pickRecommendedKp`) and the home
    /// page's next milestone: learning, then practice, then to_learn, in path order.
    func recommendedKnowledgePoint(in points: [SyncKnowledgePoint]) -> SyncKnowledgePoint? {
        let points = points.filter { !$0.contentPending }
        return ["learning", "practice", "to_learn"].compactMap { state in
            points.first { $0.learningState == state }
        }.first
            ?? points.first { $0.learningState != "mastered" }
            ?? points.first
    }

    func recommendedChapter(in volume: String) -> SyncChapter? {
        let chapters = chapters(in: volume)
        let recent = chapters
            .compactMap { chapter -> (SyncChapter, Date)? in
                guard let date = chapter.knowledgePoints.compactMap(\.lastPracticedDate).max()
                else { return nil }
                return (chapter, date)
            }
            .max { $0.1 < $1.1 }?.0
        return recent
            ?? chapters.first { chapter in
                chapter.knowledgePoints.contains { ["learning", "practice"].contains($0.learningState) }
            }
            ?? chapters.first { chapter in
                chapter.knowledgePoints.contains { ["to_learn", "locked"].contains($0.learningState) }
            }
            ?? chapters.first
    }

    var initialSelection: (volume: String, chapter: SyncChapter?, point: SyncKnowledgePoint?)? {
        guard let firstVolume = volumes.first else { return nil }
        let globalRecommended = initialKnowledgePoint(in: kps)
        let volume = globalRecommended?.volume.flatMap { volumes.contains($0) ? $0 : nil }
            ?? firstVolume
        let chapter = chapters(in: volume).first { candidate in
            candidate.knowledgePoints.contains { $0.id == globalRecommended?.id }
        } ?? recommendedChapter(in: volume)
        return (volume, chapter, chapter.flatMap { initialKnowledgePoint(in: $0.knowledgePoints) })
    }
}

struct SyncDirectoryStats: Decodable, Equatable {
    let mastered: Int
    let inProgress: Int
    let locked: Int
    let total: Int
    let learning: Int
    let toLearn: Int
    let practice: Int
}

struct SyncDirectoryRelation: Decodable, Equatable, Identifiable {
    let id: Int
    let sourceId: String
    let targetId: String
    let relationType: String
    let reason: String?
}

struct SyncKnowledgePoint: Decodable, Equatable, Hashable, Identifiable {
    var judgment: KnowledgeMasteryJudgment? = nil
    let id: String
    let name: String
    let volume: String?
    let chapter: String?
    let section: String?
    let mastery: Double
    let status: String
    let learningState: String
    let learningStateLabel: String
    let learningStateTone: String
    let blockedBy: [String]
    let lastPracticed: String?
    var contentAvailable: Bool? = nil
    var practiceAvailable: Bool? = nil

    var contentPending: Bool { status == "pending_content" || contentAvailable == false }

    var masteryPercent: Int {
        Int((min(1, max(0, judgment?.masteryScore ?? mastery)) * 100).rounded())
    }

    var masteryLabel: String { judgment?.label ?? learningStateLabel }

    var lastPracticedDate: Date? {
        guard let lastPracticed else { return nil }
        return ISO8601DateFormatter.openPhysicsFractional.date(from: lastPracticed)
            ?? ISO8601DateFormatter.openPhysics.date(from: lastPracticed)
    }

    /// Same rule as Android's `shouldUseConsolidationPractice`: a point already studied ("practice")
    /// or mastered is reinforced with 巩固小练 rather than assessed again.
    var usesConsolidationPractice: Bool {
        learningState == "mastered" || learningState == "practice"
    }

    /// Same labels as Android's `syncKpActions`.
    var learningActionLabel: String {
        if usesConsolidationPractice { return "回看知识卡" }
        return learningState == "learning" ? "继续学习" : "开始学习"
    }

    var practiceActionTitle: String { usesConsolidationPractice ? "巩固小练" : "掌握评估" }

    var practiceActionDetail: String {
        usesConsolidationPractice ? "用练习巩固已评估的知识点" : "完成一组小测，确认理解与应用"
    }

    var practiceActionLoadingTitle: String { usesConsolidationPractice ? "正在准备练习…" : "正在准备评估…" }

    var advice: String {
        if contentPending { return "目录已保留，学习内容和题目待部署者补充。" }
        switch learningState {
        case "mastered":
            return "已基本掌握，可以巩固应用，也可以回看知识卡。"
        case "practice":
            return "概念已经学过，当前更适合用练习巩固。"
        case "learning":
            return "继续完成知识卡，再用掌握评估确认是否真正会用。"
        default:
            return "建议先学习知识卡，再用掌握评估确认理解。"
        }
    }
}

struct KnowledgeMasteryJudgment: Decodable, Equatable, Hashable {
    let kpId: String
    let masteryScore: Double
    let masteryLevel: String
    let interventionStatus: String
    let confidence: String

    var label: String {
        if confidence == "low" { return "证据较少" }
        return ["weak": "薄弱", "developing": "发展中", "stable": "较稳定", "mastered": "已掌握"][masteryLevel] ?? "建议先学习"
    }
}

extension APIClient {
    func masteryJudgments(for student: StudentSession, kpIds: [String]) async throws -> [KnowledgeMasteryJudgment] {
        struct Request: Encodable { let kpIds: [String] }
        struct Response: Decodable { let items: [KnowledgeMasteryJudgment] }
        let result: Response = try await request(path: "mastery-judgments/kps", method: "POST",
            body: Request(kpIds: kpIds), token: student.token)
        return result.items
    }
}

struct SyncChapter: Equatable, Hashable, Identifiable {
    let volume: String
    let name: String
    let knowledgePoints: [SyncKnowledgePoint]

    var id: String { "\(volume)||\(name)" }
    var masteredCount: Int { knowledgePoints.filter { $0.learningState == "mastered" }.count }
    var averageMasteryPercent: Int {
        let knowledgePoints = knowledgePoints.filter { !$0.contentPending }
        guard !knowledgePoints.isEmpty else { return 0 }
        return Int(
            (knowledgePoints.reduce(0) { $0 + $1.mastery } / Double(knowledgePoints.count) * 100)
                .rounded()
        )
    }

    var statusLabel: String {
        if knowledgePoints.allSatisfy({ $0.contentPending }) { return "内容待补充" }
        if masteredCount == knowledgePoints.count, !knowledgePoints.isEmpty { return "已完成" }
        if knowledgePoints.contains(where: { ["learning", "practice"].contains($0.learningState) }) {
            return "进行中"
        }
        return "待学习"
    }
}

struct LearnBundle: Decodable, Equatable {
    let kpId: String
    let kpName: String
    let card: LearningKnowledgeCard?
    let slides: LearningSlideDeck?
    let simulations: [LearningSimulationContent]
    let progress: [String: LearnProgress]

    var consumedResourceCount: Int {
        progress.values.reduce(0) { $0 + $1.consumed }
    }

    var totalResourceCount: Int {
        progress.values.reduce(0) { $0 + $1.total }
    }
}

struct LearnProgress: Decodable, Equatable {
    let consumed: Int
    let total: Int
}

struct LearningKnowledgeCard: Decodable, Equatable {
    let contentId: String
    let kpId: String
    let kpName: String
    let title: String
    let sections: [LearningCardSection]
    let source: String
    let consumed: Bool
}

struct LearningCardSection: Decodable, Equatable {
    let type: String
    let title: String
    let content: LearningCardSectionContent
    let contentRendered: RenderedRichContent?

    var paneDictionary: [String: Any] {
        [
            "type": type,
            "title": title,
            "text": content.html ?? "",
            "rendered": contentRendered?.jsonObject ?? NSNull(),
            "content": content.paneDictionary,
        ]
    }
}

struct LearningCardSectionContent: Decodable, Equatable {
    let html: String?
    let latex: String?
    let variableTable: [LearningFormulaVariable]?
    let svg: String?
    let stem: String?
    let solution: String?
    let keyTakeaway: String?
    let items: [String]?

    var paneDictionary: [String: Any] {
        [
            "html": html ?? "",
            "latex": latex ?? "",
            "variable_table": (variableTable ?? []).map(\.paneDictionary),
            "svg": svg ?? "",
            "stem": stem ?? "",
            "solution": solution ?? "",
            "key_takeaway": keyTakeaway ?? "",
            "items": items ?? [],
        ]
    }
}

struct LearningFormulaVariable: Decodable, Equatable {
    let symbol: String
    let name: String
    let unit: String?

    var paneDictionary: [String: Any] {
        ["symbol": symbol, "name": name, "unit": unit ?? ""]
    }
}

struct LearningSlideDeck: Decodable, Equatable {
    let contentId: String
    let kpId: String
    let title: String
    let total: Int
    let consumed: Bool
}

struct LearningSimulationContent: Decodable, Equatable, Identifiable {
    let contentId: String
    let kpId: String
    let kpName: String
    let title: String
    let html: String
    let consumed: Bool

    var id: String { contentId }
}

struct LearningVideoRecommendationResponse: Decodable, Equatable {
    let kpId: String
    let kpName: String
    let query: String
    let items: [LearningVideoRecommendation]
    let experiment: LearningVideoRecommendation?
    let experiments: [LearningVideoRecommendation]?
    let fallback: Bool

    var experimentItems: [LearningVideoRecommendation] {
        if let experiments, !experiments.isEmpty {
            return experiments
        }
        return experiment.map { [$0] } ?? []
    }
}

struct LearningVideoRecommendation: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let url: String
    let uploader: String?
    let duration: String?
    let coverUrl: String?
    let source: String
    let category: String?
    let reason: String
    let matchFocus: String

    var categoryLabel: String {
        category ?? (source == "teacher_curated" ? "教师精选" : "相关讲解")
    }

    var uploaderLabel: String {
        uploader ?? (source == "bilibili_search" ? "B站搜索" : "B站")
    }

    /// No curated video yet: the item opens a Bilibili search instead of one video.
    var isSearchLink: Bool { source.hasSuffix("_search") }

    /// Search items arrive titled 「B站搜索：<知识点>」 or 「演示实验：…」; the card says it is a search instead.
    var displayTitle: String {
        for prefix in ["B站搜索：", "B站搜索:", "演示实验：", "演示实验:"] where title.hasPrefix(prefix) {
            return String(title.dropFirst(prefix.count))
        }
        return title
    }
}

struct LearningChatMessage: Codable, Equatable, Identifiable {
    let id: UUID
    let role: String
    let content: String

    init(id: UUID = UUID(), role: String, content: String) {
        self.id = id
        self.role = role
        self.content = content
    }

    enum CodingKeys: String, CodingKey {
        case role
        case content
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = UUID()
        role = try container.decode(String.self, forKey: .role)
        content = try container.decode(String.self, forKey: .content)
    }
}

struct LearnCompleteResponse: Decodable, Equatable {
    let success: Bool
    let masteryUpdate: [String: MasteryUpdate]
}

private func orderedUnique(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.filter { seen.insert($0).inserted }
}

private extension ISO8601DateFormatter {
    static let openPhysics: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static let openPhysicsFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
