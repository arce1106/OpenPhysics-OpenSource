import SwiftUI

struct AccountView: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @EnvironmentObject private var appSession: AppSession
    @EnvironmentObject private var privacy: PrivacyConsentCenter
    @StateObject private var form = AccountFormState()
    @StateObject private var classes: StudentClassesStore
    @State private var settings: AccountCredentials?
    @State private var editor: Editor?
    @State private var username = ""
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmation = ""

    @State private var showsLogout = false
    @State private var showsAccountDeletion = false
    private enum Editor { case username, password }

    @MainActor init(form: AccountFormState? = nil) {
        let resolvedForm = form ?? AccountFormState()
        _form = StateObject(wrappedValue: resolvedForm)
        _classes = StateObject(wrappedValue: StudentClassesStore(api: resolvedForm.api))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !isPhone {
                    // No refresh button: the page reloads itself on open and after each change.
                    HStack(spacing: 12) {
                        OpenPhysicsSidebarRevealButton()
                        Text("个人中心").font(.title3.weight(.semibold))
                        Spacer(minLength: 12)
                        if form.busy { ProgressView() }
                    }
                    .padding(.horizontal, 20)
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                    .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(Color(uiColor: .separator).opacity(0.24), lineWidth: 1)
                    }
                }
                if isPhone {
                    phoneProfile
                } else {
                OpenPhysicsAdaptiveStack(spacing: 8) {
                    Image(systemName: "person.crop.circle.fill").font(.title).foregroundStyle(OpenPhysicsTheme.accent)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(appSession.studentSession?.displayLabel ?? "学生").font(.headline)
                        Text(StudentAccessPolicy.accountStatusText(appSession.studentSession))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                }.padding(16).background(.background, in: RoundedRectangle(cornerRadius: 14))
                }
                if let settings, isPhone {
                    // Phone: the three credentials read as one "账号与安全" group, editors open below it.
                    Text("账号与安全").font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 4).padding(.top, 4)
                    VStack(spacing: 0) {
                        phoneCredentialRow("用户名", value: settings.username, action: "修改", target: .username,
                                           enabled: settings.usernameChangesRemaining > 0)
                        Divider().padding(.leading, 16)
                        phoneCredentialRow("密码", value: settings.hasPassword ? "已设置" : "尚未设置", action: settings.hasPassword ? "修改" : "设置", target: .password)
                        Divider().padding(.leading, 16)

                    }
                    .background(OpenPhysicsTheme.cardBackground, in: RoundedRectangle(cornerRadius: 16))
                    if settings.usernameChangesRemaining == 0 {
                        Text("\(settings.usernameChangeWindowDays)天内的\(settings.usernameChangeLimit)次修改机会已用完。" +
                             (settings.usernameNextChangeAt.map { "下次可修改：\($0)" } ?? ""))
                            .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 4)
                    }
                    if editor == .username { usernameEditor(settings) }
                    if editor == .password { passwordEditor(settings) }


                } else if let settings {
                    // iPad: the same 「账号与安全」 group as iPhone instead of three separate full-width cards.
                    Text("账号与安全").font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 4).padding(.top, 4)
                    VStack(spacing: 0) {
                        accountRow("用户名", value: settings.username, action: "修改", target: .username,
                                   enabled: settings.usernameChangesRemaining > 0)
                        Divider().padding(.leading, 16)
                        accountRow("密码", value: settings.hasPassword ? "已设置" : "尚未设置", action: settings.hasPassword ? "修改" : "设置", target: .password)
                        Divider().padding(.leading, 16)

                    }
                    .background(OpenPhysicsTheme.cardBackground, in: RoundedRectangle(cornerRadius: 14))
                    if settings.usernameChangesRemaining == 0 {
                        Text("\(settings.usernameChangeWindowDays)天内的\(settings.usernameChangeLimit)次修改机会已用完。" +
                             (settings.usernameNextChangeAt.map { "下次可修改：\($0)" } ?? ""))
                            .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 4)
                    }
                    if editor == .username { usernameEditor(settings) }
                    if editor == .password { passwordEditor(settings) }


                } else if form.busy { ProgressView("正在加载账号…") }
                if !form.message.isEmpty { Text(form.message).font(.callout).foregroundStyle(.secondary) }
                if let student = appSession.studentSession {
                    StudentClassesView(store: classes, student: student) {
                        await appSession.refreshStudentSession()
                        await appSession.refreshDashboard()
                    }
                    .disabled(form.busy)
                    .id(student.token)
                }
                if isPhone {
                    OpenPhysicsPhoneGroup {
                        NavigationLink { PracticeHistoryView(scope: .all) } label: {
                            OpenPhysicsPhoneActionRow(title: "练习记录", detail: "查看作答与批改结果")
                        }.buttonStyle(.plain)
                        Divider().padding(.leading, 16)
                        Button { privacy.presentAI(from: .main) } label: {
                            OpenPhysicsPhoneActionRow(title: "隐私与 AI 设置", detail: "管理 AI 辅助学习和隐私选项")
                        }.buttonStyle(.plain).accessibilityIdentifier("account.privacy")
                        Divider().padding(.leading, 16)
                        Button(role: .destructive) { showsAccountDeletion = true } label: {
                            HStack {
                                Text("注销账号").font(.callout).foregroundStyle(.red)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                            .padding(.horizontal, 16)
                            .frame(maxWidth: .infinity, minHeight: 56)
                            .contentShape(Rectangle())
                        }.buttonStyle(.plain).disabled(classes.busy).accessibilityIdentifier("account.delete")
                    }
                } else {
                    tabletPrivacySettings
                }
                Button(role: .destructive) { showsLogout = true } label: {
                    Text("退出登录")
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.red)
                .background(OpenPhysicsTheme.cardBackground, in: RoundedRectangle(cornerRadius: 14))
                .disabled(form.busy || classes.busy)
                .padding(.top, 18)
                .accessibilityIdentifier("account.logout")
            }.padding(16).frame(maxWidth: isPhone ? 1040 : 720)
                .frame(maxWidth: .infinity)
        }
        .background(OpenPhysicsTheme.pageBackground).openPhysicsPrimaryNavigationChrome("我的")
        .openPhysicsPhoneRefresh("刷新账号", isRefreshing: form.busy || classes.busy) { await refreshAccount() }
        .openPhysicsPhonePullToRefresh { await refreshAccount() }
        .sheet(isPresented: $showsAccountDeletion) {
            AccountDeletionView().environmentObject(appSession)
        }
        .task { await reload() }
        .task(id: appSession.studentSession?.token) { await classes.load(for: appSession.studentSession) }
        .onChange(of: classes.sessionExpired) { expired in
            if expired { appSession.logout(message: "登录已失效，请重新登录。") }
        }
        .onChange(of: form.sessionExpired) { expired in
            if expired { appSession.logout(message: "登录已失效，请重新登录。") }
        }
        .alert("退出登录？", isPresented: $showsLogout) {
            Button("取消", role: .cancel) {}
            Button("退出登录", role: .destructive) { appSession.requestLeavingPractice { appSession.logout() } }
        }
    }

    private var tabletPrivacySettings: some View {
        VStack(spacing: 0) {
            Button { privacy.presentAI(from: .main) } label: {
                tabletSettingsRow("隐私与 AI 设置", detail: "管理 AI 辅助学习和隐私选项")
            }
            .buttonStyle(.plain).accessibilityIdentifier("account.privacy")
            Divider().padding(.horizontal, 16)
            Button(role: .destructive) { showsAccountDeletion = true } label: {
                tabletSettingsRow("注销账号", detail: "查看注销说明与确认步骤", color: .red)
            }
            .buttonStyle(.plain).disabled(classes.busy).accessibilityIdentifier("account.delete")
        }
        .background(OpenPhysicsTheme.cardBackground, in: RoundedRectangle(cornerRadius: 14))
    }

    private func tabletSettingsRow(_ title: String, detail: String, color: Color = .primary) -> some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.body).foregroundStyle(color)
                Text(detail).font(.footnote).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .contentShape(Rectangle())
        .multilineTextAlignment(.leading)
    }

    private var phoneProfile: some View {
        HStack {
            HStack(spacing: 14) {
                Image(systemName: "person.crop.circle.fill").font(.system(size: 38))
                    .foregroundStyle(OpenPhysicsTheme.accent)
                VStack(alignment: .leading, spacing: 5) {
                    Text(appSession.studentSession?.displayLabel ?? "学生").font(.headline).foregroundStyle(.primary)
                    Text(StudentAccessPolicy.accountStatusText(appSession.studentSession) + " · 账号状态")
                        .font(.footnote).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }.padding(16).frame(maxWidth: .infinity, minHeight: 84)
                .background(OpenPhysicsTheme.cardBackground, in: RoundedRectangle(cornerRadius: 16))
        }.buttonStyle(.plain).accessibilityIdentifier("account.profile")
    }

    private func phoneCredentialRow(_ title: String, value: String, action: String, target: Editor, enabled: Bool = true) -> some View {
        HStack(spacing: 12) {
            Text(title).frame(width: 52, alignment: .leading)
            Text(value).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button(editor == target ? "收起" : action) { open(editor == target ? nil : target) }
                .frame(minHeight: 44).fixedSize(horizontal: true, vertical: false).disabled(form.busy || classes.busy || !enabled)
        }.font(.callout).padding(.horizontal, 16).padding(.vertical, 4)
    }

    @ViewBuilder private func accountRow(_ title: String, value: String, action: String, target: Editor, enabled: Bool = true) -> some View {
        if isPhone {
            HStack(spacing: 12) {
                Text(title).frame(width: 52, alignment: .leading)
                Text(value).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Button(editor == target ? "收起" : action) { open(editor == target ? nil : target) }
                    .frame(minHeight: 44).fixedSize(horizontal: true, vertical: false).disabled(form.busy || classes.busy || !enabled)
            }.font(.callout).padding(.horizontal, 16).padding(.vertical, 6)
                .background(OpenPhysicsTheme.cardBackground, in: RoundedRectangle(cornerRadius: 12))
        } else {
            HStack {
                Text(title).frame(width: 80, alignment: .leading)
                Text(value).foregroundStyle(.secondary)
                Spacer()
                Button(editor == target ? "收起" : action) { open(editor == target ? nil : target) }.disabled(form.busy || classes.busy || !enabled)
            }.padding(.horizontal, 16).frame(minHeight: 56)
        }
    }

    private func usernameEditor(_ settings: AccountCredentials) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("新用户名（可使用中文）", text: $username)
            Text("每\(settings.usernameChangeWindowDays)天最多修改\(settings.usernameChangeLimit)次，还可修改\(settings.usernameChangesRemaining)次。")
                .font(.caption).foregroundStyle(.secondary)
            if let next = settings.usernameNextChangeAt, settings.usernameChangesRemaining == 0 {
                Text("下次可修改：\(next)").font(.caption)
            }
            Button("保存用户名") { saveCredentials(usernameOnly: true) }.disabled(settings.usernameChangesRemaining == 0)
        }.editorStyle(busy: form.busy || classes.busy)
    }

    private func passwordEditor(_ settings: AccountCredentials) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if settings.hasPassword { SecureField("原密码", text: $currentPassword) }
            else { TextField("登录用户名", text: $username) }
            SecureField("新密码（6—128位）", text: $newPassword)
            SecureField("确认新密码", text: $confirmation)
            HStack {
                Button("保存密码") { saveCredentials(usernameOnly: false) }

            }
        }.editorStyle(busy: form.busy || classes.busy)
    }


    private func open(_ target: Editor?) {
        editor = target; currentPassword = ""; newPassword = ""; confirmation = ""
        form.message = ""
        username = settings?.username ?? ""
        if target == .password && settings?.hasPassword == false && username.allSatisfy(\.isNumber) {
            username = "student" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(8)
        }
        form.captchaRequired = false
        if form.captchaRequired { Task { await form.refreshCaptcha() } }
    }

    private func reload() async {
        guard let student = appSession.studentSession else { return }
        await form.run { settings = try await form.api.accountCredentials(for: student) }
    }

    private func refreshAccount() async {
        await reload()
        await classes.load(for: appSession.studentSession)
    }

    private var validPassword: Bool {
        guard (6...128).contains(newPassword.count), !newPassword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              newPassword == confirmation else { form.message = "密码需为6—128位，两次输入应一致。"; return false }
        return true
    }

    private func saveCredentials(usernameOnly: Bool) {
        if !usernameOnly && !validPassword { return }
        let newName = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !newName.isEmpty else { form.message = "请输入用户名。"; return }
        mutate("account-credentials", AccountRequest(username: newName, renewSession: true,
            currentPassword: usernameOnly || settings?.hasPassword != true ? nil : currentPassword,
            newPassword: usernameOnly ? nil : newPassword))
    }


    private func mutate(_ path: String, _ body: AccountRequest) {
        guard let student = appSession.studentSession else { return }
        Task { await form.run {
            let result = try await form.api.changeAccount(path: path, body: body, student: student)
            guard let renewed = result.session else { throw APIError.invalidResponse }
            guard appSession.studentSession?.token == student.token else { return }
            try await appSession.acceptAuthentication(renewed)
            settings = try await form.api.accountCredentials(for: renewed)
            open(nil); form.message = "已保存。"
        } }
    }
}

