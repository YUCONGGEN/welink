# YuDesk 客服桥接变更（待 LinkMe 发布方合并发布）

本聊天只部署 YuDesk，不执行 LinkMe 部署或 git 提交，保留本目录其他聊天的修改。

修改：`internal/server/yudesk_support.go`、新增 `yudesk_credentials.go`、`yudesk_images.go`、`yudesk_bridge_features_test.go`；`auth.go`、`account_security.go`、`email_auth.go` 仅将密码验证改为 `storedPasswordMatches`；go.mod/go.sum 加 `golang.org/x/image v0.24.0`。

可信端点 `/api/integrations/yudesk/support` 增加：
- `account-sync`：已验证邮箱或手机号 + 固定 Argon2id verifier + 单调 revision；不发送/保存明文密码。注册/改密保持同一用户，撤销该用户会话及待确认扫码；重复/旧版本不回滚。
- 邮箱写入 `user_emails`，已验证同邮箱的原生 LinkMe 用户复用原 ID；不根据可编辑姓名或资料认领账号。后台仍可将有桥接身份的真实六位账号指定为客服。
- `image`：只能读取指定客服会话内可见、未撤回图片；按 attachmentId 服务端校验，12MiB/16MP 输入上限，生成最大1280px预览；不转发任意URL或通用令牌。
- `read` + messageId：仅更新该会话内实际存在消息的 read_seq；bootstrap.staff[].unread 提供绿泡计数。
- bootstrap.credentialRevision 可让 YuDesk 在 LinkMe 数据库重建后重新同步密码；后台队列15秒重试。

YuDesk 使用中英双语原生客服页，无 LinkMe 网页宿主。Windows/macOS/Linux 共用一份 Go 视图，Android/Harmony 原生实现左右气泡、图片及未读绿泡。

已运行 `go test ./internal/server -run TestYuDesk -count=1`：通过，包括同步注册/重置/乱序保护、邮箱密码登录、旧会话撤销、图片权限/撤回、已读/未读。

最终发布前请重新执行上述测试和完整 server 测试。勿发布或打印客服共享密钥、密码 verifier、邮箱云密钥。YuDesk 的 outbox 保存在自己的数据库事务内，LinkMe 重建后由 bootstrap 发现 revision 缺失，再同步。

## 发布就绪状态（2026-10-20）

YuDesk 第94版 Windows/macOS(arm64、amd64)/Linux/Android(四架构兼容包及ARM64小包) 已完成构建。MySQL 8.0 同步队列和客服桥接本地集成测试通过。

线上无副作用能力预检：对 account-sync 发送无效 verifier + revision=0，服务返回400，但没有新版“账号同步数据无效”验证响应；因此线上仍未确认支持新桥接动作。客服图片、已读/未读绿泡与密码同步必须等 LinkMe 统一部署以上桥接变更后才能完成线上验收。YuDesk 不会越过本项目发布方单独部署 LinkMe。

该探针使用服务器配置内已有共享密钥，不读取用户消息、不创建用户、不修改密码。验证脚本在 YuDesk staging/ai-membership-20261020/probe-support.py。无密钥或 verifier 写入此文档。

YuDesk 服务端已备份更新，客户端频道仍保持92，94版包已暂存，等待客服接口验证后再推送。图片请求与聊天轮询的限流预算已分离，避免图片耗尽正常会话的请求额度；更新二进制 support-ready 也已准备，尚未二次重启。
