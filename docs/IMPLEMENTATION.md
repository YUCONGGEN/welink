# WeLink 实施记录

用户要求：Windows + Android，参考本机 QQ 的外观和交互；Go 实现；远控复用 E:/yudesk 的技术；服务部署至 yu@223.166.147.252:2222 的 ~/bin/welink。

## 设计

- Go HTTP/WebSocket 服务，SQLite WAL 持久化：注册登录、好友申请、单聊群聊、成员权限、历史消息、撤回、文件、收藏、远程邀请。
- Go 客户端内核通过受本地令牌保护的 loopback HTTP 提供界面。Windows 内嵌静态资源，Android 将同一份资源打包到 APK。按用户要求使用 HTTP 8250，下载使用 HTTP 8251。
- QQ 风格的三栏 Windows 界面、安卓底部导航与单屏会话；自有 WeLink 名称图标。
- 远控来源于 YuDesk 的 desktop / secureconn / protocol / peerpath / stream：每次会话显式同意，X25519/Ed25519/AES-GCM，P2P 优先和加密 WebSocket 中转回退；安卓 MediaProjection 和无障碍服务由用户系统授权。
- SSH 私钥仅保存在用户 .ssh，禁止进入工程、安装包及服务端。

## 已交付与验证

- [x] Go 服务端：数字号码、会话、联系人、消息、文件、会议、扫码登录；Go race 集成测试通过。
- [x] 浏览器联调：消息、文件、历史、联系人、手机布局；会议三人合成音视频、静音、主持人转交与结束。
- [x] Windows WebView2 实际原生窗口启动验证、安装器、卸载入口。
- [x] Android 四 ABI APK、Gradle lint、APK v2 签名、16 KB 对齐检查。
- [x] 双端会议白色面板、浅灰背景、蓝色控件；手机会议使用原生 WebRTC。
- [x] 桌面二维码登录；手机明确确认、取消、过期、并发单次兑换测试；Go 二维码由 Android 同款 ZXing 解码器验证。
- [x] Mac arm64 部署到 `~/bin/welink`，登录域 LaunchAgent、公网健康检查与下载；端口加入现有 UPnP 刷新脚本。
- [ ] 安卓完整原生启动、相机实扫及 Windows / Android 真实媒体互通：模拟器测试环境尚未稳定，不能以构建通过代替设备验收。
- [ ] YuDesk 双机真实远控、弱网、不同 DPI 与 Android 触控的完整验收。
- [ ] QQ 全功能和逐像素对齐；完整缺口见 `FEATURE_PARITY.md`。

2026-09-10 扫码版本部署前，服务器数据库另存为 `data/welink-before-qr-20260910.db`。二维码仅包含扫描凭据；兑换电脑会话的凭据不进入二维码。确认后给电脑独立会话，不复用手机令牌。

APK 为预览调试签名，保留本地签名密钥以支持后续覆盖安装。未声称具备正式商店签名、系统推送或完整后台可靠性。

## 参考核验

本机 QQ 已登录。Computer Use 成功读取了联系人界面的可访问性结构：左侧消息/联系人/空间/频道/游戏、文件/收藏入口；搜索、好友通知/群通知、好友/群聊选项卡、联系人分组。截图失败：SetIsBorderRequired 不支持此接口；操作失败：coordinate input geometry is unavailable。因此暂不能声称逐像素一致。

服务器为 macOS Darwin arm64；8230、8231、8233、8235、8240、8241 已被其他项目使用。WeLink 使用独立目录和端口，避免更改其他服务。
