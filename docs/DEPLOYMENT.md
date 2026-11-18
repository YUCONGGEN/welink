# 一键部署与管理后台

LinkMe 服务端是一个独立程序（`linkme-server`），自带 SQLite 数据库、下载页和网页管理后台，不依赖其他服务。支持 Linux、macOS、Windows 和 Docker，各平台都可以用一条命令安装或升级。

## 一条命令安装

安装脚本会依次询问以下内容（括号内为默认值，回车即接受）：

- **数据盘**：必须人工选择，脚本不会替你决定。它列出服务器上的磁盘分区及其可用空间，你输入编号后，再确认或修改数据目录（默认是所选磁盘下的 `linkme-data`）。数据库、聊天文件、网盘和下载页安装包都放在这里。
- **其他设置**：
  - 安装目录、公网地址（自动检测本机 IP，可改为域名）、各端口
  - 是否启用媒体中继（默认启用）
  - 后台管理员用户名（`admin`）和密码（可自动生成）
  - 是否开放防火墙端口

安装完成后脚本会打印 API 地址、下载页地址、管理后台地址，以及后台账号和密码（只显示一次），并说明如何查看日志。

| 平台 | 命令 |
|---|---|
| Linux（systemd，需 root） | `curl -fsSL http://www.yucg.cn:8251/downloads/server/install.sh \| sudo sh` |
| macOS | `curl -fsSL http://www.yucg.cn:8251/downloads/server/install.sh \| sh`（加 `sudo` 则安装为开机即启动的系统服务） |
| Windows（以管理员身份打开 PowerShell） | `irm http://www.yucg.cn:8251/downloads/server/install.ps1 \| iex` |
| Docker | `curl -fsSL http://www.yucg.cn:8251/downloads/server/linkme-server-docker.tar.gz \| tar xz && sh linkme-docker/install-docker.sh`（在仓库中也可直接运行 `sh deploy/docker/install-docker.sh`） |

这些命令也展示在下载页（`http://服务器地址:8251/#deploy`）的“服务器部署”部分，按系统分页，可以一键复制。

在线安装会自动下载对应系统和架构（amd64 / arm64）的安装包，并用 `SHA256SUMS.txt` 校验，校验不通过时不会做任何改动。也可以先下载安装包（`linkme-server-<系统>-<架构>.tar.gz`，Windows 为 `.zip`），在服务器上解压后运行其中的 `install.sh`（`sudo sh install.sh`）或 `install.ps1`（`powershell -ExecutionPolicy Bypass -File .\install.ps1`）。

### 无人值守安装

数据目录必须显式指定，其余问题使用默认值：

```sh
curl -fsSL http://www.yucg.cn:8251/downloads/server/install.sh | sudo sh -s -- --yes --data-dir /data/linkme-data --host chat.example.com
```

```powershell
& ([scriptblock]::Create((irm http://www.yucg.cn:8251/downloads/server/install.ps1))) -Yes -DataDir D:\LinkMe-data -PublicHost chat.example.com
```

如果以非交互方式运行却没有给出 `--data-dir`（Windows 为 `-DataDir`），脚本会直接退出，不会自行选盘。

### 安装后的目录

| | Linux | macOS | Windows | Docker |
|---|---|---|---|---|
| 程序 | `/opt/linkme`（root） | `~/linkme` | `C:\Program Files\LinkMe` | 镜像内 |
| 配置与私密文件 | `/etc/linkme`（仅服务用户 `linkme` 可读写） | `~/linkme/config` | `C:\ProgramData\LinkMe`（仅管理员与 SYSTEM） | `<数据目录>/config` |
| 数据 | 所选磁盘上的数据目录 | 同左 | 同左 | `<数据目录>/data` |
| 服务 | systemd `linkme.service`，以 `linkme` 用户运行，崩溃自动重启 | launchd，`KeepAlive` | Windows 服务 `LinkMe`，失败自动重启 | `restart: unless-stopped` |
| 日志 | `journalctl -u linkme -f` | 安装目录 `logs/` | `C:\ProgramData\LinkMe\server.log` | `docker compose logs -f` |

配置目录中包含：

- `config.json`：管理后台“系统设置”修改的就是它
- `private/`：邮件、Me 助手、媒体中继的密钥文件
- `config-backups/`：每次在后台保存设置前的旧版本

### 升级与卸载

在已经安装的服务器上再次运行同一条安装命令即升级，步骤如下：

