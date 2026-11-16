#!/bin/sh
# LinkMe 服务器 Docker 一键部署：选择数据盘 -> 生成 .env -> docker compose up -d
#
#   sh deploy/docker/install-docker.sh [--data-dir DIR] [--host HOST] [--yes]
#   或从安装包：curl -fsSL http://HOST:8251/downloads/server/linkme-server-docker.tar.gz | tar xz && sh linkme-docker/install-docker.sh
#
# 再次运行即为升级：沿用已有 .env，重新构建镜像并重建容器，数据不变。
# 程序来自 dist/server/bin/linux-<arch>/linkme-server（node scripts/build-server.mjs）。
#
# 环境变量：LINKME_ANSWERS 应答文件（每行回答一个问题，自动化测试用）
# shellcheck disable=SC2154,SC2034
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
ENV_FILE=$SCRIPT_DIR/.env
OPT_DATA_DIR=''
OPT_HOST=''
ASSUME_YES=0

say() { printf '%s\n' "$*"; }
info() { printf '==> %s\n' "$*"; }
warn() { printf '警告：%s\n' "$*" >&2; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

while [ $# -gt 0 ]; do
	case $1 in
	--data-dir) [ $# -ge 2 ] || die "--data-dir 需要参数"; OPT_DATA_DIR=$2; shift 2 ;;
	--data-dir=*) OPT_DATA_DIR=${1#*=}; shift ;;
	--host) [ $# -ge 2 ] || die "--host 需要参数"; OPT_HOST=$2; shift 2 ;;
	--host=*) OPT_HOST=${1#*=}; shift ;;
	-y | --yes) ASSUME_YES=1; shift ;;
	-h | --help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
	*) die "未知参数：$1" ;;
	esac
done

case $(uname -s) in
Linux) OS=linux ;;
Darwin) OS=darwin ;;
MINGW* | MSYS* | CYGWIN*)
	OS=windows
	# Git Bash 会把 /data/... 之类的参数改写成 Windows 路径，传给容器前关闭
	MSYS_NO_PATHCONV=1
	export MSYS_NO_PATHCONV
	;;
*) die "不支持的系统：$(uname -s)" ;;
esac

# ---------------------------------------------------------------- 输入
HAVE_INPUT=0
INPUT_IS_TTY=0
if [ -n "${LINKME_ANSWERS:-}" ]; then
	exec 3<"$LINKME_ANSWERS"
	HAVE_INPUT=1
elif (: </dev/tty) 2>/dev/null; then
	exec 3</dev/tty
	HAVE_INPUT=1
	INPUT_IS_TTY=1
fi
trap '[ "$INPUT_IS_TTY" = 1 ] && stty echo </dev/tty 2>/dev/null; true' EXIT
trap 'exit 130' INT TERM

read_line() {
	_rl=''
	[ "$HAVE_INPUT" = 1 ] || return 1
	if IFS= read -r _rl <&3; then :; elif [ -z "$_rl" ]; then return 1; fi
	_rl=$(printf '%s' "$_rl" | tr -d '\r')
	[ "$INPUT_IS_TTY" = 1 ] || printf '%s\n' "$_rl"
	eval "$1=\$_rl"
}

ask() {
	if [ "$ASSUME_YES" = 1 ] || [ "$HAVE_INPUT" != 1 ]; then eval "$1=\$3"; return 0; fi
	if [ -n "$3" ]; then printf '%s [%s]: ' "$2" "$3"; else printf '%s: ' "$2"; fi
	_ans=''
	read_line _ans || die "输入已结束（$2）"
	[ -n "$_ans" ] || _ans=$3
	eval "$1=\$_ans"
}

ask_yn() {
	while :; do
		if [ "$ASSUME_YES" = 1 ] || [ "$HAVE_INPUT" != 1 ]; then
			_yn=$3
		else
			if [ "$3" = y ]; then printf '%s [Y/n]: ' "$2"; else printf '%s [y/N]: ' "$2"; fi
			_yn=''
			read_line _yn || die "输入已结束（$2）"
			[ -n "$_yn" ] || _yn=$3
		fi
		case $_yn in
		y | Y | yes | 是) eval "$1=1"; return 0 ;;
		n | N | no | 否) eval "$1=0"; return 0 ;;
		*) say '请输入 y 或 n。' ;;
		esac
	done
}

