import Foundation

struct StudentSession: Codable, Equatable {
    let token: String
    let studentID: String
    let username: String
    let displayName: String
    let accountStatus: String

    var displayLabel: String {
        if !displayName.isEmpty { return displayName }
        if !username.isEmpty { return username }
        return studentID
    }
    func withAccountActive(_ active: Bool) -> StudentSession {
        StudentSession(token: token, studentID: studentID, username: username,
                       displayName: displayName, accountStatus: active ? "active" : "disabled")
    }
}

enum StudentAccessPolicy {
    static let accountRequiredMessage = "账号不可用，请重新登录或联系部署管理员。"
    static func hasFullLearningAccess(_ student: StudentSession?, now: Date = Date()) -> Bool {
        guard let student else { return false }
        return student.accountStatus.isEmpty || student.accountStatus == "active"
    }
    static func canUseKnowledgePoint(_ point: SyncKnowledgePoint, for student: StudentSession?, now: Date = Date()) -> Bool {
        hasFullLearningAccess(student, now: now)
    }
    static func accountStatusText(_ student: StudentSession?, now: Date = Date()) -> String {
        hasFullLearningAccess(student, now: now) ? "完整学习功能可用" : "账号不可用"
    }
}

extension Notification.Name {
    static let studentAccessRefreshRequested = Notification.Name("OpenPhysics.studentAccessRefreshRequested")
}
struct StudentPublic: Decodable {
    let id: String
    let username: String
    let displayName: String
    let status: String
    func session(token: String) -> StudentSession {
        StudentSession(token: token, studentID: id, username: username, displayName: displayName, accountStatus: status)
    }
}

struct StudentLoginResponse: Decodable {
    let accessToken: String
    let student: StudentPublic
    /// Present when the sign-in carried a teacher's invitation.
    var joinedClass: JoinedClassSummary?
    var classJoinError: String?

    var classNotice: String {
        if let joined = joinedClass {
            let number = joined.studentNumber.map { "，学号 \($0)" } ?? ""
            return "已加入\(joined.name)\(number)。"
        }
        if let error = classJoinError, !error.isEmpty { return "已登录，但未能加入班级：\(error)" }
        return ""
    }
}

struct JoinedClassSummary: Decodable {
    let id: String
    let name: String
    let teacherName: String
    let studentNumber: String?
}

extension StudentLoginResponse {
    var session: StudentSession {
        student.session(token: accessToken)
    }
}
