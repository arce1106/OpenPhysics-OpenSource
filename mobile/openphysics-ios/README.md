# OpenPhysics iOS 自部署客户端

使用 Xcode 打开 `OpenPhysicsIOS.xcodeproj`。公开版清除了开发团队标识，使用独立示例 Bundle ID `org.example.openphysics.ios`；真机签名请选择自己的 Team 和 Bundle ID。

Debug 默认后端为 `http://localhost:8010/api/student`，用于本机 iOS 模拟器。Release 的示例域名 `openphysics.example` 必须改成自己的 HTTPS 后端。真机不可用 `localhost` 访问电脑上的服务。

在 Xcode 中选择应用 Target → Build Settings，搜索 `OPENPHYSICS_API_BASE_URL`，分别为 Debug、Release 填入自己的完整后端地址，例如 `https://school.example/api/student`。地址通过 `Info.plist` 的 `OpenPhysicsAPIBaseURL` 传给客户端。也可在本目录用命令行覆盖，无需把私人配置写入项目：

```bash
xcodebuild -project OpenPhysicsIOS.xcodeproj -scheme OpenPhysicsIOS \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  OPENPHYSICS_API_BASE_URL=https://school.example/api/student \
  CODE_SIGNING_ALLOWED=NO build
```

API、相对路径题图、隐私条款和 H5 内容层均根据该地址解析；后端或网关需同时提供 `/panes/learning-content/`、`/legal/` 和资源路径。正式连接使用自己的 HTTPS 域名；当前 HTTP 例外仅供本机 `localhost` 模拟器调试。

真机或分发构建需在 Signing & Capabilities 选择自己的 Team，并更换 Bundle ID。证书、私钥、描述文件和导出配置保存在本机或私有 CI，不要提交到 Git；AI 服务密钥只配置在后端。

不包含会员套餐、StoreKit 内购、交易验证或付费解锁。有效账号默认可使用完整学习功能；部署者如需这些业务能力，应自行实现客户端与服务端的配套模块。

原生 WebView 使用你自己的 H5 内容层。本仓库没有签名证书、商店账号、TestFlight 导出配置或设备验收记录。
