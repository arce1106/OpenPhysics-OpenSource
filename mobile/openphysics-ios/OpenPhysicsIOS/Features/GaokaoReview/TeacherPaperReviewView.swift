import SwiftUI

struct TeacherPaperReviewView: View {
    @EnvironmentObject private var appSession: AppSession
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @ObservedObject var store: PracticeStore
    @StateObject private var tutorStore = ReviewStore()
    @State private var tutorMistake: ReviewMistake?
    @State private var correction: PaperGradingCorrection?

    var body: some View {
        VStack(spacing: isPhone ? 0 : 8) {
            if isPhone {
                phoneHeader
                if let score = store.session?.teacherPaper?.homeworkScore {
                    // The header has no room left: the score gets its own line under it.
                    HStack(spacing: 8) {
                        Text("得分 \(score.percent)/100").font(.subheadline.weight(.heavy).monospacedDigit())
                            .foregroundStyle(OpenPhysicsTheme.accent)
                        Text(score.note).font(.caption).foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding(.horizontal, 16).padding(.bottom, 8)
                }
                Divider()
            } else {
                HStack(spacing: 12) {
                    OpenPhysicsBackButton { dismiss() }
                    Text("\(store.workflow.title) · 答卷复盘").font(.headline)
                    Spacer()
                    if let score = store.session?.teacherPaper?.homeworkScore {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("得分 \(score.percent)/100").font(.headline.weight(.heavy).monospacedDigit())
                                .foregroundStyle(OpenPhysicsTheme.accent)
                            Text(score.note).font(.caption).foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }.padding(.horizontal, 16).padding(.vertical, 8)
            }
            if !store.message.isEmpty {
                Text(store.message).font(.callout).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16)
            }
            LearningReviewPane(payload: payload, onError: { store.message = $0 }, onAction: handleAction)
                .padding(.horizontal, isPhone ? 16 : 0)
                .padding(.vertical, isPhone ? 8 : 0)
        }
        .background(isPhone ? Color(uiColor: .systemBackground) : OpenPhysicsTheme.pageBackground)
        .openPhysicsPrimaryNavigationChrome()
        .sheet(item: $tutorMistake) { mistake in
            ReviewTutorSheet(store: tutorStore, mistake: mistake)
        }
        .confirmationDialog("确认纠正批改结果？", isPresented: Binding(
            get: { correction != nil }, set: { if !$0 { correction = nil } }
        ), titleVisibility: .visible) {
            if let correction {
                Button(correction.correct ? "实际答对了" : "实际仍需订正") {
                    guard let student = appSession.studentSession else { return }
                    Task {
                        await store.correctPaperGrading(student: student, questionId: correction.questionId,
                                                        correct: correction.correct, answer: correction.answer)
                    }
                }
            }
            Button("取消", role: .cancel) { correction = nil }
        }
        .onChange(of: tutorStore.requiresLogin || store.requiresLogin) { expired in
            if expired { appSession.logout(message: "登录已失效，请重新登录。") }
        }
    }

    private var phoneHeader: some View {
        ZStack {
            Text("答卷复盘")
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .padding(.horizontal, 80)
                .accessibilityLabel("\(store.workflow.title) · 答卷复盘")
                .accessibilityAddTraits(.isHeader)
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.left").font(.body.weight(.semibold))
                        .foregroundStyle(.primary)
                        .frame(width: 44, height: 44)
                        .modifier(PracticeHeaderCircle())
                }.buttonStyle(.plain).accessibilityLabel("返回")
                Spacer()
                Text("共 \(store.session?.questions.count ?? 0) 题")
                    .font(.footnote.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .background(Color(uiColor: .tertiarySystemFill), in: Capsule())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .background(.bar)
    }

    var payload: String {
        let items: [[String: Any]] = (store.session?.questions ?? []).compactMap { question in
            guard let result = store.results[question.id], let answerId = result.answerId else { return nil }
            let given = result.givenAnswer ?? store.answers[question.id] ?? result.extractedAnswer ?? ""
            return ["question": question.paneDictionary(), "answerId": answerId,
                    "givenAnswer": given,
                    "selectedOptions": question.options.filter { given.uppercased().contains($0.label.uppercased()) }.map(\.label),
                    "answerState": result.paneAnswerState,
                    "canCorrectGrading": !store.isCorrectingGrading,
                    "lessonVideo": result.lessonVideo.map { $0.paneDictionary as Any } ?? NSNull()]
        }
        let data = try? JSONSerialization.data(withJSONObject: ["mode": "teacher_paper_review", "paperItems": items])
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    private func handleAction(_ method: String, _ object: [String: Any]) {
        guard let questionId = object["questionId"] as? String,
              let question = store.session?.questions.first(where: { $0.id == questionId }),
              let result = store.results[questionId], let answerId = result.answerId else { return }
        if method == "onCorrectGrading", let correct = object["correct"] as? Bool {
            correction = PaperGradingCorrection(questionId: questionId, correct: correct,
                                                answer: object["correctedAnswer"] as? String ?? "")
        } else if method == "onOpenTutor" {
            tutorStore.prepareTutor(for: answerId)
            tutorMistake = ReviewMistake(answerId: answerId, questionId: questionId, stemText: question.stemText,
                stemRendered: question.stemRendered, questionType: question.questionType, options: question.options,
                images: question.images, givenAnswer: result.givenAnswer ?? store.answers[questionId],
                givenAnswerRendered: nil, correctAnswer: result.correctAnswer,
                correctAnswerRendered: result.correctAnswerRendered, explanation: result.explanation,
                explanationRendered: result.explanationRendered, misconception: nil,
                processGrading: result.processGrading, createdAt: nil, lessonVideo: result.lessonVideo)
        }
    }
}

private struct PaperGradingCorrection {
    let questionId: String
    let correct: Bool
    let answer: String
}
