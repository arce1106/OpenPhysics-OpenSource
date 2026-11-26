import AVKit
import SwiftUI

struct LessonVideoSelection: Identifiable {
    let questionId: String
    let answerId: Int
    var id: String { "\(questionId):\(answerId)" }
}

/// Keeps the original answer sheet mounted while a question's video is open.
struct LearningReviewPane: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @ScaledMetric(relativeTo: .body) private var textScale: CGFloat = 1
    let payload: String
    var onToggleSelection: (Int) -> Void = { _ in }
    var onOpenMistake: (Int) -> Void = { _ in }
    var onOpenReview: (Int) -> Void = { _ in }
    let onError: (String) -> Void
    var onAction: (String, [String: Any]) -> Void = { _, _ in }
    private var presentedPayload: String {
        guard isPhone, let data = payload.data(using: .utf8),
              var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return payload }
        object["presentation"] = "phone"
        object["textScale"] = textScale
        guard let encoded = try? JSONSerialization.data(withJSONObject: object),
              let result = String(data: encoded, encoding: .utf8) else { return payload }
        return result
    }

    @State private var imageSelection: OpenPhysicsImageSelection?
    @State private var video: LessonVideoSelection?

    var body: some View {
        ReviewPaneWebView(payload: presentedPayload, onToggleSelection: onToggleSelection,
                          onOpenMistake: onOpenMistake, onOpenReview: onOpenReview,
                          onError: onError) { method, object in
            if method == "onOpenLessonVideo",
               let questionId = object["questionId"] as? String,
               let answerId = object["answerId"] as? Int {
                video = LessonVideoSelection(questionId: questionId, answerId: answerId)
            } else if method == "onOpenImage", let source = object["src"] as? String,
                      let url = URL(string: source), ["http", "https"].contains(url.scheme ?? "") {
                imageSelection = OpenPhysicsImageSelection(url: url)
            } else {
                onAction(method, object)
            }
        }
        .sheet(item: $imageSelection) { OpenPhysicsImagePreview(url: $0.url) }
        .sheet(item: $video) { selection in
            LessonVideoView(selection: selection)
        }
    }
}

struct LessonVideoView: View {
    @EnvironmentObject private var appSession: AppSession
    @Environment(\.dismiss) private var dismiss
    let selection: LessonVideoSelection
    @State private var player: AVPlayer?
    @State private var itemObservation: NSKeyValueObservation?
    @State private var title = "视频讲解"
    @State private var message = ""
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                if let player {
                    VideoPlayer(player: player)
                } else if isLoading {
                    ProgressView("正在加载视频…")
                }
                if !message.isEmpty {
                    Text(message).foregroundStyle(.secondary)
                    Button("重新加载") { Task { await load() } }
                        .disabled(isLoading)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { dismiss() } } }
        }
        .task(id: selection.id) { await load() }
        .onDisappear { itemObservation = nil; player?.pause(); player?.replaceCurrentItem(with: nil) }
        .onReceive(NotificationCenter.default.publisher(for: .AVPlayerItemFailedToPlayToEndTime)) { notice in
            guard let item = notice.object as? AVPlayerItem, item === player?.currentItem else { return }
            message = "视频暂时无法播放，请重新加载。"
        }
    }

    @MainActor private func load() async {
        guard let student = appSession.studentSession, !isLoading else { return }
        isLoading = true
        message = ""
        itemObservation = nil
        player?.pause()
        defer { isLoading = false }
        do {
            // Resolve at playback time: the server verifies ownership and whole-paper completion.
            let video = try await APIClient().lessonVideo(for: student, questionId: selection.questionId,
                                                        answerId: selection.answerId)
            guard !Task.isCancelled, appSession.studentSession?.token == student.token else { return }
            guard let url = URL(string: video.videoUrl, relativeTo: AppConfig.apiBaseURL)?.absoluteURL,
                  url.host == AppConfig.apiBaseURL.host, url.scheme == AppConfig.apiBaseURL.scheme,
                  url.port == AppConfig.apiBaseURL.port else { throw APIError.invalidURL }
            title = video.title
            let item = AVPlayerItem(url: url)
            itemObservation = item.observe(\.status, options: [.new]) { observed, _ in
                guard observed.status == .failed else { return }
                Task { @MainActor in
                    guard observed === player?.currentItem else { return }
                    message = "视频暂时无法播放，请重新加载。"
                }
            }
            player = AVPlayer(playerItem: item)
            player?.play()
        } catch {
            if let error = error as? APIError, error.isUnauthorized {
                appSession.logout(message: "登录已失效，请重新登录。")
                dismiss()
            } else {
                message = error.localizedDescription
            }
        }
    }
}
