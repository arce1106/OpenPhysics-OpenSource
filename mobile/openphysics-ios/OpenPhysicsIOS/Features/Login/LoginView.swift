import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var appSession: AppSession
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @StateObject private var form = AccountFormState()
    @State private var username = ""
    @State private var password = ""

    @MainActor init(form: AccountFormState? = nil) {
        _form = StateObject(wrappedValue: form ?? AccountFormState())
    }

    var body: some View {
        ZStack {
            OpenPhysicsTheme.pageBackground.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Label("OpenPhysics", systemImage: "atom").font(.largeTitle.bold())
                    Text("学生登录").font(.title2.bold())
                    TextField("账号", text: $username).openPhysicsFormField().textContentType(.username)
                    SecureField("密码", text: $password).openPhysicsFormField().textContentType(.password)
                    if form.captchaRequired { AccountCaptchaField(form: form) }
                    if !form.message.isEmpty { Text(form.message).foregroundStyle(.red) }
                    Button(action: submit) {
                        HStack { if form.busy { ProgressView() }; Text(form.busy ? "登录中…" : "登录") }
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }.buttonStyle(.borderedProminent).tint(OpenPhysicsTheme.accent)
                        .disabled(form.busy || username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
                    Text("账号开通或忘记密码，请联系本部署的管理员。")
                        .font(.footnote).foregroundStyle(.secondary)
                    Text(PrivacyPolicy.loginAgreementNotice).font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("login.agreementNotice")
                }
                .textFieldStyle(.roundedBorder).autocorrectionDisabled().textInputAutocapitalization(.never)
                .environment(\.openPhysicsProminentFormFields, true)
                .padding(isPhone ? 24 : 36).frame(maxWidth: 520)
                .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 24))
                .padding(24)
            }
        }
    }
    private func submit() {
        guard !form.busy else { return }
        Task { await form.run {
            let body = AccountRequest(username: username.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            let outcome = try await form.api.authenticateWithOutcome(path: "login", body: form.withCaptcha(body))
            let receipt = try await form.api.recordLoginPrivacyConsent(termsAccepted: true, aiAccepted: false, token: outcome.session.token)
            try await appSession.acceptAuthentication(outcome.session, privacyReceipt: receipt)
        } }
    }
}
