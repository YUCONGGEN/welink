# Windows 托盘与后台消息 · 2026-09-11

Windows 默认关闭窗口后保留在系统托盘，聊天连接、会议和远程协助继续运行。双击托盘图标、通过键盘激活图标、点击通知或再次运行 WeLink 都会恢复原窗口。托盘右键菜单提供“打开 WeLink”和“退出 WeLink”；应用“更多”菜单也有独立的退出入口，与“退出登录”区分。

“设置 → Windows 桌面设置”可关闭托盘驻留，之后点击关闭或按 Alt+F4 会完全退出。后台新消息提醒也可单独关闭。设置保存在当前客户端目录的 `desktop.json`；写入成功后才更新运行中的选项。系统托盘暂不可用时，关闭窗口会最小化到任务栏，避免窗口消失后无法找回。

托盘提示显示未读数量。Windows 后台通知只显示数量，不包含发送人或消息内容；普通免打扰消息不计入，群 @提醒保留。新消息提示间隔至少五秒，遵守 Windows 通知与安静时间规则；操作系统可能抑制横幅。读完消息或退出登录会清除当前未读提示。

窗口隐藏和最小化状态由 Win32 消息同步给共享界面。即使 WebView 的页面可见性状态没有及时变化，隐藏窗口中的当前聊天也不会自动标为已读；恢复并显示聊天后再同步已读。客户端保持原来的进程与连接，不会因为关闭主窗口重新登录。

同一用户数据目录只运行一个 Windows 客户端。再次启动通过命名事件通知已有进程，第二个进程直接退出；事件可以在主窗口初始化前暂存。目录按绝对路径、符号链接和大小写归一处理，不同数据目录相互独立。命名内核对象随进程释放，不使用可能在崩溃后留下阻塞状态的文件锁。

托盘结构与菜单处理参考 `E:/yudesk/internal/viewerapp/tray_windows.go`，在 WeLink 中改为使用 WebView 主窗口的 UI 线程处理。`TaskbarCreated` 到达时重新注册图标；程序退出时移除图标，系统注销或关机时不阻止结束会话。此轮没有增加开机启动项、全局热键或自动更新，这些仍在总功能清单中。

截图：[Windows 桌面设置](screenshots/windows-desktop-settings.png)。该截图由共享界面的浏览器测试生成；真实 Windows WebView2 另有以下原生测试，不能将截图当作 QQ 逐像素一致的证明。

原生测试在 Windows 运行 `dist/welink-desktop-tests.exe`，设置 `WELINK_NATIVE_DESKTOP_TEST=1`，使用 `-test.v -test.timeout=90s`。测试程序由 `GOOS=windows GOARCH=amd64 go test -c -o dist/welink-desktop-tests.exe ./cmd/welink` 构建。它使用私有临时服务和测试账号，不访问线上聊天数据。

- 验证真实 HWND 隐藏 / 显示、托盘注册和移除、键盘托盘激活；只删除测试程序自己的图标并模拟 `TaskbarCreated` 验证恢复，没有重启用户的 Explorer。
- 验证托盘不可用时退回任务栏、关闭即退出选项、程序退出清理，以及同目录重复启动和锁释放。
- 在真实 WebView2 登录并打开聊天，关闭后通过服务端发送测试消息，确认进程与 WebSocket 保持、服务端仍显示未读、原生托盘计数更新；运行第二个实际 Windows EXE，确认它退出并唤回原窗口，消息已到达且恢复后才标为已读。
- 验证桌面设置写入磁盘、原生读取结果与界面一致，以及明确退出入口。原生测试用 WebView 注入的测试脚本驱动界面，没有注入实际键鼠输入。

`scripts/desktop-ui-test.mjs` 另行覆盖设置布局、免打扰计数、@提醒计入、已读清零和退出确认。窗口及托盘底层行为不依赖这个浏览器模拟测试作为证明。

Microsoft API 依据：[Shell_NotifyIconW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyiconw)、[NOTIFYICONDATAW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-notifyicondataw)、[SetWindowSubclass](https://learn.microsoft.com/en-us/windows/win32/api/commctrl/nf-commctrl-setwindowsubclass)。当前 QQ 控件结构可读取，截图接口仍报 `SetIsBorderRequired` / `0x80004002`；Android QQ 参考与真机验收尚未取得。

最终验证通过：原生聊天 / 重复进程 5.69 秒、单实例 0.02 秒、托盘生命周期 1.81 秒；客户端 Go race 回归 4.144 秒，相关远控 / 移动内核与命令入口编译检查通过。Windows EXE 原生启动、默认域名、登录 / 注册界面和未认证 401 检查通过。桌面设置、群 @提醒、消息操作 / 账号安全、头像联调通过；最终开关样式再次经过桌面界面和原生测试。

Android lint / 构建、APK v2 签名、16 KB 对齐通过，16 个当前界面资源逐字节一致、四种 ABI 齐全。此次更新只发布客户端下载文件，服务器二进制和数据库未修改，线上服务未重启。远端完整 SHA-256、域名下载大小与首尾 64 KB Range 内容均通过；Windows 单文件 13,723,136 字节、安装器 17,266,688 字节、Android APK 59,516,328 字节。下载仍为 `http://www.yucg.cn:8251/`。
