# LinkMe 0.1.15 · 邮箱登录与 Apple Silicon macOS

LinkMe 为 Windows、Android 和 Apple Silicon macOS 统一邮箱账号体系。三端使用邮箱与密码登录；注册和找回密码都要求输入发送到邮箱的验证码，邮件由服务器使用 YuDesk 已配置的腾讯云 SES API 发送。桌面端仍可使用 Android 扫码登录。

本版包括：

- 全新数据库初始化后创建已验证邮箱的“郁从根”管理员；账号由管理员资料中的不可变用户 ID 授权。
- 重新设置 5 GB 个人网盘、邮箱验证码注册、Me 助手流式对话和本地 Codex 任务配置。
- P2P 连接探测窗口统一为 15 秒，失败后按配置切换到 TURN 中继。
- LinkMe M 图标、Windows 未读托盘提示和会议来电提醒。
- Apple Silicon `LinkMe.app` 下载包及公开下载页入口。macOS 使用本机 Go 服务，通过默认浏览器显示界面；预览包尚未经过 Apple 公证。

下载： [Windows 安装版](http://www.yucg.cn:8251/downloads/LinkMe-Setup.exe) · [Windows 便携版](http://www.yucg.cn:8251/downloads/LinkMe-Windows.exe) · [Apple Silicon macOS](http://www.yucg.cn:8251/downloads/LinkMe-macOS-arm64.zip) · [Android](http://www.yucg.cn:8251/downloads/LinkMe-Android.apk)。

本版验证包括 Go 全量测试、Android 四 ABI 构建与 lint、Mac Mach-O arm64 架构及应用包权限检查、Windows WebView2 登录页启动检查，以及三端共享登录界面资源核验。
