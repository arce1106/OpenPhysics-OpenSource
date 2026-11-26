import Foundation

@MainActor
final class GaokaoReviewStore: ObservableObject {
    static let catalogCode = "gaokao_review"

    @Published private(set) var catalog: LearningCatalogData?
    @Published private(set) var overview: LearningCatalogTopicOverview?
    @Published private(set) var isLoadingCatalog = false
    @Published private(set) var isLoadingOverview = false
    @Published private(set) var catalogMessage = ""
    @Published private(set) var overviewMessage = ""
    @Published private(set) var requiresLogin = false
    @Published var expandedBlockId: String?
    @Published private(set) var selectedTopicId: String?

    private let apiClient: APIClient

    init(apiClient: APIClient = APIClient()) {
        self.apiClient = apiClient
    }

    var selectedTopic: LearningCatalogNode? {
        guard let selectedTopicId else { return nil }
        return catalog?.topic(id: selectedTopicId)
    }

    func load(student: StudentSession, force: Bool = false) async {
        guard !isLoadingCatalog else { return }
        if catalog != nil, !force { return }
        isLoadingCatalog = true
        catalogMessage = ""
        requiresLogin = false
        defer { isLoadingCatalog = false }

        do {
            catalog = try await apiClient.learningCatalog(
                for: student,
                catalogCode: Self.catalogCode
            )
            if selectedTopic == nil {
                let resume = try? await apiClient.learningCatalogResume(for: student, catalogCode: Self.catalogCode)
                // A manual choice made while history loads takes precedence.
                guard selectedTopic == nil else { return }
                let entries = (catalog?.knowledgeBlocks ?? []).flatMap { block in
                    block.topics.map { (blockId: block.id, topic: $0) }
                }
                // Missing, unavailable, or deleted history falls back to the first topic.
                if let entry = entries.first(where: { $0.topic.id == resume?.nodeId }) ?? entries.first {
                    expandedBlockId = entry.blockId
                    await selectTopic(entry.topic, student: student)
                } else {
                    selectedTopicId = nil
                    expandedBlockId = nil
                    overview = nil
                    isLoadingOverview = false
                }
            }
        } catch {
            handle(error, fallback: "高考复习目录加载失败，请稍后重试。")
        }
    }

    func toggleBlock(_ block: LearningCatalogNode) {
        expandedBlockId = expandedBlockId == block.id ? nil : block.id
    }

    func selectTopic(_ topic: LearningCatalogNode, student: StudentSession) async {
        selectedTopicId = topic.id
        overview = nil
        await loadOverview(student: student, topicId: topic.id)
    }

    func refreshSelected(student: StudentSession) async {
        guard let selectedTopicId else { return }
        await loadOverview(student: student, topicId: selectedTopicId)
    }

    func acceptOverview(_ updatedOverview: LearningCatalogTopicOverview) {
        guard updatedOverview.nodeId == selectedTopicId else { return }
        overview = updatedOverview
        overviewMessage = ""
    }

    private func loadOverview(student: StudentSession, topicId: String) async {
        isLoadingOverview = true
        overviewMessage = ""
        requiresLogin = false
        defer {
            if selectedTopicId == topicId {
                isLoadingOverview = false
            }
        }

        do {
            let loaded = try await apiClient.learningCatalogTopicOverview(
                for: student,
                catalogCode: Self.catalogCode,
                nodeId: topicId
            )
            guard selectedTopicId == topicId else { return }
            overview = loaded
        } catch {
            guard selectedTopicId == topicId else { return }
            overview = nil
            handle(error, fallback: "专题学习状态加载失败，请稍后重试。", overview: true)
        }
    }

    private func handle(
        _ error: Error,
        fallback: String,
        overview: Bool = false
    ) {
        if let apiError = error as? APIError, apiError.isUnauthorized {
            requiresLogin = true
        }
        let text = (error as? LocalizedError)?.errorDescription ?? fallback
        if overview {
            overviewMessage = text
        } else {
            catalogMessage = text
        }
    }
}
