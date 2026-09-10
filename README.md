# WeLink

Go 服务端与共享客户端内核，Windows 原生 WebView2、Android 原生宿主。UI 参考 QQ；远程协助与多人会议复用 / 改编用户提供的 YuDesk 技术。目前是持续开发中的预览版本，完整范围和未完成项目见 [功能对照](docs/FEATURE_PARITY.md)。

## 使用

- 下载页：<http://www.yucg.cn:8251/>
- 默认服务：`http://www.yucg.cn:8250`
- Windows：运行 `WeLink-Setup.exe` 安装，或直接运行 `WeLink-Windows.exe`。需要 Microsoft Edge WebView2 Runtime。
- Windows 默认关闭后留在系统托盘继续接收消息；双击托盘图标或再次打开 WeLink 恢复窗口，右键托盘可完全退出。“设置 → Windows 桌面设置”可修改关闭行为和后台新消息提醒。免打扰群保留 @提醒，隐藏中的当前聊天不会自动标为已读。
- Android：安装 `WeLink-Android.apk`，支持 Android 8.0+；包含 arm64、ARMv7、x86_64、x86。当前为直接安装的预览 APK。
- 注册时填写昵称和密码，登录别名可留空。系统分配永久数字 WeLink 号码，用该号码登录、搜索和添加好友。
- “编辑资料 → 更换头像”可选照片、拖动裁剪、缩放、旋转或恢复默认；照片最大 8 MB、单边最多 4096 像素，保存为 512 像素静态头像。群主和管理员可在群设置修改群头像，个人与群头像同步到其他在线设备。
- 桌面登录页点击“使用二维码登录”；安卓登录后从消息页“+ → 扫一扫”或“我的 → 扫一扫 · 电脑登录”扫描。手机核对数字后确认，电脑自动登录。二维码 3 分钟有效、单次使用；也支持选择二维码图片。
- 消息右键（Windows）或长按（Android）可引用、复制文字、收藏、删除，自己发送的消息可在两分钟内撤回。删除同步到本账号的所有设备，不影响对方记录或独立保存的收藏；撤回会同步清除引用中的原文。
- 右键 / 长按消息可转发，或进入多选后逐条转发、合并转发、批量删除。可同时选择好友和群，附带留言；合并记录支持查看详情、图片、文件和嵌套记录。转发保留独立副本，原聊天后续删除 / 撤回不会修改已转发的内容。
- 语音消息：点击输入栏麦克风；Windows 点击开始录音与发送，安卓按住说话、松开发送、上滑取消，最长 60 秒。点语音气泡播放 / 暂停。视频可从输入栏发送，安卓另有系统相机拍摄入口；支持 MP4 / WebM、缩略画面与播放器，单文件不超过 50 MB。音视频也支持转发、收藏、搜索、撤回；发送失败可在当前窗口重试。
- 聊天右上角搜索或“聊天设置 → 查找聊天记录”支持内容 / 文件名、类型、发送人、日期筛选，加载更早记录和查看上下文。点击消息下方的引用也可定位原消息。
- 群聊输入 `@` 或点击输入栏 `@成员` 选择要提醒的人；群主和管理员可 `@全体成员`，消息右键 / 长按可 `@TA`。未读提醒显示在群列表，免打扰群仍保留 @提醒；进入会话可定位提醒消息，历史搜索支持“只看 @我的消息”。普通输入的 `@昵称` 与转发的旧消息不会自动产生提醒。每条文字最多 50 处提醒。
- 群设置可查看永久数字群号、群成员与名片、群公告，管理加群审核、成员邀请、管理员、禁言和群主转让，并提供退出 / 解散入口。群主开启“允许搜索”后，其他用户可从消息页“+ → 查找群聊”按群号或名称申请；在“联系人 → 群通知”审核。默认新旧群均不可搜索、加群需审核；最多 200 人、10 位管理员。
- 好友右键 / 长按可设置备注、分组、私有描述，删除好友或加入黑名单。分组支持创建、重命名、排序、折叠和删除；备注、分组、描述同步到同账号其他设备。“设置 → 联系人与隐私”可管理黑名单，以及是否允许陌生人搜索、是否接收新的好友申请。删除 / 拉黑保留聊天记录和共同群聊，结束双方远程协助及单聊会议；解除拉黑后需要重新添加好友。
- “设置 → 账号与安全”可修改密码、查看登录设备并退出指定设备 / 其他设备。退出立即断开对应聊天、会议与远程协助；修改密码会保留当前设备、退出其他设备，并使未完成的扫码授权失效。
- 在好友单聊中发起远程协助，对方同意后开始。Android 共享屏幕需系统 MediaProjection 授权；远程触控另需主动开启无障碍权限。
- 从“会议”或聊天右上角发起音视频会议，输入 9 位会议号加入，也可以邀请当前好友 / 群。参考 YuDesk 的会议目前最多 8 人、最长 2 小时；主持人可共享屏幕、转交主持、录制和结束会议。两端会议均采用白色面板、浅灰背景和蓝色控件。安卓录制当前只保存屏幕画面，不含声音。