ask_secret() {
	printf '%s: ' "$2"
	_sec=''
	if [ "$INPUT_IS_TTY" = 1 ]; then
		stty -echo <&3 2>/dev/null || true
		IFS= read -r _sec <&3 || true
		stty echo <&3 2>/dev/null || true
		printf '\n'
	else
		IFS= read -r _sec <&3 || [ -n "$_sec" ] || die "输入已结束（$2）"
		_sec=$(printf '%s' "$_sec" | tr -d '\r')
		if [ -n "$_sec" ]; then say '********'; else say ''; fi
	fi
	eval "$1=\$_sec"
}

human_kb() {
	awk -v k="$1" 'BEGIN { if (k >= 1073741824) printf "%.1fT", k/1073741824; else if (k >= 1048576) printf "%.1fG", k/1048576; else printf "%.0fM", k/1024 }'
}

valid_port() {
	case $1 in '' | *[!0-9]*) return 1 ;; esac
	[ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

http_get() {
	if have curl; then
		curl -fsS --max-time 3 "$1" 2>/dev/null
	elif have wget; then
		wget -q -T 3 -O - "$1" 2>/dev/null
	else
		return 1
	fi
}

# ---------------------------------------------------------------- 磁盘选择（与 install.sh 相同的规则）
list_disks() {
	_df=$(df -P -k 2>/dev/null) || return 0
	if [ -r /proc/self/mounts ]; then
		_types=$(awk '{ m = $2; gsub(/\\040/, " ", m); print m "\t" $3 }' /proc/self/mounts)
	elif have mount; then
		_types=$(mount | awk '{ s = $0; sub(/^.* on /, "", s); t = s; sub(/ \(.*$/, "", s); sub(/^.* \(/, "", t); sub(/[,)].*$/, "", t); print s "\t" t }')
	else
		_types=''
	fi
	printf '%s\n' "$_df" | LINKME_MOUNT_TYPES=$_types awk -v os="$OS" '
		BEGIN {
			n = split(ENVIRON["LINKME_MOUNT_TYPES"], rows, "\n")
			for (i = 1; i <= n; i++) { split(rows[i], kv, "\t"); t[kv[1]] = kv[2] }
			split("tmpfs devtmpfs overlay overlayfs squashfs proc sysfs cgroup cgroup2 devpts mqueue debugfs tracefs securityfs pstore bpf configfs fusectl hugetlbfs autofs ramfs nsfs efivarfs binfmt_misc rpc_pipefs nfsd iso9660 udf devfs map nullfs fdesc shm aufs fuse.lxcfs fuse.snapfuse fuse.portal fuse.gvfsd-fuse", skip, " ")
			for (i in skip) bad[skip[i]] = 1
			idx = 0
		}
		NR == 1 { next }
		{
			mnt = $6
			for (i = 7; i <= NF; i++) mnt = mnt " " $i
			dev = $1; total = $2; avail = $4
			type = (mnt in t) ? t[mnt] : ""
			if ((type in bad) || (dev in bad)) next
			if (dev == "none" || dev == "udev" || dev == "shm" || dev ~ /^map /) next
			if (total + 0 < 1048576) next
			if (mnt ~ /^\/(proc|sys|dev|run|snap|boot)(\/|$)/) next
			if (mnt ~ /^\/var\/lib\/(docker|containers|snapd)\//) next
			if (os == "darwin" && mnt ~ /^\/(System\/Volumes|private\/var\/vm|Library\/Developer)/) next
			if (os == "darwin" && mnt ~ /^\/Volumes\/(Recovery|Preboot|VM|Update)$/) next
			if (os == "windows" && (mnt == "/" || mnt == "/tmp" || mnt ~ /^\/usr\//)) next
			if (seen[mnt]++) next
			idx++
			printf "%d|%s|%s|%s|%s|%s\n", idx, mnt, type, total, avail, dev
		}'
}

choose_data_dir() {
	if [ -n "$OPT_DATA_DIR" ]; then DATA_ROOT=$OPT_DATA_DIR; return 0; fi
	[ "$HAVE_INPUT" = 1 ] || die "非交互运行时必须用 --data-dir 指定数据目录（数据盘必须由人工选择）。"
	DISKS=$(list_disks)
	say ''
	say '请选择用于存放 LinkMe 数据（数据库、文件、下载、配置）的磁盘：'
	if [ -z "$DISKS" ]; then
		say '  （未检测到可用的磁盘分区，请直接输入数据目录）'
		DATA_ROOT=''
		while [ -z "$DATA_ROOT" ]; do
			printf '数据目录（绝对路径）: '
			read_line DATA_ROOT || die "输入已结束（数据目录）"
		done
		return 0
	fi
	printf '%s\n' "$DISKS" | while IFS='|' read -r n mnt type total avail dev; do
		printf '  %2s) %-28s %-8s 总容量 %-8s 可用 %-8s %s\n' "$n" "$mnt" "${type:--}" "$(human_kb "$total")" "$(human_kb "$avail")" "$dev"
	done
	_count=$(printf '%s\n' "$DISKS" | wc -l | tr -d ' ')
	while :; do
		printf '请输入磁盘编号 (1-%s): ' "$_count"
		_pick=''
		read_line _pick || die "输入已结束（未选择数据盘）"
		case $_pick in '' | *[!0-9]*) say '请输入列表中的编号。'; continue ;; esac
		if [ "$_pick" -ge 1 ] && [ "$_pick" -le "$_count" ]; then break; fi
		say '编号超出范围。'
	done
	_mnt=$(printf '%s\n' "$DISKS" | sed -n "${_pick}p" | cut -d'|' -f2)
	_avail=$(printf '%s\n' "$DISKS" | sed -n "${_pick}p" | cut -d'|' -f5)
	[ "$_avail" -ge 5242880 ] || warn "所选磁盘可用空间不足 5G（$(human_kb "$_avail")）。"
	if [ "$_mnt" = / ]; then _def=/linkme-data; else _def=$_mnt/linkme-data; fi
	printf '数据目录（回车确认，或输入新路径） [%s]: ' "$_def"
	_dd=''
	read_line _dd || die "输入已结束（数据目录）"
	[ -n "$_dd" ] || _dd=$_def
	DATA_ROOT=$_dd
}

# ---------------------------------------------------------------- 检查环境
COMPOSE_DIR=$SCRIPT_DIR
if [ "$OS" = windows ] && have cygpath; then COMPOSE_DIR=$(cygpath -m "$SCRIPT_DIR"); fi
have docker || die "未找到 docker，请先安装 Docker Engine 或 Docker Desktop。"
if docker compose version >/dev/null 2>&1; then
	compose() { docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_DIR/compose.yaml" "$@"; }
elif have docker-compose; then
	compose() { docker-compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_DIR/compose.yaml" "$@"; }
else
	die "未找到 docker compose 插件（或 docker-compose）。"
fi
docker info >/dev/null 2>&1 || die "无法连接 Docker（守护进程未运行，或当前用户无权限；可尝试 sudo）。"

case $(docker version --format '{{.Server.Arch}}' 2>/dev/null || uname -m) in
x86_64 | amd64) ARCH=amd64 ;;
aarch64 | arm64) ARCH=arm64 ;;
*) ARCH=amd64 ;;
esac
# 从安装包（linkme-server-docker.tar.gz）运行时，程序就在本目录的 bin/ 下。
BUILD_ENV=''
if [ -f "$SCRIPT_DIR/bin/linux-$ARCH/linkme-server" ] && [ -f "$SCRIPT_DIR/Dockerfile" ]; then
	BUILD_ENV="LINKME_BUILD_CONTEXT=.
LINKME_DOCKERFILE=Dockerfile
LINKME_BIN_DIR=bin
LINKME_ENTRYPOINT_SRC=entrypoint.sh"
elif [ ! -f "$REPO_ROOT/dist/server/bin/linux-$ARCH/linkme-server" ]; then
	die "缺少 dist/server/bin/linux-$ARCH/linkme-server，请先在仓库根目录运行：node scripts/build-server.mjs"
fi

# ---------------------------------------------------------------- 升级
if [ -f "$ENV_FILE" ]; then
	say "发现已有部署配置：$ENV_FILE"
	ask_yn _reuse '沿用该配置升级（重新构建镜像并重建容器，数据不变）？' y
	[ "$_reuse" = 1 ] || die "如需重新部署，请先手工移走 $ENV_FILE。"
	API_PORT=$(sed -n 's/^LINKME_API_PORT=//p' "$ENV_FILE")
	API_PORT=${API_PORT:-8250}
	info "重新构建并启动"
	compose up -d --build
	i=0
	until body=$(http_get "http://127.0.0.1:$API_PORT/health") && case $body in *'"ok":true'*) true ;; *) false ;; esac; do
		i=$((i + 1))
		[ "$i" -lt 60 ] || die "60 秒内未通过健康检查。查看日志：docker compose -f $COMPOSE_DIR/compose.yaml logs"
		sleep 1
	done
	say "升级完成：$body"
	exit 0
