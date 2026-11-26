# OpenPhysics iOS 自部署客户端

使用 Xcode 打开 `OpenPhysicsIOS.xcodeproj`。公开版清除了开发团队标识，使用独立示例 Bundle ID `org.example.openphysics.ios`；真机签名请选择自己的 Team 和 Bundle ID。

Debug 默认后端为 `http://localhost:8010/api/student`，用于本机 iOS 模拟器。Release 的示例域名 `openphysics.example` 必须改成自己的 HTTPS 后端。真机不可用 `localhost` 访问电脑上的服务。

不包含会员套餐、StoreKit 内购、交易验证或付费解锁。有效账号默认可使用完整学习功能；部署者如需这些业务能力，应自行实现客户端与服务端的配套模块。

原生 WebView 使用你自己的 H5 内容层。本仓库没有签名证书、商店账号、TestFlight 导出配置或设备验收记录。
