# WeLink 客服与滚轮修正（2026-10-19）

## 客户端

主页新增原生 Go / Fyne「WeLink 客服」页，跟随 YuDesk 的三套主题和中英语言。页面仅有客服列表、最近 60 条消息和文字输入；没有 WeLink 群聊、云盘、会议等界面，不加载浏览器。

必须先登录 YuDesk。首次登录及恢复已保存登录时，异步请求客服服务，失败不阻塞登录或远控。打开客服页后每 5 秒更新客服在线状态和当前聊天。未登录显示登录入口；服务故障/未配置/无人在线显示「忙碌中」。消息未确认时保留输入，再试使用原消息编号避免重复。退出登录或切换账号清除页面中的旧对话。

## 管理后台

YuDesk `/admin?view=settings` →「WeLink 客服」填写六位数字账号，每行一位，最多 20 位。首次默认 **100001**；管理员保存空列表可暂停接待。保存前通过 WeLink 验证账号存在且未注销；页面沿用后台登录和 CSRF 保护。名单保存在 YuDesk `server_settings`，兼容现有 SQLite/MySQL 8 存储。

客服使用原 WeLink 登录，可以从联系人和普通私聊中接待。YuDesk 用户显示为 `138****0001 · 来自YuDesk`。客户可选择其他已配置客服，离线时可留言；没有开放任意用户搜索或普通 WeLink 登录令牌。

## 两个服务都需要升级并配置

此次不仅是客户端改动。需同时部署本次 YuDesk relay 和 `E:/welink` 的 WeLink server。旧版服务器不含接口时客户端会显示忙碌中。

1. 在两个服务的运行环境中配置同一条随机密钥（至少 32 字符，建议随机 32 字节的十六进制编码），不要放入客户端、下载目录或 Git。
2. YuDesk relay 环境变量：
   - `YUDESK_WELINK_URL=http://127.0.0.1:8250`（同机部署）。异机必须使用可信证书 HTTPS 地址。
   - `YUDESK_WELINK_SECRET=<共享随机密钥>`。
3. WeLink server 环境变量：`WELINK_YUDESK_SECRET=<同一密钥>`。
4. 备份两边数据库后升级服务，保留原有配置、账号及聊天记录。WeLink 会自动创建 `yudesk_identities` 映射表。
5. 用真实 YuDesk 登录打开客服页，并确认 WeLink 的 `100001` 已存在；该客服登录 WeLink 后会显示在线。可在后台修改名单。

现有 macOS 同机部署：YuDesk `server.conf` 中使用 `export YUDESK_WELINK_URL=...`、`export YUDESK_WELINK_SECRET=...`，因为 `start.sh` 会 source 此文件；WeLink `~/Library/LaunchAgents/cn.welink.server.plist` 的 `EnvironmentVariables` 中配置 `WELINK_YUDESK_SECRET`，随后按现有流程重启各服务。不修改已有其他环境变量。Docker 使用各自的环境变量或 secret 注入。

## 身份和权限

- 桌面只携带 YuDesk 会话访问现有 HTTPS 账号服务，不能指定手机号；relay 从有效会话得到手机号。
- relay 用专用密钥调用 `/api/integrations/yudesk/support`。WeLink 对非 TLS、非回环连接拒绝访问，不信任 X-Forwarded-For。
- `yudesk_identities` 持久化绑定已验证手机号与专属 WeLink 账号。再次登录复用同一账号。不接管仅在普通 WeLink 个人资料中填写同一手机号的账号，也不分享用户密码。
- 只允许访问管理员指定客服；更改名单立即限制旧客服会话访问。添加联系人保留 WeLink 拉黑限制。
- 没有通用 WeLink 客户端会话，没有自动发送欢迎消息给真人。模型、音频、远控的传输和渲染线程不参与客服 HTTP 请求。

## 滚轮

Fyne 2.8.2 GLFW 驱动将一格滚轮转换为 25 个界面滚动单位，旧代码又乘 120，造成 Windows 一格被发送成 3000 单位。现先还原驱动比例和大幅滚动加速，再转换为 Windows 120 单位/格；触控板小数累积保留，释放焦点清除余量。精细鼠标 Raw Input 本来就是原始 Windows 单位，继续直接传递。另补齐被控端水平滚轮注入，水平和垂直分别发送。

## 本地验证范围

测试使用隔离账号和临时数据库，不给线上客服发送测试消息。覆盖普通/反向/水平/触控板滚轮、自动建号幂等、相同资料手机号不被接管、客服双向消息、重复发送去重、非指定客服禁止访问、服务不可用、退出登录清理、后台名单持久化、原生页面中英及三主题截图。线上可用性仍取决于两个服务部署和共享密钥配置。
