# LinkMe 0.1.17 · M/Link 图标与后台消息

- Windows 程序、安装器、任务栏图标、macOS、Android 启动与通知图标、应用界面和下载页统一使用 M/Link 标记。
- 消息提示音改为 QQ 风格的双短“滴滴”声；保留本设备静音开关。
- Android 消息连接由独立前台服务保持，离开界面、按返回键或移除最近任务不会主动注销消息连接。服务使用持续通知、部分唤醒锁、客户端心跳及自动重连。
- 登录会话保存在应用私有目录；系统重建服务时直接恢复连接和未读消息通知，无需先打开聊天界面。退出登录或登录失效会清理后台会话。
- 登录后引导开启通知和后台运行权限，设置页也可进入后台运行授权。需要允许这些权限；系统强制停止应用、断网及厂商额外的后台限制仍可能阻止接收，不能保证所有机型永久在线。

下载：[Windows 安装版](http://www.yucg.cn:8251/downloads/LinkMe-Setup.exe) · [Windows 便携版](http://www.yucg.cn:8251/downloads/LinkMe-Windows.exe) · [Android](http://www.yucg.cn:8251/downloads/LinkMe-Android.apk) · [Apple Silicon macOS](http://www.yucg.cn:8251/downloads/LinkMe-macOS-arm64.zip)。

验证：`go test ./...` 通过；不启动界面情况下的会话恢复、停连期间未读通知、断线重连、退出及失效会话清理测试通过，通知专项通过 race 检查。Android Gradle lint、APK 签名、16 KB 对齐、四种 ABI 和 UI 资源核验通过；Windows x64、macOS arm64 客户端及 macOS 服务端构建完成。Android 沿用上一版签名，可覆盖安装。macOS 包未做 Apple 公证。尚未完成各厂商真机长时间锁屏测试。
