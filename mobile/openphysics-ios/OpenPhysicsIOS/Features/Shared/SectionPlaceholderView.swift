import SwiftUI

struct AccountAccessPreviewView: View {
    @EnvironmentObject private var appSession: AppSession
    let title: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: "lock.open")
                .font(.headline)
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
            Button("查看账号状态") { appSession.showsAccountNotice = true }
                .buttonStyle(.borderedProminent)
                .tint(OpenPhysicsTheme.accent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(OpenPhysicsTheme.accentSoft)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}