fi

# ---------------------------------------------------------------- 全新部署
say ''
say 'LinkMe 服务器 Docker 部署'
say '直接回车表示使用方括号中的默认值。'
choose_data_dir
DATA_ROOT=$(printf '%s' "$DATA_ROOT" | sed 's:/*$::')
case $DATA_ROOT in
/*) ;;
*) die "数据目录必须是绝对路径：$DATA_ROOT" ;;
esac
case $DATA_ROOT in *'"'* | *"'"* | *'$'* | *' '*) die "数据目录不能包含引号、\$ 或空格：$DATA_ROOT" ;; esac
[ -n "$DATA_ROOT" ] || die "数据目录不能是根目录"

if [ -n "$OPT_HOST" ]; then
	PUBLIC_HOST=$OPT_HOST
else
	_ip=''
	if have ip; then _ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}'); fi
	if [ -z "$_ip" ] && [ "$OS" = darwin ]; then _ip=$(ipconfig getifaddr en0 2>/dev/null || true); fi
	[ -n "$_ip" ] && say "检测到本机 IP：$_ip（若服务器在 NAT 之后，请输入公网 IP 或域名）"
	if [ "$ASSUME_YES" = 1 ] || [ "$HAVE_INPUT" != 1 ]; then
		[ -n "$_ip" ] || die "无法检测本机 IP，请用 --host 指定。"
		PUBLIC_HOST=$_ip
	else
		PUBLIC_HOST=''
		while [ -z "$PUBLIC_HOST" ]; do
			ask PUBLIC_HOST '公网地址（客户端用来连接的 IP 或域名）' "$_ip"
		done
	fi
fi
PUBLIC_HOST=$(printf '%s' "$PUBLIC_HOST" | sed 's#^[a-zA-Z]*://##; s#/.*$##')
case $PUBLIC_HOST in '' | *[!A-Za-z0-9.-]*) die "公网地址只能包含字母、数字、点和短横线：$PUBLIC_HOST" ;; esac

API_PORT=8250 DOWNLOAD_PORT=8251 TURN_PORT=8252 CONSOLE_PORT=8253
ask_yn _defports '使用默认端口（API 8250、下载页 8251、媒体中继 8252、控制台 8253）？' y
if [ "$_defports" = 0 ]; then
	for _p in API_PORT:API DOWNLOAD_PORT:下载页 TURN_PORT:媒体中继TURN CONSOLE_PORT:控制台; do
		_var=${_p%%:*}
		eval "_cur=\$$_var"
		while :; do
			ask "$_var" "${_p#*:} 端口" "$_cur"
			eval "_val=\$$_var"
			valid_port "$_val" && break
			say '端口必须是 1-65535 的数字。'
		done
	done
fi
ask_yn MEDIA '启用媒体中继（TURN，需要发布 UDP 20000-20127）？' y
ask CONSOLE_USER '控制台管理员用户名' admin
case $CONSOLE_USER in '' | *[!A-Za-z0-9._@-]*) die "用户名只能包含字母、数字以及 . _ @ -" ;; esac
CONSOLE_PASSWORD=''
if [ "$ASSUME_YES" != 1 ] && [ "$HAVE_INPUT" = 1 ]; then
	while :; do
		ask_secret CONSOLE_PASSWORD '控制台管理员密码（至少 10 位，直接回车由容器自动生成）'
		[ -n "$CONSOLE_PASSWORD" ] || break
		case $CONSOLE_PASSWORD in *[!A-Za-z0-9._@%+=:,/-]*) say '密码只能包含字母、数字和 ._@%+=:,/-（或回车自动生成）'; continue ;; esac
		[ "${#CONSOLE_PASSWORD}" -ge 10 ] && break
		say '密码至少 10 位。'
	done
fi

say ''
say '即将部署：'
say "  数据目录：  $DATA_ROOT（config/ 与 data/ 两个子目录）"
say "  公网地址：  $PUBLIC_HOST"
say "  端口：      API $API_PORT，下载页 $DOWNLOAD_PORT，控制台 $CONSOLE_PORT，TURN $TURN_PORT$([ "$MEDIA" = 1 ] && printf '，UDP 20000-20127')"
say "  控制台账号：$CONSOLE_USER"
ask_yn _go '确认部署？' y
[ "$_go" = 1 ] || die "已取消"

mkdir -p "$DATA_ROOT/config" "$DATA_ROOT/data" || die "无法创建数据目录 $DATA_ROOT（可能需要 sudo）"
COMPOSE_DATA_DIR=$DATA_ROOT
if [ "$OS" = windows ] && have cygpath; then COMPOSE_DATA_DIR=$(cygpath -m "$DATA_ROOT"); fi

(
	umask 077
	cat >"$ENV_FILE" <<EOF
# 由 install-docker.sh 生成；修改后执行 docker compose up -d 生效
LINKME_DATA_DIR=$COMPOSE_DATA_DIR
LINKME_PUBLIC_HOST=$PUBLIC_HOST
LINKME_API_PORT=$API_PORT
LINKME_DOWNLOAD_PORT=$DOWNLOAD_PORT
LINKME_TURN_PORT=$TURN_PORT
LINKME_CONSOLE_PORT=$CONSOLE_PORT
LINKME_MEDIA_ENABLED=$MEDIA
LINKME_CONSOLE_USER=$CONSOLE_USER
LINKME_CONSOLE_PASSWORD=$CONSOLE_PASSWORD
${BUILD_ENV}
EOF
)
chmod 600 "$ENV_FILE"
info "已写入 $ENV_FILE"

info "构建镜像并启动容器"
compose up -d --build
info "等待健康检查 http://127.0.0.1:$API_PORT/health"
i=0
body=''
while :; do
	body=$(http_get "http://127.0.0.1:$API_PORT/health" || compose exec -T linkme wget -q -T 3 -O - "http://127.0.0.1:$API_PORT/health" 2>/dev/null || true)
	case $body in *'"ok":true'*) break ;; esac
	i=$((i + 1))
	[ "$i" -lt 60 ] || die "60 秒内未通过健康检查。查看日志：docker compose -f $COMPOSE_DIR/compose.yaml logs"
	sleep 1
done

say ''
say '================================================================'
say ' LinkMe 服务器（Docker）部署完成，运行正常'
say '================================================================'
say "  API 地址：      http://$PUBLIC_HOST:$API_PORT"
say "  下载页：        http://$PUBLIC_HOST:$DOWNLOAD_PORT"
say "  管理后台：      http://$PUBLIC_HOST:$DOWNLOAD_PORT/admin/   （下载页右上角“管理后台登录”）"
say "  后台独立端口：  http://$PUBLIC_HOST:$CONSOLE_PORT/"
say "  控制台用户名：  $CONSOLE_USER"
if [ -n "$CONSOLE_PASSWORD" ]; then
	say "  控制台密码：    $CONSOLE_PASSWORD（已保存在 $ENV_FILE，权限 600；登录后建议修改）"
else
	_pw=$(compose exec -T linkme cat /data/console-admin.txt 2>/dev/null | sed -n 's/^密码：//p' || true)
	if [ -n "$_pw" ]; then
		say "  控制台密码：    $_pw（自动生成，另存于 $DATA_ROOT/data/console-admin.txt）"
	else
		say "  控制台密码：    自动生成，见 $DATA_ROOT/data/console-admin.txt"
	fi
fi
say "  数据目录：      $DATA_ROOT"
say "  查看日志：      docker compose -f $COMPOSE_DIR/compose.yaml logs -f"
if [ -n "$BUILD_ENV" ]; then
	say "  升级：          下载新的 linkme-server-docker.tar.gz 并解压到同一位置，再次运行本脚本"
else
	say "  升级：          重新编译程序（node scripts/build-server.mjs）后再次运行本脚本"
fi
say "  防火墙/安全组：请放行 TCP $API_PORT,$DOWNLOAD_PORT,$CONSOLE_PORT$([ "$MEDIA" = 1 ] && printf '，TCP/UDP %s，UDP 20000-20127' "$TURN_PORT")"
say '================================================================'
