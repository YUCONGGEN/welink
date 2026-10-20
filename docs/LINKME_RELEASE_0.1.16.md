# LinkMe 0.1.16 · 来电通知与图标修复

本版更新 Windows、Android 与 Apple Silicon macOS 客户端，以及 LinkMe 服务端。

- Android 来电、远程协助和会议邀请会以持续通知显示，可直接进入、接听或拒绝；邀请结束后停止铃声。普通聊天消息仍使用系统通知。
- Windows 未读状态使用任务栏窗口图标绿色闪动，邀请在桌面右下角持续显示，处理或结束后关闭提示。
- Windows 安装器、桌面程序、Android 和 Mac 应用使用 LinkMe 的 M 图标；修复 Windows 原生邀请窗口及 Android 邀请通知的状态清理。
- 服务端向客户端提供会议邀请与结束状态，支持各端及时停止过期提示。

下载：[Windows 安装版](http://www.yucg.cn:8251/downloads/LinkMe-Setup.exe) · [Windows 便携版](http://www.yucg.cn:8251/downloads/LinkMe-Windows.exe) · [Android](http://www.yucg.cn:8251/downloads/LinkMe-Android.apk) · [Apple Silicon macOS](http://www.yucg.cn:8251/downloads/LinkMe-macOS-arm64.zip)。

验证：`go test ./...` 全部通过；Android Gradle lint、APK 签名、16 KB 对齐和四种 ABI/UI 资源核验通过；Windows x64、macOS arm64 客户端和 macOS/Linux 服务端构建完成。Android 包使用本地预览签名，macOS 包未做 Apple 公证。
