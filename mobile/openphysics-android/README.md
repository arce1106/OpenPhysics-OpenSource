# OpenPhysics Android 自部署客户端

Kotlin + Jetpack Compose 原生客户端。需要 Android Studio、JDK 17 和 Android SDK 36。

不包含会员套餐、购买链接或付费解锁。有效账号默认可使用完整学习功能；相关业务能力由部署者自行实现。

Debug 默认连接 Android 模拟器宿主机的 `http://10.0.2.2:8010/api/student`。真机连接需设置宿主机可访问地址及自己的测试网络。

```bash
./gradlew :app:assembleDebug -POPENPHYSICS_API_BASE_URL=http://10.0.2.2:8010/api/student
```

公开版使用独立应用 ID `org.example.openphysics.android`。正式构建前设置自己的应用 ID、HTTPS 后端。`openphysics.example` 是不可用于真实服务的示例域名。

Release 使用你自己的 `OPENPHYSICS_ANDROID_KEYSTORE_PATH`、`OPENPHYSICS_ANDROID_STORE_PASSWORD`、`OPENPHYSICS_ANDROID_KEY_ALIAS` 和 `OPENPHYSICS_ANDROID_KEY_PASSWORD`。脚本不读取原项目的系统钥匙串或签名材料。

H5 内容层必须由你自己的后端或网关提供。源码附带不代表已验证真实设备、签名或应用商店发布。
