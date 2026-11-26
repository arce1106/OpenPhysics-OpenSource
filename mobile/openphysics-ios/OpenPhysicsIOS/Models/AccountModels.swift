import Foundation


struct AccountCredentials: Decodable {
    let username: String
    let maskedPhone: String?
    let hasPassword: Bool
    let usernameChangeLimit: Int
    let usernameChangeWindowDays: Int
    let usernameChangesRemaining: Int
    let usernameNextChangeAt: String?
}

struct AuthCaptcha: Decodable {
    let challengeId: String
    let imageBase64: String
}


struct AccountMutation: Decodable {
    let changed: Bool?
    let verified: Bool?
    let accessToken: String?
    let student: StudentPublic?

    var session: StudentSession? {
        guard let accessToken, let student else { return nil }
        return student.session(token: accessToken)
    }
}

struct AccountDeletionResult: Decodable {
    let deleted: Bool
}

struct AccountDeletionRequest: Encodable {
    let confirmed: Bool
    let currentPassword: String?
}


// Optional fields are omitted, keeping each proof scoped to its endpoint.
struct AccountRequest: Encodable {
    var username: String? = nil
    var password: String? = nil

    var captchaId: String? = nil
    var captchaAnswer: String? = nil

    var renewSession: Bool? = nil
    var currentPassword: String? = nil
    var newPassword: String? = nil


}

extension APIClient {
    func deleteAccount(body: AccountDeletionRequest, for student: StudentSession) async throws -> AccountDeletionResult {
        try await request(path: "auth/account-deletion", method: "POST", body: body, token: student.token)
    }

    func authCaptcha() async throws -> AuthCaptcha {
        try await request(path: "auth/captcha", token: nil)
    }
    func accountCredentials(for student: StudentSession) async throws -> AccountCredentials {
        try await request(path: "auth/account-credentials", token: student.token)
    }
    func authenticate(path: String, body: AccountRequest) async throws -> StudentSession {
        try await authenticateWithOutcome(path: path, body: body).session
    }
    func authenticateWithOutcome(path: String, body: AccountRequest) async throws -> StudentLoginResponse {
        try await request(path: "auth/\(path)", method: "POST", body: body, token: nil)
    }

    func changeAccount(path: String, body: AccountRequest, student: StudentSession? = nil) async throws -> AccountMutation {
        try await request(path: "auth/\(path)", method: "POST", body: body, token: student?.token)
    }
}
