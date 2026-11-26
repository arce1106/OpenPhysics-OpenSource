import Foundation

@MainActor
final class StudentClassesStore: ObservableObject {
    @Published private(set) var memberships: [StudentClassMembership] = []
    @Published private(set) var invitation: StudentClassInvitation?
    @Published private(set) var busy = false
    @Published private(set) var loaded = false
    @Published private(set) var message = ""
    @Published private(set) var sessionExpired = false
    @Published var studentName = ""
    /// The name the student's teachers see, as being corrected.
    @Published var newName = ""
    /// Set after a successful rename so the account screen can update the signed-in profile.
    @Published private(set) var renamedTo: String?
    @Published var code = "" {
        didSet {
            if code != oldValue { invitation = nil; previewedCode = nil; message = "" }
        }
    }

    private let api: APIClient
    private var token: String?
    private var generation = UUID()
    private var previewedCode: String?

    init(api: APIClient = APIClient()) { self.api = api }

    var normalizedCode: String { code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }
    var canPreview: Bool {
        !busy && normalizedCode.range(of: "^[A-Z0-9]{8}$", options: .regularExpression) != nil
    }
    var canJoin: Bool { !busy && Self.validName(studentName) }
    var canRename: Bool { !busy && Self.validName(newName) }

    static func validName(_ raw: String) -> Bool {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return !name.isEmpty && name.unicodeScalars.count <= 40
            && !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
    }

    // A new account/token invalidates all in-flight responses and invitation previews.
    func load(for student: StudentSession?) async {
        if token != student?.token {
            generation = UUID()
            token = student?.token
            memberships = []; invitation = nil; previewedCode = nil; code = ""; studentName = ""
            busy = false; loaded = false; message = ""; sessionExpired = false
        }
        guard let student else { return }
        await perform(for: student) {
            let result = try await self.api.studentClasses(for: student)
            return { self.memberships = result; self.loaded = true }
        }
    }

    func preview(for student: StudentSession) async {
        guard canPreview else { return }
        let requestedCode = normalizedCode
        invitation = nil; previewedCode = nil
        await perform(for: student) {
            let result = try await self.api.previewClassInvitation(requestedCode, for: student)
            return {
                guard self.normalizedCode == requestedCode else { return }
                self.invitation = result; self.previewedCode = requestedCode
            }
        }
    }

    func join(for student: StudentSession) async {
        guard canJoin, let invitation, !invitation.alreadyJoined,
              let previewedCode, previewedCode == normalizedCode else { return }
        let name = studentName.trimmingCharacters(in: .whitespacesAndNewlines)
        await perform(for: student) {
            let result = try await self.api.joinClass(code: previewedCode,
                disclosureVersion: invitation.disclosureVersion, studentName: name, for: student)
            return {
                self.memberships.removeAll { $0.id == result.id }
                self.memberships.append(result)
                self.loaded = true; self.code = ""; self.invitation = nil; self.previewedCode = nil
                self.message = "已加入班级"
            }
        }
    }

    func rename(for student: StudentSession) async {
        guard canRename else { return }
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        await perform(for: student) {
            let result = try await self.api.renameStudent(name, for: student)
            return {
                self.renamedTo = result.studentName
                self.message = "老师看到的姓名已改为 \(result.studentName)"
            }
        }
    }

    func leave(_ membership: StudentClassMembership, for student: StudentSession) async {
        guard memberships.contains(where: { $0.id == membership.id }) else { return }
        await perform(for: student) {
            try await self.api.leaveClass(membership, for: student)
            return {
                self.memberships.removeAll { $0.id == membership.id }
                self.invitation = nil; self.previewedCode = nil
                self.message = "已退出班级"
            }
        }
    }

    private func perform(for student: StudentSession,
                         operation: () async throws -> (() -> Void)) async {
        guard !busy, token == student.token else { return }
        let requestGeneration = generation
        busy = true; message = ""
        defer { if generation == requestGeneration { busy = false } }
        do {
            let apply = try await operation()
            guard generation == requestGeneration, !Task.isCancelled else { return }
            apply()
        } catch {
            guard generation == requestGeneration, !Task.isCancelled else { return }
            sessionExpired = (error as? APIError)?.isUnauthorized == true
            message = error.localizedDescription
            // Failed joins must be previewed again: the invitation may have changed.
            invitation = nil; previewedCode = nil
        }
    }
}