HTTP 由本次部署要求指定：登录与聊天传输不使用 TLS。远控数据通道使用 YuDesk 加密协议；会议音视频使用 WebRTC DTLS/SRTP，信令经 HTTP/WebSocket。当前没有 TURN 媒体中转，严格 NAT 环境可能无法建立会议直连。

## 构建

环境：Go 1.27.1、Node.js / npm；Android 需要 JDK 21、Gradle 8.11.1、Android SDK 35、NDK 27.3.13750724 和 Python 3。

```powershell
npm ci
npm run build:ui
# 在 Windows Go 环境中
go build -trimpath -ldflags="-s -w -H=windowsgui" -o dist/WeLink-Windows.exe ./cmd/welink
# 安装器内嵌已经构建的客户端
New-Item -ItemType Directory -Force cmd/welink-setup/payload
Copy-Item dist/WeLink-Windows.exe cmd/welink-setup/payload/WeLink-Windows.exe
Copy-Item internal/ui/assets/icon.svg cmd/welink-setup/payload/icon.svg
go build -trimpath -ldflags="-s -w -H=windowsgui" -o dist/WeLink-Setup.exe ./cmd/welink-setup
```

Linux / Docker 中构建服务端：`CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o dist/welink-server-darwin-arm64 ./cmd/welink-server`。Android 在隔离副本中执行 `bash scripts/build-android.sh`，脚本会安装固定版本 gomobile 并修改构建副本的 Go 工具依赖；离线构建时需预先缓存 Gradle 依赖 / WebRTC AAR。

UI 源文件在 `internal/ui/src/`，构建到 `internal/ui/assets/`。Windows 由 Go 内嵌；Android 的 Gradle 任务会将同一份界面资源打包进 APK，并在启动时更新到应用私有目录。编辑源文件后先执行 `npm run build:ui`，再构建客户端；仅调整安卓界面时可直接运行 Gradle，不必重建 Go 绑定。无需另行部署前端服务器。

## 服务管理

远端目录 `~/bin/welink`，数据保存在 `data/welink.db` 与 `data/uploads`，日志在 `logs`。使用 macOS 登录域 LaunchAgent `cn.welink.server` 保持服务运行。它会在该用户登录后启动，不代表登录前的系统守护服务。

```sh
launchctl print gui/$(id -u)/cn.welink.server
launchctl kickstart -k gui/$(id -u)/cn.welink.server
curl http://127.0.0.1:8250/health
~/bin/frp/upnpc-refresh.sh 8250 8251
```

8250、8251 已加入现有 UPnP 刷新脚本默认端口列表。临时使用过的 8246、8247 映射已移除。更新二进制时保留 `data`，先备份 SQLite 数据库和附件，原子替换可执行文件后重启服务。

## 验证

```sh
go test -race -timeout 900s ./internal/server ./internal/client ./internal/remote ./mobile/core
go test ./internal/yudesk/secureconn ./internal/yudesk/protocol ./internal/yudesk/peerpath ./internal/yudesk/desktop ./internal/yudesk/stream
node scripts/windows-smoke.mjs
node scripts/ui-test.mjs
node scripts/meeting-test.mjs
node scripts/qr-login-test.mjs
node scripts/message-operations-test.mjs
node scripts/forwarding-test.mjs
node scripts/media-test.mjs --long-recording
node scripts/groups-test.mjs
node scripts/contacts-test.mjs
node scripts/mentions-test.mjs
node scripts/avatars-test.mjs
node scripts/desktop-ui-test.mjs
node scripts/outbox-test.mjs
```

界面联调脚本使用本地测试 API `127.0.0.1:18246` 和 `.local/dev-client/client.url`，不应直接改为生产地址运行。会议脚本使用 Chrome 合成麦克风 / 摄像头验证三人传输、静音和主持人控制；这不等同于手机真机或公网弱网验证。

Windows 用户数据默认在 `%APPDATA%/WeLink`；安装路径默认 `%LOCALAPPDATA%/Programs/WeLink`。SSH 私钥、APK 签名密钥、数据库、构建产物不纳入版本控制。

## 来源

YuDesk 参考仓库 `E:/yudesk`，核验提交 `8fb981decf57e4a5d26fc2dc13d96d476d9bfd6f`；会议文件还包含该工作区的最新修改。移植目录为 `internal/yudesk`，安卓会议类和会议信令 / UI 按 WeLink 身份系统适配。第三方许可保存在 `third_party/`。WeLink 使用独立品牌和账号，不接入 QQ 账号或消息系统。
