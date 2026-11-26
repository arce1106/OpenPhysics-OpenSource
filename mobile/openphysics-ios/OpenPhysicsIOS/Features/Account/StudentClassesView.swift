import SwiftUI

struct StudentClassesView: View {
    @ObservedObject var store: StudentClassesStore
    let student: StudentSession
    var onMembershipChanged: () async -> Void = {}
    @State private var expanded = true
    @State private var joining = false
    @State private var choosingLeave = false
    @State private var renaming = false
    @State private var leaving: StudentClassMembership?
    @FocusState private var codeFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.easeInOut(duration: 0.18)) { expanded.toggle() }
            } label: {
                HStack {
                    Label("我的班级", systemImage: "person.2").font(.headline)
                    Spacer()
                    if store.busy { ProgressView().controlSize(.small) }
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
                .frame(minHeight: 32).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("account.classes.toggle")
                .accessibilityValue(expanded ? "已展开" : "已收起")

            if expanded {
                ForEach(store.memberships) { membership in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(membership.name).font(.callout.weight(.semibold))
                        Text(membership.teacherLabel).font(.subheadline).foregroundStyle(.secondary)
                        if membership.archived || !membership.teacherActive {
                            Text(membership.archived ? "班级已归档" : "教师账号已停用")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                if store.loaded && store.memberships.isEmpty {
                    Text("尚未加入班级").font(.subheadline).foregroundStyle(.secondary)
                }
                HStack(spacing: 12) {
                    Button { joining.toggle(); codeFocused = joining } label: {
                        Text("加入班级").frame(maxWidth: .infinity, minHeight: 28)
                    }
                        .accessibilityIdentifier("account.classes.join")
                    Button {
                        renaming.toggle(); joining = false
                        if renaming { store.newName = student.displayName }
                    } label: {
                        Text("修改姓名").frame(maxWidth: .infinity, minHeight: 28)
                    }
                        .disabled(store.memberships.isEmpty)
                        .accessibilityIdentifier("account.classes.rename")
                    Button {
                        if store.memberships.count == 1 { leaving = store.memberships.first }
                        else { choosingLeave = true }
                    } label: {
                        Text("退出班级").frame(maxWidth: .infinity, minHeight: 28)
                    }
                        .disabled(store.memberships.isEmpty)
                        .accessibilityIdentifier("account.classes.leave")
                }.buttonStyle(.bordered).disabled(store.busy)

                if joining { invitationForm }
                if renaming { renameForm }
                if !store.message.isEmpty {
                    Text(store.message).font(.subheadline).foregroundStyle(.secondary)
                        .accessibilityIdentifier("account.classes.message")
                }
                if !store.loaded && !store.busy {
                    Button("重新加载") { Task { await store.load(for: student) } }
                        .frame(minHeight: 44)
                }
            }
        }
        .padding(16)
        .background(OpenPhysicsTheme.cardBackground, in: RoundedRectangle(cornerRadius: 16))
        .tint(OpenPhysicsTheme.accent)
        .confirmationDialog("选择要退出的班级", isPresented: $choosingLeave, titleVisibility: .visible) {
            ForEach(store.memberships) { membership in
                Button(membership.name) { leaving = membership }
            }
            Button("取消", role: .cancel) {}
        }
        .alert("退出\(leaving?.name ?? "班级")？", isPresented: Binding(
            get: { leaving != nil }, set: { if !$0 { leaving = nil } }
        )) {
            if let membership = leaving {
                Button("退出班级", role: .destructive) {
                    Task { await store.leave(membership, for: student); await onMembershipChanged() }
                }
            }
            Button("取消", role: .cancel) { leaving = nil }
        }
    }

    private var invitationForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("班级邀请码").font(.subheadline)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { codeField.frame(minWidth: 130); previewButton.fixedSize() }
                VStack(alignment: .leading, spacing: 8) { codeField; previewButton }
            }
            if let invitation = store.invitation {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 12) {
                        Text(invitation.membership.name).font(.callout.weight(.semibold))
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if !invitation.alreadyJoined {
                            Button("同意并加入") {
                                codeFocused = false
                                Task {
                                    await store.join(for: student)
                                    if store.code.isEmpty { joining = false }
                                    await onMembershipChanged()
                                }
                            }.buttonStyle(.borderedProminent).frame(minHeight: 44)
                                .fixedSize(horizontal: true, vertical: false)
                                .disabled(!store.canJoin).accessibilityIdentifier("account.classes.confirm")
                        }
                    }
                    Text(invitation.membership.teacherName).font(.subheadline).foregroundStyle(.secondary)
                    if !invitation.alreadyJoined && !invitation.disclosure.isEmpty {
                        Text(invitation.disclosure).font(.footnote).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("account.classes.disclosure")
                    }
                    if invitation.alreadyJoined {
                        Text("已加入此班级").font(.subheadline).foregroundStyle(.secondary)
                    } else {
                        Text("账号：\(student.username)").font(.subheadline).foregroundStyle(.secondary)
                        HStack(spacing: 10) {
                            Text("学生姓名").font(.subheadline).fixedSize()
                            TextField("填写真实姓名", text: $store.studentName)
                                .textContentType(.name).autocorrectionDisabled()
                                .padding(.horizontal, 12).frame(minHeight: 44)
                                .background(.background, in: RoundedRectangle(cornerRadius: 10))
                                .disabled(store.busy).accessibilityLabel("学生姓名")
                                .accessibilityIdentifier("account.classes.student-name")
                        }
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(OpenPhysicsTheme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("account.classes.preview")
            }
        }
    }

    private var renameForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Text("学生姓名").font(.subheadline).fixedSize()
                TextField("填写真实姓名", text: $store.newName)
                    .textContentType(.name).autocorrectionDisabled()
                    .padding(.horizontal, 12).frame(minHeight: 44)
                    .background(.background, in: RoundedRectangle(cornerRadius: 10))
                    .disabled(store.busy).accessibilityLabel("修改学生姓名")
                    .accessibilityIdentifier("account.classes.new-name")
                Button("保存") {
                    Task {
                        await store.rename(for: student)
                        if store.renamedTo != nil { renaming = false }
                        await onMembershipChanged()
                    }
                }.buttonStyle(.borderedProminent).frame(minHeight: 44).disabled(!store.canRename)
            }
            Text("所有班级的老师都会看到新的姓名。").font(.caption).foregroundStyle(.secondary)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(OpenPhysicsTheme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
    }

    private var codeField: some View {
        TextField("8 位邀请码", text: $store.code)
            .textInputAutocapitalization(.characters).autocorrectionDisabled()
            .submitLabel(.search).focused($codeFocused)
            .padding(.horizontal, 12).frame(minHeight: 44)
            .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).stroke(Color(uiColor: .separator).opacity(0.4)) }
            .disabled(store.busy).accessibilityLabel("班级邀请码")
            .accessibilityIdentifier("account.classes.code")
            .onSubmit { if store.canPreview { preview() } }
    }

    private var previewButton: some View {
        Button(action: preview) { Text("查看班级").frame(minHeight: 28) }.buttonStyle(.bordered)
            .disabled(!store.canPreview).accessibilityIdentifier("account.classes.lookup")
    }

    private func preview() {
        codeFocused = false
        Task { await store.preview(for: student) }
    }
}
