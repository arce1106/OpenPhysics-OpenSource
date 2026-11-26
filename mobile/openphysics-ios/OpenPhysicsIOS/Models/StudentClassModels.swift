import Foundation

struct StudentClassMembership: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let grade: String?
    let teacherName: String
    let studentNumber: String?
    let archived: Bool
    let teacherActive: Bool

    var teacherLabel: String {
        [teacherName, studentNumber.map { "学号 \($0)" }].compactMap { $0 }.joined(separator: " · ")
    }
}

struct StudentClassInvitation: Decodable {
    let membership: StudentClassMembership
    let alreadyJoined: Bool
    let disclosureVersion: String
    /// What joining shares with the class teacher; shown before the student agrees.
    let disclosure: String

    private enum CodingKeys: String, CodingKey { case alreadyJoined, disclosureVersion, disclosure }

    init(from decoder: Decoder) throws {
        membership = try StudentClassMembership(from: decoder)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        alreadyJoined = try values.decode(Bool.self, forKey: .alreadyJoined)
        disclosureVersion = try values.decode(String.self, forKey: .disclosureVersion)
        disclosure = try values.decodeIfPresent(String.self, forKey: .disclosure) ?? ""
    }
}


struct StudentNameResult: Decodable {
    let studentName: String
}

private struct StudentNameRequest: Encodable {
    let studentName: String
}

private struct ClassInvitationRequest: Encodable {
    let code: String
    var disclosureVersion: String? = nil
    var studentName: String? = nil
}

extension APIClient {
    func studentClasses(for student: StudentSession) async throws -> [StudentClassMembership] {
        try await request(path: "classes", token: student.token, requiresAI: false)
    }

    func previewClassInvitation(_ code: String, for student: StudentSession) async throws -> StudentClassInvitation {
        try await request(path: "class-invitations/preview", method: "POST",
                          body: ClassInvitationRequest(code: code), token: student.token, requiresAI: false)
    }

    func joinClass(code: String, disclosureVersion: String, studentName: String, for student: StudentSession) async throws -> StudentClassMembership {
        try await request(path: "classes/join", method: "POST",
                          body: ClassInvitationRequest(code: code, disclosureVersion: disclosureVersion, studentName: studentName),
                          token: student.token, requiresAI: false)
    }

    /// Corrects the real name the student's teachers see.
    func renameStudent(_ name: String, for student: StudentSession) async throws -> StudentNameResult {
        try await request(path: "student-name", method: "PUT", body: StudentNameRequest(studentName: name),
                          token: student.token, requiresAI: false)
    }

    /// Before signing in: the class, its teacher and what joining shares.


    func leaveClass(_ membership: StudentClassMembership, for student: StudentSession) async throws {
        let _: NoContentResponse = try await request(path: "classes/\(membership.id)", method: "DELETE",
                                                     token: student.token, requiresAI: false)
    }
}
