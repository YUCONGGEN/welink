# 客户端 0.1.3-preview · 同时重连的协商修复

继续排查 0.1.2 验证中一次强制 TURN TCP 未接通的问题。在真实 Chromium 音视频通话上主动延迟 `createOffer`，稳定复现了独立的协商缺陷：双方同时重启 ICE，礼让方尚未提交本地 offer，就对 `stable` 状态执行 rollback。浏览器返回 `Called in wrong signalingState: stable`，远端 offer 没有获得 answer。原始 TCP 超时未保留完整信令，因此不能断言那次超时一定由同一原因造成。

## 修复范围

Windows / 浏览器共享的会议协商代码现区分两种情况：尚未完成的 offer 通过序号作废；已开始提交的本地 offer 先等待提交结束，仅在 `have-local-offer` 状态回滚。处理远端信令时使用每个参会连接独立的 Promise 队列，避免较慢的 answer、后续 offer 和 ICE candidate 跨越异步调用而失序。

信令处理中触发的新轨道协商会被保留，队列清空后继续处理。结束通话、离开或移除参会者后，迟到的异步结果不再提交 SDP 或向新会议发送旧信令。

Android 的原生 WebRTC 协商实现本次未改动；APK 同步共享 UI 资源和版本号，保留 0.1.2 的安全边距、原生麦克风波动和签名。Windows 安装记录显示版本改为 0.1.3。

## 可重复验证

均使用本地测试服务和测试账号，不创建生产用户或消息。使用真实 RTCPeerConnection、ICE / TURN、RTP 收包和视频解码统计；浏览器提供测试摄像头与麦克风。

- `node scripts/media-path-test.mjs --restart-glare`：受控延迟 offer 生成、本地 offer 提交、远端 answer 处理，以及 ICE candidate 处理时新增轨道。检查协商状态、错误事件和持续双向音视频。第一种场景在修复前稳定失败，修复后四种场景通过；初次 offer 尚未完成时挂断，也没有迟到的信令、错误提示或遗留轨道。
- `node scripts/media-path-test.mjs --repeat=2`：P2P、强制 TURN UDP、强制 TURN TCP 路径各两轮，实际双向音频字节与视频解码帧增长；挂断释放轨道与连接；会议结束后才返回的摄像头轨道立即释放。
- `node scripts/media-path-test.mjs --tcp-only --repeat=5`：连续五次强制 TCP 中转通话通过。
- 三人会议：每端两条连接均有持续音视频，主持人静音、转让和结束会议通过。
- 通话流程：语音 / 视频、接听 / 拒绝 / 取消 / 忙线、单设备接听、视频来电语音接听、原生桥接约定、通话记录与资源释放通过。
- Windows 原生窗口 / 托盘生命周期、自定义图标、聊天 / 重复进程唤回、主窗口隐藏后的原生会议邀请通过；最终 EXE 隐藏启动器检查确认实际 Chromium 子窗口可见。
- Go 客户端相关 race 检查通过；Android lint、构建、v2 签名、16 KB 对齐与 APK 内 119 个当前 UI 资源 / 4 ABI 校验通过。APK 安装资源测试继续覆盖嵌套头像、升级、拷贝中断清理与重试。

测试失败时保存信令阶段与状态、ICE / RTP 统计，避免只能看到最终关闭后的空统计。诊断不保存 SDP、认证信息或录音。

### 中转测试修正

旧脚本的 `relay-udp` 场景同时提供 UDP 和 TCP 地址，实际统计可能选中 TCP，不能据此单独证明 UDP 路径。本次改为仅保留对应协议，并断言选中路径的中转协议。严格隔离 UDP 后，本机 Chrome 在授权麦克风 / 摄像头时未能通过物理接口访问测试服务的 `127.0.0.1` UDP 地址；独立采集实验在不启用媒体采集时能够分配，启用后不能分配，加入 `--allow-loopback-in-peer-connection` 后恢复。该参数只用于本地测试浏览器，产品客户端和生产网络设置没有改变。

因此，0.1.2 及本次早期日志中的 `relay-udp` 标签应当以实际 `tcp` 统计重新解释；以本次收紧后的两轮三路径测试为音视频 UDP 验证依据。服务端此前的 Go TURN UDP 报文测试和公网分配探测是独立验证，不受这个脚本标签问题影响。

这些结果覆盖已复现的协商竞态和本地中转回退；跨网、弱网和 Windows / Android 真机互通仍未完成验收。前一版本的系统边距、真实音量显示与窗口修复见 [0.1.2 记录](CLIENT_STABILITY_20260911.md)。

## 发布

已发布到 `http://www.yucg.cn:8251/downloads/`。远端完整文件 SHA-256 与本地一致，公网校验清单、文件大小与首尾 64 KiB Range 内容通过。服务端二进制没有变化，也未重启服务或修改用户数据。

Android 版本码 4，保留原签名，可覆盖安装。Windows 更新前从托盘退出旧程序，再运行安装包。

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| WeLink-Windows.exe | 14,096,384 | `49cb4b011b4646285e3a63a0335edf9d91c8a431ecce0c2342be213d5f1ae122` |
| WeLink-Setup.exe | 17,641,984 | `e71c0028dfec6dac712ab33c4f37302ad3e4c80fd29d6def37b6c0a1664dddf7` |
| WeLink-Android.apk | 48,482,204 | `4cd31c0fc35f7695e0a613903b338c3f6bf1b77979884e0a4b6ab4cdf07c9f15` |
