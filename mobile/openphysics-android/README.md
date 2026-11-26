# OpenPhysics Android 自部署客户端

Kotlin + Jetpack Compose 原生客户端。需要 Android Studio、JDK 17 和 Android SDK 36。

不包含会员套餐、购买链接或付费解锁。有效账号默认可使用完整学习功能；相关业务能力由部署者自行实现。

Debug 默认连接 Android 模拟器宿主机的 `http://10.0.2.2:8010/api/student`。真机连接需设置宿主机可访问地址及自己的测试网络。

```bash
./gradlew :app:assembleDebug -POPENPHYSICS_API_BASE_URL=http://10.0.2.2:8010/api/student
```

连接自己的后端时，在本目录执行下列命令，把示例域名替换为自己的 HTTPS 地址；保留 `/api/student` 路径。该参数同时适用于 Debug 和 Release。

```bash
./gradlew :app:assembleDebug -POPENPHYSICS_API_BASE_URL=https://school.example/api/student
```

API、相对路径题图、隐私条款和 H5 内容层都使用该后端地址；自己的后端或网关需同时提供 `/panes/learning-content/`、`/legal/` 和资源路径。`appassets.openphysics.local` 是应用内加载本地 KaTeX 资源的虚拟域名，无需部署或申请证书。

公开版使用独立应用 ID `org.example.openphysics.android`。正式构建前设置自己的应用 ID、HTTPS 后端。`openphysics.example` 是不可用于真实服务的示例域名。

Release 使用你自己的 `OPENPHYSICS_ANDROID_KEYSTORE_PATH`、`OPENPHYSICS_ANDROID_STORE_PASSWORD`、`OPENPHYSICS_ANDROID_KEY_ALIAS` 和 `OPENPHYSICS_ANDROID_KEY_PASSWORD`。脚本不读取原项目的系统钥匙串或签名材料。

配置以上环境变量后执行：

```bash
./scripts/build-release.sh -POPENPHYSICS_API_BASE_URL=https://school.example/api/student
```

签名文件和密码应保存在仓库外，通过本机环境或私有 CI 提供；不要写入源码或提交到 Git。AI 服务密钥仅配置在自己的后端，客户端无需携带模型密钥。

H5 内容层必须由你自己的后端或网关提供。源码附带不代表已验证真实设备、签名或应用商店发布。
