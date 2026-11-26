import Foundation

struct DashboardData: Decodable, Equatable {
    let diagnosis: DiagnosisSummary
    let plan: PlanRecommendation?
    let motivation: MotivationPanel
}

struct DiagnosisSummary: Decodable, Equatable {
    let overallMastery: Double
    let masteredCount: Int
    let inProgressCount: Int
    let lockedCount: Int
    let weakPoints: [WeakPoint]
}

struct WeakPoint: Decodable, Equatable, Identifiable {
    let kpId: String
    let kpName: String
    let mastery: Double

    var id: String { kpId }
}

struct PlanRecommendation: Decodable, Equatable {
    let kpId: String
    let kpName: String
    let mastery: Double
    let reason: String
    let estimatedQuestions: Int
    let estimatedMinutes: Int
}

struct MotivationPanel: Decodable, Equatable {
    let streakDays: Int
    let weeklyKpsMastered: Int
    let mistakeBacklogCount: Int
    let nextMilestone: String?
}

struct DailyLoopRing: Decodable, Equatable {
    let key: String
    let label: String
    let completed: Bool
    let current: Int
    let actualCurrent: Int
    let target: Int
    let overflow: Int
    let autoCompleted: Bool
    let pendingMistakes: Int?
    let evidence: String

    var progress: Double {
        guard target > 0 else { return 0 }
        return min(Double(current) / Double(target), 1)
    }
}

struct DailyLoopRings: Decodable, Equatable {
    let practice: DailyLoopRing
    let review: DailyLoopRing
}

struct DailyLearningLoop: Decodable, Equatable {
    let date: String
    let isEffectiveDay: Bool
    let isHighQualityDay: Bool
    let rings: DailyLoopRings
    let summary: String
    let nextAction: String
    let streakDays: Int
}

struct DailyLearningLoopDay: Decodable, Equatable {
    let date: String
    let isEffectiveDay: Bool
    let isHighQualityDay: Bool
    let rings: DailyLoopRings
    let summary: String
    let nextAction: String
}

struct DailyLearningLoopHistorySummary: Decodable, Equatable {
    let practiceTotal: Int
    let reviewTotal: Int
    let practiceClosedDays: Int
    let reviewClosedDays: Int
    let dualClosedDays: Int
    let effectiveDays: Int
}

struct DailyLearningLoopHistory: Decodable, Equatable {
    let startDate: String
    let endDate: String
    let practiceTarget: Int
    let reviewTarget: Int
    let summary: DailyLearningLoopHistorySummary
    let days: [DailyLearningLoopDay]

    func mergingToday(_ today: DailyLearningLoop) -> DailyLearningLoopHistory {
        guard today.date >= startDate, today.date <= endDate else {
            return self
        }

        let todayDay = DailyLearningLoopDay(
            date: today.date,
            isEffectiveDay: today.isEffectiveDay,
            isHighQualityDay: today.isHighQualityDay,
            rings: today.rings,
            summary: today.summary,
            nextAction: today.nextAction
        )
        var mergedDays = days.map { day in
            day.date == today.date ? todayDay : day
        }
        if !mergedDays.contains(where: { $0.date == today.date }) {
            mergedDays.append(todayDay)
        }
        mergedDays.sort { $0.date < $1.date }

        return DailyLearningLoopHistory(
            startDate: startDate,
            endDate: endDate,
            practiceTarget: practiceTarget,
            reviewTarget: reviewTarget,
            summary: DailyLearningLoopHistorySummary(
                practiceTotal: mergedDays.reduce(0) {
                    $0 + $1.rings.practice.actualCurrent
                },
                reviewTotal: mergedDays.reduce(0) {
                    $0 + $1.rings.review.actualCurrent
                },
                practiceClosedDays: mergedDays.filter {
                    $0.rings.practice.completed
                }.count,
                reviewClosedDays: mergedDays.filter {
                    $0.rings.review.completed
                }.count,
                dualClosedDays: mergedDays.filter(\.isHighQualityDay).count,
                effectiveDays: mergedDays.filter(\.isEffectiveDay).count
            ),
            days: mergedDays
        )
    }
}

struct GrowthReportData: Decodable, Equatable, Identifiable {
    struct Metrics: Decodable, Equatable {
        let totalAnswers: Int?
        let correctAnswers: Int?
        let correctRate: String?
        let mistakesCorrected: Int?
        let weeklyXp: Int?
        let masteredKps: [String]?
        let weakKps: [String]?
    }

    let id: String
    let summary: String
    let metrics: Metrics?
    let startDate: String?
    let endDate: String?
    let createdAt: String?
}

struct GrowthReportResponse: Decodable, Equatable {
    let report: GrowthReportData?
}

extension JSONDecoder {
    static var openPhysics: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

extension JSONEncoder {
    static var openPhysics: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }
}