1. 用新程序校验现有配置；
2. 停止服务，把旧程序和数据库备份到 `<安装目录>/backups/<时间>/`；
3. 替换程序并启动；
4. 健康检查。不通过时自动恢复旧程序和数据库，并启动旧版本。

升级不会修改配置和数据。Docker 再次运行 `install-docker.sh` 即升级。

卸载时，Linux / macOS 加 `--uninstall`，Windows 加 `-Uninstall`。卸载只删除服务和程序，配置与数据目录会保留，脚本会打印它们的位置。

### 端口

| 端口 | 协议 | 用途 |
|---|---|---|
| 8250 | TCP | 客户端 API |
| 8251 | TCP | 下载页、安装包与网站上的管理后台（`/admin/`） |
| 8252 | TCP + UDP | 媒体中继（TURN），启用中继时 |
| 20000–20127 | UDP | 中继转发端口范围，启用中继时 |
| 8253 | TCP | 管理后台独立端口（可选；网站上的 `/admin/` 入口不需要它） |

### 发布安装包

在开发机运行 `node scripts/build-server.mjs`，它会为 5 个平台（linux、darwin × amd64/arm64，windows/amd64）编译服务端，在 `dist/server/` 生成各平台安装包、Docker 安装包 `linkme-server-docker.tar.gz`、`install.sh`、`install.ps1` 和 `SHA256SUMS.txt`。把这些文件复制到服务器的 `<下载目录>/server/`，即可通过上面的在线命令安装。

## 客户端自动更新与 linkme-AIdex

客户端只从自己连接的服务器获取更新，不会访问官网：

- **客户端程序**：服务器在下载目录发布 `app.json`（官方签名的版本清单）和各平台安装包。客户端启动后和每 6 小时检查一次，有新版本就在后台下载、校验，然后提示“立即更新”。Windows 和 macOS 重启后完成更新，Android 打开系统安装界面。
- **linkme-AIdex**（Me 处理本机文件和任务的组件，不在安装包里）：服务器在 `<下载目录>/tools/` 发布 `aidex.json` 和各平台压缩包。桌面客户端第一次使用本机任务时下载，之后服务器有新版本就自动更新。

维护人员在管理后台把官网的新版本同步到本服务器：

- “客户端安装包”页的“从官网更新”；
- “linkme-AIdex”页的“从官网更新”。

服务器和客户端都会用内置公钥核对官方签名和每个文件的 SHA-256，校验不通过不会发布，也不会安装。手动上传的安装包可以照常下载，但上传后服务器会停止发布 `app.json`，客户端不再从这台服务器自动更新，直到下一次“从官网更新”。

官方发布（只在持有签名私钥的发布机上进行，私钥不进代码仓库）：

```bash
# linkme-AIdex：用官方 codex-app-server-package-*.tar.zst 生成压缩包和 aidex.json
go run ./cmd/aidex-pack -key ~/.linkme/aidex-signing.key -version 0.169.1 -windows <Windows 包> -mac <macOS 包> -out dist/tools
# 客户端：为已构建的安装包生成 app.json（每次发布先提升 internal/version 的版本号）
go run ./cmd/release-sign -key ~/.linkme/aidex-signing.key -name linkme-app -version 0.1.19 -out dist/app.json windows/amd64=dist/LinkMe-Setup.exe darwin/arm64=dist/LinkMe-macOS-arm64.zip android/arm64=dist/LinkMe-Android.apk
```

然后把 `dist/tools/*` 放到官网的 `<下载目录>/tools/`，把 `dist/app.json` 和安装包放到官网的 `<下载目录>/`。

## 客户端连接到你的服务器

员工在客户端登录页点击“服务器 … 切换”（或“连接设置”），填写服务器的 IP 或域名即可；`http://` 和默认 API 端口 8250 会自动补全，保存前客户端会检查能否连通并说明失败原因。之后用 **6 位 LinkMe 号或邮箱** 加密码登录，两种方式都可以，与服务器是否开启“邮箱登录”无关。账号在管理后台“用户管理”中创建；创建时填写邮箱，员工就可以用邮箱登录。

一键部署出来的服务器，下载页只提供客户端下载和“管理后台登录”入口，不会显示本页的部署教程；部署教程只出现在发布安装包的官网上。

## 管理后台

安装完成后，点击下载页右上角的 **管理后台登录**，或直接打开 `http://服务器地址:8251/admin/`（API 端口 8250 下的 `/admin/` 同样可用），使用安装时设置的后台管理员账号登录。后台也在独立端口 `8253` 上提供，适合只在内网或本机管理时使用。后台账号与应用里的员工账号相互独立，员工账号无法登录后台；应用内也不再有任何管理员功能。