private extension View {
    func editorStyle(busy: Bool) -> some View {
        self.textFieldStyle(.roundedBorder).textInputAutocapitalization(.never).autocorrectionDisabled()
            .padding(16).background(OpenPhysicsTheme.accentSoft, in: RoundedRectangle(cornerRadius: 12)).disabled(busy)
    }
}


struct AccountDeletionView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var form = AccountFormState()
    @State private var password = ""
    @State private var understood = false
    @State private var confirmsDeletion = false
    var body: some View {
        NavigationStack {
            Form {
                Text("注销后无法恢复").font(.title2.bold())
                Text("注销将删除本账号的个人资料、学习记录、作答图片和学习进度，并使本账号退出所有设备。其他学生的数据不受影响。")
                SecureField("当前密码", text: $password).textContentType(.password)
                Toggle("我已了解影响，并确认注销本账号", isOn: $understood)
                if !form.message.isEmpty { Text(form.message).foregroundStyle(.red) }
                Button("确认注销", role: .destructive) { confirmsDeletion = true }
                    .disabled(form.busy || !understood || password.isEmpty)
            }
            .navigationTitle("注销账号")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("返回") { dismiss() }.disabled(form.busy) } }
            .confirmationDialog("确认删除本账号及学习数据？", isPresented: $confirmsDeletion, titleVisibility: .visible) {
                Button("注销账号", role: .destructive, action: erase)
            }
            .interactiveDismissDisabled(form.busy)
        }
    }
    private func erase() {
        guard !form.busy, understood, !password.isEmpty, let student = appSession.studentSession else { return }
        Task { await form.run {
            let result = try await form.api.deleteAccount(body: AccountDeletionRequest(confirmed: true, currentPassword: password), for: student)
            guard result.deleted else { throw APIError.invalidResponse }
            password = ""
            appSession.logout(message: "账号已注销，个人资料及学习数据已删除。")
            dismiss()
        } }
    }
}
