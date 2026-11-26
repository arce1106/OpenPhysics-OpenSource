import SwiftUI

@MainActor
final class AccountFormState: ObservableObject {

    @Published var captcha: AuthCaptcha?
    @Published var captchaAnswer = ""
    @Published var captchaRequired = false
    @Published var message = ""
    @Published var busy = false
    @Published var sessionExpired = false

    let api: APIClient

    init(api: APIClient = APIClient()) { self.api = api }


    func refreshCaptcha() async {
        captchaAnswer = ""
        do { captcha = try await api.authCaptcha() }
        catch { captcha = nil; message = error.localizedDescription }
    }

    func withCaptcha(_ body: AccountRequest) -> AccountRequest {
        var result = body
        if captchaRequired {
            result.captchaId = captcha?.challengeId
            result.captchaAnswer = captchaAnswer.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return result
    }


    func run(purpose: String = "", _ operation: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        message = ""
        defer { busy = false }
        do { try await operation() }
        catch {
            sessionExpired = (error as? APIError)?.isUnauthorized == true
            let failure = error.localizedDescription
            if case let APIError.authentication(_, _, required, _) = error {
                if required { captchaRequired = true }
            }
            if captchaRequired { await refreshCaptcha() }
            message = failure
        }
    }
}

struct AccountCaptchaField: View {
    @ObservedObject var form: AccountFormState
    var body: some View {
        HStack {
            TextField("图形验证码", text: $form.captchaAnswer).openPhysicsFormField()
                .autocorrectionDisabled().textInputAutocapitalization(.never)
            Button {
                Task { await form.refreshCaptcha() }
            } label: {
                if let encoded = form.captcha?.imageBase64.split(separator: ",").last,
                   let data = Data(base64Encoded: String(encoded)), let image = UIImage(data: data) {
                    Image(uiImage: image).resizable().scaledToFit().frame(width: 112, height: 40)
                } else { Text("刷新验证码").frame(height: 40) }
            }.disabled(form.busy)
        }
    }
}


private struct ProminentFormFieldsKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// Login: taller, softer input boxes. Elsewhere fields keep the standard rounded border.
    var openPhysicsProminentFormFields: Bool {
        get { self[ProminentFormFieldsKey.self] }
        set { self[ProminentFormFieldsKey.self] = newValue }
    }
}

/// The system rounded border adds almost no vertical padding, so on the login card the
/// fields read as thin strips; there they get a 48pt (iPhone) or 52pt (iPad) box instead.
private struct OpenPhysicsFormField: ViewModifier {
    @Environment(\.openPhysicsProminentFormFields) private var prominent
    @Environment(\.openPhysicsIsPhone) private var isPhone

    func body(content: Content) -> some View {
        if prominent {
            content
                .textFieldStyle(.plain)
                .font(isPhone ? .body : .title3)
                .padding(.horizontal, isPhone ? 14 : 16)
                .frame(maxWidth: .infinity, minHeight: isPhone ? 48 : 52, alignment: .leading)
                .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color(uiColor: .separator).opacity(0.55), lineWidth: 1)
                }
        } else {
            content.textFieldStyle(.roundedBorder)
        }
    }
}

extension View {
    func openPhysicsFormField() -> some View {
        modifier(OpenPhysicsFormField())
    }
}