| 页面 | 可以做什么 |
|---|---|
| 概览 | 用户数、在线人数、群聊、消息、会议、网盘占用；数据目录与各存储盘剩余空间；服务地址、端口、已启用功能 |
| 用户管理 | 搜索（姓名、号码、邮箱、手机、职位）与筛选（正常 / 已停用）；新建账号（可自动生成密码，只显示一次）；编辑姓名、邮箱、手机号、性别、职位、个性签名；重置密码；停用 / 启用账号（停用立即下线且无法再登录，数据保留）；查看登录设备并下线单台设备或全部下线；查看好友、群聊、消息、网盘和附件使用情况；重置头像；删除账号（需输入 LinkMe 号确认，聊天记录保留为“已注销用户”） |
| 后台管理员 | 添加、停用、删除后台管理员，重置其密码（至少保留一个可用管理员） |
| 系统设置 | 以表单修改配置文件中的全部设置：地址与端口、数据与存储（含附加存储盘）、账号与登录、聊天与消息、网盘与个人空间、会议与通话（含媒体中继）、Me 助手；也可直接编辑完整 JSON。保存前校验，旧版本自动备份到配置文件旁的 `config-backups/`（保留最近 20 份） |
| 凭据与密钥 | 邮件服务（腾讯云 SES）、Me 助手接口、媒体中继密钥。密钥只写不读，留空表示保持原值；文件权限为仅服务可读 |
| 客户端安装包 | 上传或删除下载页提供的 Windows、Android、macOS 安装包，自动更新 `SHA256SUMS.txt`；上传时校验文件类型 |
| 操作日志 | 后台中每一次操作（登录、账号变更、设置修改、重启等）的时间、管理员、对象、详情与来源 IP |

设置保存后写入配置文件，**重启服务后生效**。由系统服务（systemd、launchd、Windows 服务或 Docker）托管时，页面顶部会出现“立即重启服务”按钮，重启通常只需几秒，客户端会自动重连。

### 安全建议

- 默认在网站上提供后台入口（`/admin/`，下载页右上角有“管理后台登录”按钮），与下载页共用端口，无需额外开放端口。不希望后台出现在公网时，在“系统设置 → 地址与端口”关闭 **在网站提供管理后台入口**，并把独立端口改为 `127.0.0.1:8253`，或用防火墙只允许办公网络访问 8253。
- 关闭网站入口后，可以通过 SSH 隧道访问独立端口：`ssh -L 8253:127.0.0.1:8253 用户@服务器`（需要时加 `-p SSH端口`），然后在本机浏览器打开 `http://127.0.0.1:8253`。服务器在路由器后面时，要从外网直接访问，需在路由器上把 8253 端口转发到服务器。
- 登录有频率限制（同一用户名 15 分钟内最多 5 次），会话 12 小时后过期；修改密码会让该管理员的其他登录失效。
- 所有修改类请求都要求同源页面发出（带 `X-LinkMe-Console` 头和 `SameSite=Strict` 会话 Cookie），第三方网页无法代为操作。

### 忘记后台密码

在服务器上运行（会创建该管理员，或重置其密码并让其所有登录失效）：

```sh
printf '新的密码至少10位' > /tmp/pw && linkme-server -config 配置文件路径 -console-admin admin -console-password-file /tmp/pw && rm /tmp/pw
```

Windows（管理员 PowerShell）：

```powershell
Set-Content -NoNewline $env:TEMP\pw '新的密码至少10位'; & 'C:\Program Files\LinkMe\linkme-server.exe' -config C:\ProgramData\LinkMe\config.json -console-admin admin -console-password-file $env:TEMP\pw; Remove-Item $env:TEMP\pw
```

### 命令行参数

| 参数 | 说明 |
|---|---|
| `-config 文件` | 配置文件（JSON）。后台修改的就是这个文件 |
| `-check-config` | 只校验配置文件，有效时输出“配置有效”并以 0 退出 |
| `-console-admin 用户名 -console-password-file 文件` | 创建后台管理员或重置其密码，然后退出 |
| `-version` | 输出版本号 |

环境变量 `LINKME_SUPERVISED=1` 表示进程由服务管理器托管（退出后会被自动拉起），后台的“重启服务”依赖它；安装脚本会自动设置。Windows 服务模式下程序会自动识别并设置。
