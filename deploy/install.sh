#!/bin/sh
# LinkMe 服务器一键安装 / 升级 / 卸载（Linux systemd、macOS launchd）
#
#   从解压后的安装包运行：   sudo sh install.sh
#   在线安装：               curl -fsSL http://HOST:8251/downloads/server/install.sh | sudo sh
#   传参（在线）：           curl -fsSL .../install.sh | sudo sh -s -- --data-dir /data/linkme-data
#
# 参数：
#   --data-dir DIR      数据目录（无人值守时必填；交互时不填则从磁盘列表中选择）
#   --install-dir DIR   安装目录（默认 Linux /opt/linkme，macOS $HOME/linkme；程序目录，属 root）
#   --config-dir DIR    配置目录（默认 Linux /etc/linkme，macOS <安装目录>/config；属服务用户，
#                       存放 config.json、private/（密钥文件）和 config-backups/）
#   --host HOST         公网地址（IP 或域名）
#   --binary FILE       使用指定的 linkme-server 程序（默认：安装包内的程序或在线下载）
#   --yes               除数据目录外全部使用默认值
#   --uninstall         卸载服务与程序，保留配置和数据
#   --no-service        不安装系统服务、不改防火墙，只打印启动命令（测试用）
#
# 环境变量：
#   LINKME_DOWNLOAD_BASE  在线下载地址（默认 http://www.yucg.cn:8251/downloads/server）
#   LINKME_ANSWERS        应答文件：每行回答一个问题（自动化测试用），空行表示默认值
# 许多变量通过 eval 间接赋值，shellcheck 无法跟踪：
# shellcheck disable=SC2154,SC2034
set -eu
umask 022

DOWNLOAD_BASE=${LINKME_DOWNLOAD_BASE:-http://www.yucg.cn:8251/downloads/server}
DOWNLOAD_BASE=${DOWNLOAD_BASE%/}
SERVICE_NAME=linkme
LAUNCHD_LABEL=cn.linkme.server
SVC_USER=linkme
RELAY_MIN=20000
RELAY_MAX=20127

OPT_DATA_DIR=''
OPT_INSTALL_DIR=''
OPT_CONFIG_DIR=''
OPT_HOST=''
OPT_BINARY=''
ASSUME_YES=0
DO_UNINSTALL=0
NO_SERVICE=0
TMP_DIR=''
PW_FILE=''

# ---------------------------------------------------------------- 输出工具
say() { printf '%s\n' "$*"; }
info() { printf '==> %s\n' "$*"; }
warn() { printf '警告：%s\n' "$*" >&2; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

cleanup() {
	[ -n "$PW_FILE" ] && rm -f "$PW_FILE"
	[ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR"
	[ "${INPUT_IS_TTY:-0}" = 1 ] && stty echo </dev/tty 2>/dev/null
	return 0
}
trap cleanup EXIT
trap 'exit 130' INT TERM

usage() {
	sed -n '2,21p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true
}

while [ $# -gt 0 ]; do
	case $1 in
	--data-dir) [ $# -ge 2 ] || die "--data-dir 需要参数"; OPT_DATA_DIR=$2; shift 2 ;;
	--data-dir=*) OPT_DATA_DIR=${1#*=}; shift ;;
	--install-dir) [ $# -ge 2 ] || die "--install-dir 需要参数"; OPT_INSTALL_DIR=$2; shift 2 ;;
	--install-dir=*) OPT_INSTALL_DIR=${1#*=}; shift ;;
	--config-dir) [ $# -ge 2 ] || die "--config-dir 需要参数"; OPT_CONFIG_DIR=$2; shift 2 ;;
	--config-dir=*) OPT_CONFIG_DIR=${1#*=}; shift ;;
	--host) [ $# -ge 2 ] || die "--host 需要参数"; OPT_HOST=$2; shift 2 ;;
	--host=*) OPT_HOST=${1#*=}; shift ;;
	--binary) [ $# -ge 2 ] || die "--binary 需要参数"; OPT_BINARY=$2; shift 2 ;;
	--binary=*) OPT_BINARY=${1#*=}; shift ;;
	-y | --yes) ASSUME_YES=1; shift ;;
	--uninstall) DO_UNINSTALL=1; shift ;;
	--no-service) NO_SERVICE=1; shift ;;
	-h | --help) usage; exit 0 ;;
	*) die "未知参数：$1（使用 --help 查看帮助）" ;;
	esac
done

# ---------------------------------------------------------------- 平台
case $(uname -s) in
Linux) OS=linux ;;
Darwin) OS=darwin ;;
*) die "不支持的系统：$(uname -s)。Windows 请使用 install.ps1，其他系统可使用 Docker。" ;;
esac
case $(uname -m) in
x86_64 | amd64) ARCH=amd64 ;;
aarch64 | arm64) ARCH=arm64 ;;
*) die "不支持的 CPU 架构：$(uname -m)（支持 amd64、arm64）" ;;
esac
IS_ROOT=0
[ "$(id -u)" -eq 0 ] && IS_ROOT=1

if [ "$OS" = linux ]; then
	[ "$IS_ROOT" = 1 ] || die "请以 root 身份运行（例如：sudo sh install.sh）"
	DEFAULT_INSTALL_DIR=/opt/linkme
	DEFAULT_CONFIG_DIR=/etc/linkme
	# 状态文件放在 root 专属目录：配置目录属于服务用户，不能用来保存会被 root 读取的状态
	STATE_FILE=/var/lib/linkme-installer/state.env
else
	if [ "$IS_ROOT" = 1 ]; then
		DEFAULT_INSTALL_DIR=/usr/local/linkme
		DEFAULT_CONFIG_DIR=''
		STATE_FILE="/Library/Application Support/LinkMe/installer.env"
		LAUNCHD_DOMAIN=system
		PLIST=/Library/LaunchDaemons/$LAUNCHD_LABEL.plist
	else
		DEFAULT_INSTALL_DIR=$HOME/linkme
		DEFAULT_CONFIG_DIR=''
		STATE_FILE="$HOME/Library/Application Support/LinkMe/installer.env"
		LAUNCHD_DOMAIN=gui/$(id -u)
		PLIST=$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist
	fi
	SVC_USER=''
fi

# ---------------------------------------------------------------- 输入
# 回答来源优先级：LINKME_ANSWERS 文件 > 终端 /dev/tty > 无（非交互）
HAVE_INPUT=0
INPUT_IS_TTY=0
if [ -n "${LINKME_ANSWERS:-}" ]; then
	[ -r "$LINKME_ANSWERS" ] || die "无法读取应答文件 $LINKME_ANSWERS"
	exec 3<"$LINKME_ANSWERS"
	HAVE_INPUT=1
elif (: </dev/tty) 2>/dev/null; then
	exec 3</dev/tty
	HAVE_INPUT=1
	INPUT_IS_TTY=1
fi

# read_line VAR：读取一行到 VAR；输入结束返回 1
read_line() {
	_rl=''
	if [ "$HAVE_INPUT" != 1 ]; then
		return 1
	fi
	if IFS= read -r _rl <&3; then
		:
	elif [ -z "$_rl" ]; then
		return 1
	fi
	_rl=$(printf '%s' "$_rl" | tr -d '\r')
	[ "$INPUT_IS_TTY" = 1 ] || printf '%s\n' "$_rl"
	eval "$1=\$_rl"
}

# ask VAR 提示 默认值：--yes 或无输入时直接取默认值
ask() {
	if [ "$ASSUME_YES" = 1 ] || [ "$HAVE_INPUT" != 1 ]; then
		eval "$1=\$3"
		return 0
	fi
	if [ -n "$3" ]; then printf '%s [%s]: ' "$2" "$3"; else printf '%s: ' "$2"; fi
	_ans=''
	read_line _ans || die "输入已结束（$2）"
	[ -n "$_ans" ] || _ans=$3
	eval "$1=\$_ans"
}

# ask_yn VAR 提示 默认(y/n)：结果为 1 或 0
ask_yn() {
	_def=$3
	while :; do
		if [ "$ASSUME_YES" = 1 ] || [ "$HAVE_INPUT" != 1 ]; then
			_yn=$_def
		else
			if [ "$_def" = y ]; then printf '%s [Y/n]: ' "$2"; else printf '%s [y/N]: ' "$2"; fi
			_yn=''
			read_line _yn || die "输入已结束（$2）"
			[ -n "$_yn" ] || _yn=$_def
		fi
		case $_yn in
		y | Y | yes | YES | 是) eval "$1=1"; return 0 ;;
		n | N | no | NO | 否) eval "$1=0"; return 0 ;;
		*) say "请输入 y 或 n。" ;;
		esac
	done
}

# ask_secret VAR 提示：不回显
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

# ---------------------------------------------------------------- 通用工具
have() { command -v "$1" >/dev/null 2>&1; }

random_alnum() { # random_alnum 长度
	LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c "$1"
}

random_hex() { # random_hex 字节数
	od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'
}

json_escape() {
	printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

xml_escape() {
	printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

valid_path() { # 绝对路径、不含换行/引号/反斜杠
	case $1 in
	/*) ;;
	*) return 1 ;;
	esac
	# shellcheck disable=SC1003
	case $1 in
	*'"'* | *'\'* | *"'"*) return 1 ;;
	esac
	[ "$(printf '%s' "$1" | wc -l | tr -d ' ')" = 0 ]
}

valid_port() {
	case $1 in
	'' | *[!0-9]*) return 1 ;;
	esac
	[ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

sha256_of() {
	if have sha256sum; then
		sha256sum "$1" | awk '{print $1}'
	elif have shasum; then
		shasum -a 256 "$1" | awk '{print $1}'
	elif have openssl; then
		openssl dgst -sha256 "$1" | awk '{print $NF}'
	else
		die "缺少 sha256sum/shasum，无法校验下载文件"
	fi
}

download() { # download URL 文件
	if have curl; then
		curl -fsSL --retry 2 --connect-timeout 15 -o "$2" "$1"
	elif have wget; then
		wget -q -O "$2" "$1"
	else
		die "需要 curl 或 wget 才能在线下载"
	fi
}

# http_get URL：输出响应体；失败返回非零
http_get() {
	if have curl; then
		curl -fsS --max-time 3 "$1" 2>/dev/null
	elif have wget; then
		wget -q -T 3 -O - "$1" 2>/dev/null
	elif have bash; then
		# 最小系统（例如 debian-slim）没有 curl/wget 时，用 bash 的 /dev/tcp
		_hp=${1#http://}
		_hostport=${_hp%%/*}
		_path=/${_hp#*/}
		bash -c 'exec 9<>"/dev/tcp/${1%:*}/${1##*:}" || exit 1
			printf "GET %s HTTP/1.0\r\nHost: %s\r\nConnection: close\r\n\r\n" "$2" "$1" >&9
			cat <&9' _ "$_hostport" "$_path" 2>/dev/null
	elif have python3; then
		python3 -c 'import sys,urllib.request;sys.stdout.write(urllib.request.urlopen(sys.argv[1],timeout=3).read().decode())' "$1" 2>/dev/null
	else
		return 1
	fi
}

# wait_health 端口 秒数：成功时 HEALTH_BODY 为响应
wait_health() {
	_i=0
	HEALTH_BODY=''
	while [ "$_i" -lt "$2" ]; do
		HEALTH_BODY=$(http_get "http://127.0.0.1:$1/health" || true)
		case $HEALTH_BODY in
		*'"ok":true'* | *'"ok": true'*) return 0 ;;
		esac
		sleep 1
		_i=$((_i + 1))
	done
	return 1
}

port_in_use() { # TCP 端口是否已被监听（尽力检测）
	if have ss; then
		ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"
	elif have lsof; then
		lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
	elif have netstat; then
		netstat -an 2>/dev/null | grep -i listen | awk '{print $4}' | grep -Eq "[:.]$1\$"
	else
		return 1
	fi
}

human_kb() {
	awk -v k="$1" 'BEGIN { if (k >= 1073741824) printf "%.1fT", k/1073741824; else if (k >= 1048576) printf "%.1fG", k/1048576; else printf "%.0fM", k/1024 }'
}

# 从 config.json 读取简单字符串字段（安装程序写出的格式，或 Go 的缩进格式）
config_string() { # config_string 文件 键
	sed -n "s/^[[:space:]]*\"$2\"[[:space:]]*:[[:space:]]*\"\\(.*\\)\"[[:space:]]*,\\{0,1\\}[[:space:]]*\$/\\1/p" "$1" | head -n 1
}

listen_port() { # ":8250" / "0.0.0.0:8250" -> 8250
	printf '%s' "${1##*:}"
}

detect_ip() {
	_ip=''
	if [ "$OS" = linux ]; then
		if have ip; then
			_ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}')
		fi
		if [ -z "$_ip" ] && have hostname; then
			_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
		fi
		if [ -z "$_ip" ]; then
			_ip=$(awk '$1 != "127.0.0.1" && $1 ~ /^[0-9]+\./ { print $1; exit }' /etc/hosts 2>/dev/null || true)
		fi
	else
		_if=$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')
		[ -n "$_if" ] && _ip=$(ipconfig getifaddr "$_if" 2>/dev/null || true)
		[ -n "$_ip" ] || _ip=$(ipconfig getifaddr en0 2>/dev/null || true)
	fi
	printf '%s' "$_ip"
}

# ---------------------------------------------------------------- 磁盘选择
# 输出：编号|挂载点|类型|总KB|可用KB|设备
list_disks() {
	_df=$(df -P -k 2>/dev/null) || return 0
	if [ "$OS" = linux ] && [ -r /proc/self/mounts ]; then
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
			if (seen[mnt]++) next
			idx++
			printf "%d|%s|%s|%s|%s|%s\n", idx, mnt, type, total, avail, dev
		}'
}

default_data_dir_for() { # default_data_dir_for 挂载点
	if [ "$1" = / ]; then
		if [ "$OS" = darwin ]; then
			if [ "$IS_ROOT" = 1 ]; then printf '/usr/local/linkme-data'; else printf '%s/linkme-data' "$HOME"; fi
		else
			printf '/linkme-data'
		fi
	else
		printf '%s/linkme-data' "$1"
	fi
}

choose_data_dir() {
	if [ -n "$OPT_DATA_DIR" ]; then
		DATA_ROOT=$OPT_DATA_DIR
		info "使用命令行指定的数据目录：$DATA_ROOT"
		return 0
	fi
	if [ "$HAVE_INPUT" != 1 ]; then
		die "非交互运行时必须用 --data-dir 指定数据目录（数据盘必须由人工选择）。"
	fi
	DISKS=$(list_disks)
	say ''
	say '请选择用于存放 LinkMe 数据（数据库、文件、下载）的磁盘：'
	if [ -z "$DISKS" ]; then
		say '  （未检测到可用的磁盘分区，请直接输入数据目录）'
		_chosen=''
		while [ -z "$_chosen" ]; do
			printf '数据目录（绝对路径）: '
			read_line _chosen || die "输入已结束（数据目录）"
		done
		DATA_ROOT=$_chosen
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
		case $_pick in
		'' | *[!0-9]*) say '请输入列表中的编号。'; continue ;;
		esac
		if [ "$_pick" -ge 1 ] && [ "$_pick" -le "$_count" ]; then
			break
		fi
		say '编号超出范围。'
	done
	_line=$(printf '%s\n' "$DISKS" | sed -n "${_pick}p")
	_mnt=$(printf '%s' "$_line" | cut -d'|' -f2)
	_avail=$(printf '%s' "$_line" | cut -d'|' -f5)
	if [ "$_avail" -lt 5242880 ]; then
		warn "所选磁盘可用空间不足 5G（$(human_kb "$_avail")）。"
	fi
	_def=$(default_data_dir_for "$_mnt")
	printf '数据目录（回车确认，或输入新路径） [%s]: ' "$_def"
	_dd=''
	read_line _dd || die "输入已结束（数据目录）"
	[ -n "$_dd" ] || _dd=$_def
	DATA_ROOT=$_dd
}

check_data_root() {
	DATA_ROOT=$(printf '%s' "$DATA_ROOT" | sed 's:/*$::')
	[ -n "$DATA_ROOT" ] || die "数据目录不能是根目录 /"
	valid_path "$DATA_ROOT" || die "数据目录必须是绝对路径，且不能包含引号、反斜杠或换行：$DATA_ROOT"
	case $DATA_ROOT in
	/bin | /boot | /dev | /etc | /lib | /lib64 | /proc | /run | /sbin | /sys | /usr | /var | /tmp | /System | /Library | /Users | /home | /root | /Volumes | /mnt | /media)
		die "不能直接使用系统目录作为数据目录：$DATA_ROOT（请使用其下的子目录）" ;;
	esac
	if [ -d "$DATA_ROOT" ] && [ -n "$(ls -A "$DATA_ROOT" 2>/dev/null)" ] && [ ! -d "$DATA_ROOT/data" ]; then
		warn "数据目录 $DATA_ROOT 已存在且不为空，LinkMe 会在其中创建 data/ 和 downloads/。"
	fi
}

# ---------------------------------------------------------------- 程序获取
fetch_binary() {
	if [ -n "$OPT_BINARY" ]; then
		[ -f "$OPT_BINARY" ] || die "找不到程序：$OPT_BINARY"
		NEW_BIN=$OPT_BINARY
		return 0
	fi
	_self_dir=''
	case $0 in
	*/*) [ -f "$0" ] && _self_dir=$(cd "$(dirname "$0")" && pwd) ;;
	*) [ -f "./$0" ] && _self_dir=$(pwd) ;;
	esac
	if [ -n "$_self_dir" ] && [ -f "$_self_dir/linkme-server" ]; then
		NEW_BIN=$_self_dir/linkme-server
		info "使用安装包内的程序：$NEW_BIN"
		return 0
	fi
	TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t linkme)
	_name=linkme-server-$OS-$ARCH.tar.gz
	info "下载 $DOWNLOAD_BASE/$_name"
	download "$DOWNLOAD_BASE/SHA256SUMS.txt" "$TMP_DIR/SHA256SUMS.txt" || die "下载校验文件失败：$DOWNLOAD_BASE/SHA256SUMS.txt"
	download "$DOWNLOAD_BASE/$_name" "$TMP_DIR/$_name" || die "下载失败：$DOWNLOAD_BASE/$_name"
	_want=$(awk -v f="$_name" '$2 == f || $2 == "*" f { print $1; exit }' "$TMP_DIR/SHA256SUMS.txt")
	[ -n "$_want" ] || die "SHA256SUMS.txt 中没有 $_name"
	_got=$(sha256_of "$TMP_DIR/$_name")
	[ "$_want" = "$_got" ] || die "校验失败：$_name（期望 $_want，实际 $_got）"
	info "SHA256 校验通过"
	(cd "$TMP_DIR" && tar -xzf "$_name") || die "解压失败：$_name"
	NEW_BIN=$TMP_DIR/linkme-server-$OS-$ARCH/linkme-server
	[ -f "$NEW_BIN" ] || die "安装包中缺少 linkme-server"
}

check_binary() { # check_binary 程序：能运行并输出版本
	chmod 755 "$1" 2>/dev/null || true
	NEW_VERSION=$("$1" -version 2>/dev/null | head -n 1 | tr -d '\r') || NEW_VERSION=''
	[ -n "$NEW_VERSION" ] || die "程序无法运行或版本过旧（不支持 -version）：$1"
}

# ---------------------------------------------------------------- 状态
STATE_KEYS='INSTALL_DIR CONFIG_DIR CONFIG DATA_ROOT SERVICE_KIND SVC_USER API_PORT LAUNCHD_DOMAIN PLIST INSTALLED_AT VERSION'

write_state() {
	mkdir -p "$(dirname "$STATE_FILE")"
	chmod 700 "$(dirname "$STATE_FILE")" 2>/dev/null || true
	{
		say "# 由 LinkMe 安装程序生成，请勿手工修改"
		for _k in $STATE_KEYS; do
			eval "_v=\${$_k:-}"
			printf "%s='%s'\n" "$_k" "$(printf '%s' "$_v" | sed "s/'/'\\\\''/g")"
		done
	} >"$STATE_FILE"
	chmod 600 "$STATE_FILE"
	cp "$STATE_FILE" "$INSTALL_DIR/installer.env"
	chmod 600 "$INSTALL_DIR/installer.env"
}

load_state() {
	_sf=''
	if [ -n "$OPT_INSTALL_DIR" ] && [ -f "$OPT_INSTALL_DIR/installer.env" ]; then
		_sf=$OPT_INSTALL_DIR/installer.env
	elif [ -f "$STATE_FILE" ]; then
		_sf=$STATE_FILE
	fi
	[ -n "$_sf" ] || return 1
	# 只解析已知键，不 source 文件
	for _k in $STATE_KEYS; do
		_q="'"
		_v=$(sed -n "s/^$_k=$_q\\(.*\\)$_q\$/\\1/p" "$_sf" | head -n 1 | sed "s/${_q}[\\]${_q}${_q}/${_q}/g")
		eval "$_k=\$_v"
	done
	[ -n "${CONFIG_DIR:-}" ] || CONFIG_DIR=$(dirname "${CONFIG:-/}")
	[ -n "${INSTALL_DIR:-}" ] && [ -x "$INSTALL_DIR/linkme-server" ] && [ -f "${CONFIG:-}" ]
}

# ---------------------------------------------------------------- 服务管理
service_stop() {
	case $SERVICE_KIND in
	systemd) systemctl stop "$SERVICE_NAME.service" 2>/dev/null || true ;;
	launchd) launchctl bootout "$LAUNCHD_DOMAIN/$LAUNCHD_LABEL" >/dev/null 2>&1 || true ;;
	none) ;;
	esac
}

service_start() {
	case $SERVICE_KIND in
	systemd) systemctl start "$SERVICE_NAME.service" ;;
	launchd)
		launchctl bootout "$LAUNCHD_DOMAIN/$LAUNCHD_LABEL" >/dev/null 2>&1 || true
		_try=0
		until launchctl bootstrap "$LAUNCHD_DOMAIN" "$PLIST" 2>/dev/null; do
			_try=$((_try + 1))
			[ "$_try" -lt 5 ] || return 1
			sleep 1
		done
		launchctl kickstart "$LAUNCHD_DOMAIN/$LAUNCHD_LABEL" >/dev/null 2>&1 || true
		;;
	none) ;;
	esac
}

install_systemd_unit() {
	if [ ! -d /run/systemd/system ] || ! have systemctl; then
		die "未检测到 systemd。可使用 --no-service 手动运行，或使用 Docker 部署（deploy/docker）。"
	fi
	_mounts=''
	case $DATA_ROOT in
	*' '*) ;;
	*) _mounts="RequiresMountsFor=$DATA_ROOT" ;;
	esac
	# ProtectSystem=full 会把 /etc 设为只读；控制台需要写配置目录
	_rw=''
	case "$CONFIG_DIR$DATA_ROOT" in
	*' '*) ;;
	*) _rw="ReadWritePaths=$CONFIG_DIR $DATA_ROOT" ;;
	esac
	cat >/etc/systemd/system/$SERVICE_NAME.service <<EOF
# 由 LinkMe 安装程序生成
[Unit]
Description=LinkMe 服务器
Documentation=http://127.0.0.1:$API_PORT/health
After=network-online.target
Wants=network-online.target
$_mounts

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
Environment=LINKME_SUPERVISED=1
WorkingDirectory=$INSTALL_DIR
ExecStart="$INSTALL_DIR/linkme-server" -config "$CONFIG"
Restart=always
RestartSec=3
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
$_rw

[Install]
WantedBy=multi-user.target
EOF
	chmod 644 /etc/systemd/system/$SERVICE_NAME.service
	systemctl daemon-reload
	systemctl enable "$SERVICE_NAME.service" >/dev/null 2>&1
}

install_launchd_plist() {
	mkdir -p "$(dirname "$PLIST")" "$INSTALL_DIR/logs"
	_bin=$(xml_escape "$INSTALL_DIR/linkme-server")
	_cfg=$(xml_escape "$CONFIG")
	_wd=$(xml_escape "$INSTALL_DIR")
	_log=$(xml_escape "$INSTALL_DIR/logs/linkme.log")
	cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LAUNCHD_LABEL</string>
<key>ProgramArguments</key><array>
<string>$_bin</string><string>-config</string><string>$_cfg</string>
</array>
<key>EnvironmentVariables</key><dict><key>LINKME_SUPERVISED</key><string>1</string></dict>
<key>WorkingDirectory</key><string>$_wd</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key><string>$_log</string>
<key>StandardErrorPath</key><string>$_log</string>
</dict></plist>
EOF
	if [ "$IS_ROOT" = 1 ]; then chmod 644 "$PLIST"; else chmod 600 "$PLIST"; fi
}

ensure_service_user() {
	[ -n "$SVC_USER" ] || return 0
	id "$SVC_USER" >/dev/null 2>&1 && return 0
	_nologin=/usr/sbin/nologin
	[ -x "$_nologin" ] || _nologin=/sbin/nologin
	[ -x "$_nologin" ] || _nologin=/bin/false
	if have useradd; then
		useradd --system --user-group --no-create-home --home-dir "$INSTALL_DIR" --shell "$_nologin" "$SVC_USER"
	elif have adduser; then
		adduser -S -D -H -h "$INSTALL_DIR" -s "$_nologin" "$SVC_USER" 2>/dev/null || adduser --system --group --no-create-home --home "$INSTALL_DIR" "$SVC_USER"
	else
		die "无法创建服务用户 $SVC_USER（缺少 useradd/adduser）"
	fi
	info "已创建服务用户 $SVC_USER"
}

# run_as_service_user 命令...：Linux 上以服务用户运行
run_as_service_user() {
	if [ -n "$SVC_USER" ] && [ "$IS_ROOT" = 1 ]; then
		if have runuser; then
			runuser -u "$SVC_USER" -- "$@"
		elif have setpriv; then
			setpriv --reuid="$SVC_USER" --regid="$SVC_USER" --init-groups "$@"
		elif have sudo; then
			sudo -u "$SVC_USER" "$@"
		else
			"$@"
		fi
	else
		"$@"
	fi
}

run_command_hint() {
	if [ -n "$SVC_USER" ] && [ "$IS_ROOT" = 1 ]; then
		printf 'runuser -u %s -- env LINKME_SUPERVISED=0 "%s" -config "%s"' "$SVC_USER" "$INSTALL_DIR/linkme-server" "$CONFIG"
	else
		printf 'LINKME_SUPERVISED=0 "%s" -config "%s"' "$INSTALL_DIR/linkme-server" "$CONFIG"
	fi
}

logs_hint() {
	case $SERVICE_KIND in
	systemd) printf 'journalctl -u %s -f' "$SERVICE_NAME" ;;
	launchd) printf 'tail -f "%s"' "$INSTALL_DIR/logs/linkme.log" ;;
	*) printf '（前台运行时直接输出到终端）' ;;
	esac
}

# ---------------------------------------------------------------- 防火墙
FIREWALL=''
detect_firewall() {
	FIREWALL=''
	[ "$OS" = linux ] || return 0
	if have ufw && ufw status 2>/dev/null | grep -q 'Status: active'; then
		FIREWALL=ufw
	elif have firewall-cmd && [ "$(firewall-cmd --state 2>/dev/null)" = running ]; then
		FIREWALL=firewalld
	fi
}

firewall_rules() { # 输出 端口/协议 列表
	printf '%s/tcp\n%s/tcp\n%s/tcp\n' "$API_PORT" "$DOWNLOAD_PORT" "$CONSOLE_PORT"
	if [ "$MEDIA_ENABLED" = 1 ]; then
		printf '%s/tcp\n%s/udp\n%s-%s/udp\n' "$TURN_PORT" "$TURN_PORT" "$RELAY_MIN" "$RELAY_MAX"
	fi
}

open_firewall() {
	case $FIREWALL in
	ufw)
		for _r in $(firewall_rules); do
			ufw allow "$(printf '%s' "$_r" | tr '-' ':')" comment LinkMe >/dev/null
		done
		info "已在 ufw 中放行：$(firewall_rules | tr '\n' ' ')"
		;;
	firewalld)
		for _r in $(firewall_rules); do
			firewall-cmd --permanent --add-port="$_r" >/dev/null
		done
		firewall-cmd --reload >/dev/null
		info "已在 firewalld 中放行：$(firewall_rules | tr '\n' ' ')"
		;;
	esac
}

# ---------------------------------------------------------------- 卸载
do_uninstall() {
	load_state || die "未找到由本安装程序创建的 LinkMe 安装（$STATE_FILE）。"
	say "将卸载 LinkMe 服务与程序：$INSTALL_DIR/linkme-server"
	say "配置（$CONFIG）、数据（$DATA_ROOT）与备份会保留。"
	ask_yn _ok '确认卸载？' y
	[ "$_ok" = 1 ] || die "已取消"
	case $SERVICE_KIND in
	systemd)
		systemctl disable --now "$SERVICE_NAME.service" >/dev/null 2>&1 || true
		rm -f /etc/systemd/system/$SERVICE_NAME.service
		systemctl daemon-reload 2>/dev/null || true
		;;
	launchd)
		launchctl bootout "$LAUNCHD_DOMAIN/$LAUNCHD_LABEL" >/dev/null 2>&1 || true
		rm -f "$PLIST"
		;;
	esac
	rm -f "$INSTALL_DIR/linkme-server" "$INSTALL_DIR/linkme-server.new"
	rm -f "$STATE_FILE"
	say ''
	say 'LinkMe 已卸载。以下内容已保留，如不再需要请手工删除：'
	say "  配置：      $CONFIG"
	say "  配置目录：  $CONFIG_DIR（含 private/ 密钥与 config-backups/）"
	say "  数据目录：  $DATA_ROOT"
	say "  备份：      $INSTALL_DIR/backups"
	say "防火墙规则未删除（如曾放行，请按需在 ufw/firewalld 中移除）。"
	say "重新运行安装程序并使用相同的配置目录（--config-dir），可继续使用原有配置与数据。"
}

# ---------------------------------------------------------------- 升级
do_upgrade() {
	_data_dir=$(config_string "$CONFIG" data_dir)
	[ -n "$_data_dir" ] || _data_dir=$DATA_ROOT/data
	_listen=$(config_string "$CONFIG" listen)
	[ -n "$_listen" ] && API_PORT=$(listen_port "$_listen")
	_old_version=$("$INSTALL_DIR/linkme-server" -version 2>/dev/null | head -n 1 || true)
	say ''
	say "检测到已安装的 LinkMe（$INSTALL_DIR，版本 ${_old_version:-未知}）。"
	say "将升级到 $NEW_VERSION。配置与数据不会被修改。"
	ask_yn _ok '开始升级？' y
	[ "$_ok" = 1 ] || die "已取消"
	if [ "$SERVICE_KIND" = none ] && wait_health "$API_PORT" 1; then
		die "LinkMe 正在运行（端口 $API_PORT），请先停止前台进程再升级。"
	fi

	cp "$NEW_BIN" "$INSTALL_DIR/linkme-server.new"
	chmod 755 "$INSTALL_DIR/linkme-server.new"
	info "用新程序检查现有配置"
	if ! _out=$(run_as_service_user "$INSTALL_DIR/linkme-server.new" -config "$CONFIG" -check-config 2>&1); then
		rm -f "$INSTALL_DIR/linkme-server.new"
		say "$_out" >&2
		die "新版本不接受当前配置，未做任何修改。"
	fi

	if [ "$SERVICE_KIND" != none ]; then
		info "停止服务"
		service_stop
		sleep 1
	fi

	_ts=$(date +%Y%m%d-%H%M%S)
	BACKUP_DIR=$INSTALL_DIR/backups/$_ts
	mkdir -p "$BACKUP_DIR/db"
	chmod 700 "$INSTALL_DIR/backups" "$BACKUP_DIR"
	cp -p "$INSTALL_DIR/linkme-server" "$BACKUP_DIR/linkme-server"
	_dbs=0
	for _f in "$_data_dir"/*.db "$_data_dir"/*.db-wal "$_data_dir"/*.db-shm; do
		[ -f "$_f" ] || continue
		cp -p "$_f" "$BACKUP_DIR/db/"
		_dbs=$((_dbs + 1))
	done
	info "已备份程序与 $_dbs 个数据库文件到 $BACKUP_DIR"

	mv -f "$INSTALL_DIR/linkme-server.new" "$INSTALL_DIR/linkme-server"
	VERSION=$NEW_VERSION
	INSTALLED_AT=$(date '+%Y-%m-%d %H:%M:%S')

	if [ "$SERVICE_KIND" = none ]; then
		write_state
		say ''
		say "升级完成（--no-service：未启动）。启动命令："
		say "  $(run_command_hint)"
		say "备份：$BACKUP_DIR"
		return 0
	fi

	info "启动服务并等待健康检查"
	service_start || true
	if wait_health "$API_PORT" 60; then
		write_state
		say ''
		say "升级成功：$(printf '%s' "$HEALTH_BODY" | tr -d '\n')"
		say "备份：$BACKUP_DIR"
		say "日志：$(logs_hint)"
		return 0
	fi

	warn "新版本健康检查失败，正在回滚到 ${_old_version:-旧版本}"
	service_stop
	sleep 1
	cp -p "$BACKUP_DIR/linkme-server" "$INSTALL_DIR/linkme-server"
	rm -f "$_data_dir"/*.db-wal "$_data_dir"/*.db-shm
	for _f in "$BACKUP_DIR"/db/*; do
		[ -f "$_f" ] || continue
		cp -p "$_f" "$_data_dir/"
	done
	service_start || true
	if wait_health "$API_PORT" 60; then
		die "升级失败，已回滚到原版本并恢复数据库（备份保留在 $BACKUP_DIR）。查看日志：$(logs_hint)"
	fi
	die "升级失败，回滚后服务仍未通过健康检查。备份在 $BACKUP_DIR，查看日志：$(logs_hint)"
}

# ---------------------------------------------------------------- 全新安装
ask_console_admin() {
	CONSOLE_USER=''
	while :; do
		ask CONSOLE_USER '控制台管理员用户名' admin
		case $CONSOLE_USER in
		'' | *[!A-Za-z0-9._@-]*)
			say '用户名只能包含字母、数字以及 . _ @ -'
			[ "$ASSUME_YES" != 1 ] || die "无效用户名"
			;;
		*) break ;;
		esac
	done
	CONSOLE_PASSWORD=''
	PASSWORD_GENERATED=0
	if [ "$ASSUME_YES" != 1 ] && [ "$HAVE_INPUT" = 1 ]; then
		while :; do
			ask_secret CONSOLE_PASSWORD '控制台管理员密码（至少 10 位，直接回车自动生成）'
			[ -n "$CONSOLE_PASSWORD" ] || break
			if [ "${#CONSOLE_PASSWORD}" -lt 10 ]; then
				say '密码至少 10 位。'
				continue
			fi
			ask_secret _pw2 '再次输入密码'
			[ "$_pw2" != "$CONSOLE_PASSWORD" ] || break
			say '两次输入不一致，请重新输入。'
		done
	fi
	if [ -z "$CONSOLE_PASSWORD" ]; then
		CONSOLE_PASSWORD=$(random_alnum 20)
		PASSWORD_GENERATED=1
	fi
}

do_install() {
	say ''
	say "LinkMe 服务器安装程序（$OS-$ARCH，程序版本 $NEW_VERSION）"
	say '直接回车表示使用方括号中的默认值。'
	say ''

	# 安装目录
	if [ -n "$OPT_INSTALL_DIR" ]; then
		INSTALL_DIR=$OPT_INSTALL_DIR
	else
		ask INSTALL_DIR '安装目录' "$DEFAULT_INSTALL_DIR"
	fi
	INSTALL_DIR=$(printf '%s' "$INSTALL_DIR" | sed 's:/*$::')
	valid_path "$INSTALL_DIR" || die "安装目录必须是绝对路径，且不能包含引号、反斜杠或换行：$INSTALL_DIR"
	if [ -n "$OPT_CONFIG_DIR" ]; then
		CONFIG_DIR=$OPT_CONFIG_DIR
	elif [ -n "$DEFAULT_CONFIG_DIR" ]; then
		CONFIG_DIR=$DEFAULT_CONFIG_DIR
	else
		CONFIG_DIR=$INSTALL_DIR/config
	fi
	CONFIG_DIR=$(printf '%s' "$CONFIG_DIR" | sed 's:/*$::')
	valid_path "$CONFIG_DIR" || die "配置目录必须是绝对路径：$CONFIG_DIR"
	[ "$CONFIG_DIR" != "$INSTALL_DIR" ] || die "配置目录不能与安装目录相同（程序目录属 root，配置目录属服务用户）"
	case $CONFIG_DIR in
	/ | /bin | /boot | /dev | /etc | /home | /lib | /opt | /proc | /root | /run | /sbin | /srv | /sys | /tmp | /usr | /usr/local | /var | /Users | /Library | /Applications | "$HOME")
		die "不能直接使用系统目录作为配置目录：$CONFIG_DIR（请使用其下的子目录，例如 /etc/linkme）" ;;
	esac
	CONFIG=$CONFIG_DIR/config.json
	SECRET_FILE=$CONFIG_DIR/private/media-secret

	REUSE_CONFIG=0
	if [ -f "$CONFIG" ]; then
		say "发现已有配置文件：$CONFIG"
		ask_yn REUSE_CONFIG '沿用该配置（不会覆盖，也不会重新选择数据盘）？' y
		[ "$REUSE_CONFIG" = 1 ] || die "为避免覆盖，请手工移走 $CONFIG 后重试，或用 --config-dir 指定其他配置目录。"
	fi

	if [ "$REUSE_CONFIG" = 1 ]; then
		_data_dir=$(config_string "$CONFIG" data_dir)
		DATA_ROOT=${_data_dir%/data}
		API_PORT=$(listen_port "$(config_string "$CONFIG" listen)")
		DOWNLOAD_PORT=$(listen_port "$(config_string "$CONFIG" download_listen)")
		PUBLIC_URL=$(config_string "$CONFIG" public_url)
		PUBLIC_HOST=$(printf '%s' "$PUBLIC_URL" | sed 's#^[a-z]*://##; s#:[0-9]*$##')
		CONSOLE_PORT=8253
		_cl=$(sed -n '/"console"/,/}/p' "$CONFIG" | config_string /dev/stdin listen)
		[ -n "$_cl" ] && CONSOLE_PORT=$(listen_port "$_cl")
		MEDIA_ENABLED=0
		grep -q 'turn:' "$CONFIG" && sed -n '/"media"/,/}/p' "$CONFIG" | grep -q '"enabled"[[:space:]]*:[[:space:]]*true' && MEDIA_ENABLED=1
		TURN_PORT=8252
		[ -n "$API_PORT" ] || API_PORT=8250
		URL_HOST=$PUBLIC_HOST
		CONSOLE_USER=''
		CONSOLE_PASSWORD=''
		PASSWORD_GENERATED=0
		ask_yn _reset '是否设置/重置控制台管理员密码？' n
		[ "$_reset" = 1 ] && ask_console_admin
	else
		# 数据盘（必须由人选择）
		choose_data_dir
		check_data_root

		# 公网地址
		_ip=$(detect_ip)
		if [ -n "$OPT_HOST" ]; then
			PUBLIC_HOST=$OPT_HOST
		else
			[ -n "$_ip" ] && say "检测到本机 IP：$_ip（若服务器在 NAT 之后，请输入公网 IP 或域名）"
			if [ "$ASSUME_YES" = 1 ] || [ "$HAVE_INPUT" != 1 ]; then
				[ -n "$_ip" ] || die "无法检测本机 IP，请用 --host 指定公网地址。"
				PUBLIC_HOST=$_ip
			else
				PUBLIC_HOST=''
				while [ -z "$PUBLIC_HOST" ]; do
					ask PUBLIC_HOST '公网地址（客户端用来连接的 IP 或域名）' "$_ip"
				done
			fi
		fi
		PUBLIC_HOST=$(printf '%s' "$PUBLIC_HOST" | sed 's#^[a-zA-Z]*://##; s#/.*$##')
		BARE_HOST=$(printf '%s' "$PUBLIC_HOST" | tr -d '[]')
		case $BARE_HOST in
		'' | *[!A-Za-z0-9.:-]*) die "公网地址只能包含字母、数字、点、短横线（IPv6 可用方括号）：$PUBLIC_HOST" ;;
		esac
		case $BARE_HOST in
		*:*) URL_HOST="[$BARE_HOST]" ;;
		*) URL_HOST=$BARE_HOST ;;
		esac
		PUBLIC_HOST=$BARE_HOST

		# 端口
		API_PORT=8250 DOWNLOAD_PORT=8251 TURN_PORT=8252 CONSOLE_PORT=8253
		ask_yn _defports "使用默认端口（API 8250、下载页 8251、媒体中继 8252、控制台 8253）？" y
		if [ "$_defports" = 0 ]; then
			for _p in API_PORT:API DOWNLOAD_PORT:下载页 TURN_PORT:媒体中继TURN CONSOLE_PORT:控制台; do
				_var=${_p%%:*}
				eval "_cur=\$$_var"
				while :; do
					ask "$_var" "${_p#*:} 端口" "$_cur"
					eval "_val=\$$_var"
					valid_port "$_val" && break
					say "端口必须是 1-65535 的数字。"
				done
			done
		fi

		# 媒体中继
		ask_yn MEDIA_ENABLED '启用媒体中继（TURN，用于跨网络音视频通话和远程协助）？' y

		for _p in "$API_PORT" "$DOWNLOAD_PORT" "$CONSOLE_PORT"; do
			valid_port "$_p" || die "无效端口：$_p"
		done
		_all="$API_PORT $DOWNLOAD_PORT $CONSOLE_PORT"
		[ "$MEDIA_ENABLED" = 1 ] && _all="$_all $TURN_PORT"
		# shellcheck disable=SC2086
		[ "$(printf '%s\n' $_all | sort -u | wc -l | tr -d ' ')" = "$(printf '%s\n' $_all | wc -l | tr -d ' ')" ] || die "端口不能重复：$_all"
		if [ "$MEDIA_ENABLED" = 1 ]; then
			for _p in $_all; do
				if [ "$_p" -ge "$RELAY_MIN" ] && [ "$_p" -le "$RELAY_MAX" ]; then
					die "端口 $_p 与媒体中继端口范围 $RELAY_MIN-$RELAY_MAX 冲突"
				fi
			done
		fi
		for _p in $_all; do
			if port_in_use "$_p"; then
				die "端口 $_p 已被其他程序占用，请更换端口或先停止占用它的程序。"
			fi
		done

		ask_console_admin
	fi

	# 防火墙
	detect_firewall
	OPEN_FW=0
	if [ -n "$FIREWALL" ]; then
		if [ "$NO_SERVICE" = 1 ]; then
			say "检测到 $FIREWALL 已启用；--no-service 模式不修改防火墙。"
		else
			ask_yn OPEN_FW "检测到 $FIREWALL 已启用，是否放行 LinkMe 端口？" y
		fi
	fi

	# 确认
	say ''
	say '即将安装：'
	say "  安装目录：  $INSTALL_DIR"
	say "  配置文件：  $CONFIG$([ "$REUSE_CONFIG" = 1 ] && printf '（沿用）')"
	say "  数据目录：  $DATA_ROOT"
	if [ "$REUSE_CONFIG" != 1 ]; then
		say "  公网地址：  $PUBLIC_HOST"
		say "  端口：      API $API_PORT，下载页 $DOWNLOAD_PORT，控制台 $CONSOLE_PORT$([ "$MEDIA_ENABLED" = 1 ] && printf '，TURN %s（TCP/UDP）+ UDP %s-%s' "$TURN_PORT" "$RELAY_MIN" "$RELAY_MAX")"
		say "  媒体中继：  $([ "$MEDIA_ENABLED" = 1 ] && printf '启用' || printf '不启用')"
		say "  控制台账号：$CONSOLE_USER"
	fi
	if [ "$NO_SERVICE" = 1 ]; then
		say "  系统服务：  不安装（--no-service）"
	elif [ "$OS" = linux ]; then
		say "  系统服务：  systemd $SERVICE_NAME.service（用户 $SVC_USER）"
	else
		say "  系统服务：  launchd $LAUNCHD_LABEL（$PLIST）"
	fi
	ask_yn _go '确认开始安装？' y
	[ "$_go" = 1 ] || die "已取消"
	say ''

	# 目录与程序
	mkdir -p "$INSTALL_DIR"
	chmod 755 "$INSTALL_DIR"
	ensure_service_user
	cp "$NEW_BIN" "$INSTALL_DIR/linkme-server.new"
	chmod 755 "$INSTALL_DIR/linkme-server.new"
	mv -f "$INSTALL_DIR/linkme-server.new" "$INSTALL_DIR/linkme-server"
	info "程序已安装到 $INSTALL_DIR/linkme-server"

	_created_root=0
	[ -d "$DATA_ROOT" ] || _created_root=1
	mkdir -p "$DATA_ROOT/data" "$DATA_ROOT/downloads" || die "无法创建数据目录：$DATA_ROOT"
	_probe=$DATA_ROOT/data/.linkme-write-test
	: >"$_probe" 2>/dev/null || die "数据目录不可写：$DATA_ROOT"
	rm -f "$_probe"
	chmod 750 "$DATA_ROOT/data"
	chmod 755 "$DATA_ROOT/downloads"
	[ "$_created_root" = 0 ] || chmod 755 "$DATA_ROOT"
	if [ -n "$SVC_USER" ]; then
		# 只改 LinkMe 自己的子目录；数据目录若是已有目录（如磁盘根）不改其属主
		[ "$_created_root" = 0 ] || chown "$SVC_USER:$SVC_USER" "$DATA_ROOT"
		chown -R "$SVC_USER:$SVC_USER" "$DATA_ROOT/data" "$DATA_ROOT/downloads"
	fi

	# 配置目录属服务用户（0700）：控制台以“临时文件 + 改名”保存 config.json，
	# 并在其中创建 private/（密钥文件）和 config-backups/
	mkdir -p "$CONFIG_DIR/private"
	chmod 700 "$CONFIG_DIR" "$CONFIG_DIR/private"
	if [ "$REUSE_CONFIG" != 1 ]; then
		if [ "$MEDIA_ENABLED" = 1 ] && [ ! -s "$SECRET_FILE" ]; then
			(umask 077 && random_hex 32 >"$SECRET_FILE")
			info "已生成媒体中继密钥 $SECRET_FILE"
		fi
		write_config
		info "已写入配置 $CONFIG"
	fi
	if [ -n "$SVC_USER" ]; then
		chown -R "$SVC_USER:$SVC_USER" "$CONFIG_DIR"
	fi

	info "检查配置"
	if ! _out=$(run_as_service_user "$INSTALL_DIR/linkme-server" -config "$CONFIG" -check-config 2>&1); then
		say "$_out" >&2
		die "配置检查未通过：$CONFIG"
	fi

	if [ -n "$CONSOLE_PASSWORD" ]; then
		info "创建控制台管理员 $CONSOLE_USER"
		PW_FILE=$INSTALL_DIR/.console-password.$$
		(umask 077 && printf '%s\n' "$CONSOLE_PASSWORD" >"$PW_FILE")
		if [ -n "$SVC_USER" ]; then chown "$SVC_USER:$SVC_USER" "$PW_FILE"; fi
		if ! _out=$(run_as_service_user "$INSTALL_DIR/linkme-server" -config "$CONFIG" -console-admin "$CONSOLE_USER" -console-password-file "$PW_FILE" 2>&1); then
			say "$_out" >&2
			die "创建控制台管理员失败"
		fi
		rm -f "$PW_FILE"
		PW_FILE=''
	fi

	VERSION=$NEW_VERSION
	INSTALLED_AT=$(date '+%Y-%m-%d %H:%M:%S')
	if [ "$NO_SERVICE" = 1 ]; then
		SERVICE_KIND=none
	elif [ "$OS" = linux ]; then
		SERVICE_KIND=systemd
	else
		SERVICE_KIND=launchd
	fi

	if [ "$OPEN_FW" = 1 ]; then
		open_firewall
	fi

	HEALTH_OK=0
	if [ "$SERVICE_KIND" != none ]; then
		info "安装并启动系统服务"
		if [ "$SERVICE_KIND" = systemd ]; then
			install_systemd_unit
		else
			install_launchd_plist
		fi
		write_state
		service_stop
		service_start || die "服务启动失败，查看日志：$(logs_hint)"
		info "等待健康检查 http://127.0.0.1:$API_PORT/health"
		if wait_health "$API_PORT" 60; then
			HEALTH_OK=1
		else
			die "服务已安装，但 60 秒内未通过健康检查。查看日志：$(logs_hint)"
		fi
	else
		write_state
	fi

	print_summary
}

write_config() {
	_e() { json_escape "$1"; }
	if [ "$MEDIA_ENABLED" = 1 ]; then
		_media=true
		_stun="\"stun:$(_e "$URL_HOST"):$TURN_PORT\""
	else
		_media=false
		_stun=''
	fi
	(
		umask 077
		cat >"$CONFIG" <<EOF
{
  "listen": ":$API_PORT",
  "download_listen": ":$DOWNLOAD_PORT",
  "data_dir": "$(_e "$DATA_ROOT/data")",
  "downloads_dir": "$(_e "$DATA_ROOT/downloads")",
  "public_url": "http://$(_e "$URL_HOST"):$API_PORT",
  "download_url": "http://$(_e "$URL_HOST"):$DOWNLOAD_PORT",
  "storage": {
    "primary_enabled": true,
    "root": "",
    "require_marker": false,
    "reserve_bytes": 268435456,
    "concurrent_uploads": 4,
    "volumes": []
  },
  "chat": {
    "max_attachment_bytes": 0,
    "persist_attachment_bytes": 52428800,
    "offline_queue_bytes": 262144000,
    "offline_queue_messages": 100,
    "uploads_per_hour": 0,
    "received_cache_messages": 5000,
    "received_cache_bytes": 20971520,
    "received_cache_days": 30,
    "received_cache_conversations": 100
  },
  "drive": {
    "quota_gb": 5,
    "max_files": 10000,
    "max_folders": 2000,
    "max_folder_depth": 32
  },
  "spaces": {
    "max_document_bytes": 2097152,
    "max_documents": 10000
  },
  "directory": {
    "all_users": true
  },
  "admin": {
    "users": []
  },
  "registration": {
    "enabled": false
  },
  "console": {
    "enabled": true,
    "listen": ":$CONSOLE_PORT"
  },
  "email_auth": {
    "enabled": false,
    "credentials_file": ""
  },
  "ai": {
    "enabled": false,
    "credentials_file": "",
    "model": "gpt-6-luna",
    "reasoning_effort": "xhigh",
    "context_messages": 80,
    "context_characters": 60000,
    "concurrent_requests": 4
  },
  "media": {
    "enabled": $_media,
    "listen": ":$TURN_PORT",
    "public_address": "$(_e "$BARE_HOST")",
    "urls": [
      "turn:$(_e "$URL_HOST"):$TURN_PORT?transport=udp",
      "turn:$(_e "$URL_HOST"):$TURN_PORT?transport=tcp"
    ],
    "secret_file": "$(_e "$SECRET_FILE")",
    "realm": "linkme",
    "credential_seconds": 21600,
    "direct_timeout_ms": 15000,
    "relay_min_port": $RELAY_MIN,
    "relay_max_port": $RELAY_MAX,
    "max_allocations_per_user": 32,
    "bytes_per_second": 4194304,
    "allowed_peer_cidrs": []
  },
  "meetings": {
    "max_participants": 8,
    "duration_minutes": 120,
    "stun_urls": [$_stun]
  }
}
EOF
	)
	chmod 600 "$CONFIG"
}

print_summary() {
	_h=${URL_HOST:-$PUBLIC_HOST}
	say ''
	say '================================================================'
	if [ "$HEALTH_OK" = 1 ]; then
		say " LinkMe 服务器安装完成，运行正常（版本 $NEW_VERSION）"
	else
		say " LinkMe 已安装（--no-service：服务未安装、未启动）"
	fi
	say '================================================================'
	say "  API 地址：      http://$_h:$API_PORT"
	say "  下载页：        http://$_h:$DOWNLOAD_PORT"
	say "  管理后台：      http://$_h:$DOWNLOAD_PORT/admin/   （下载页右上角“管理后台登录”）"
	say "  后台独立端口：  http://$_h:$CONSOLE_PORT/"
	if [ -n "$CONSOLE_PASSWORD" ]; then
		say "  控制台用户名：  $CONSOLE_USER"
		say "  控制台密码：    $CONSOLE_PASSWORD"
		if [ "$PASSWORD_GENERATED" = 1 ]; then
			say '                  （自动生成，只显示这一次，请立即妥善保存）'
		else
			say '                  （只显示这一次）'
		fi
	else
		say '  控制台账号：    沿用原有账号（未修改）'
	fi
	say "  数据目录：      $DATA_ROOT"
	say "  配置文件：      $CONFIG"
	say "  密钥目录：      $CONFIG_DIR/private（控制台修改配置时的备份在 $CONFIG_DIR/config-backups）"
	say "  安装目录：      $INSTALL_DIR"
	if [ "$SERVICE_KIND" = none ]; then
		say '  启动命令：'
		say "    $(run_command_hint)"
		say "  健康检查：      curl http://127.0.0.1:$API_PORT/health"
	else
		say "  查看日志：      $(logs_hint)"
		if [ "$SERVICE_KIND" = systemd ]; then
			say "  服务管理：      systemctl status|restart|stop $SERVICE_NAME"
		elif [ "$LAUNCHD_DOMAIN" != system ]; then
			say "  服务管理：      launchctl kickstart -k $LAUNCHD_DOMAIN/$LAUNCHD_LABEL"
			say '  注意：当前为用户级 LaunchAgent，仅在该用户登录后运行；需开机即启动请用 sudo 安装。'
		else
			say "  服务管理：      sudo launchctl kickstart -k system/$LAUNCHD_LABEL"
		fi
	fi
	say "  升级：再次运行本安装程序；卸载：加 --uninstall（保留配置和数据）"
	if [ "$FIREWALL" = '' ] && [ "$SERVICE_KIND" != none ]; then
		say "  防火墙/安全组：请确保放行 TCP $API_PORT,$DOWNLOAD_PORT,$CONSOLE_PORT$([ "${MEDIA_ENABLED:-0}" = 1 ] && printf '，TCP/UDP %s，UDP %s-%s' "$TURN_PORT" "$RELAY_MIN" "$RELAY_MAX")"
	fi
	say '================================================================'
}

# ---------------------------------------------------------------- 主流程
if [ "$DO_UNINSTALL" = 1 ]; then
	do_uninstall
	exit 0
fi

fetch_binary
check_binary "$NEW_BIN"

if load_state; then
	[ -n "${SERVICE_KIND:-}" ] || SERVICE_KIND=none
	if [ "$NO_SERVICE" = 1 ] && [ "$SERVICE_KIND" != none ]; then
		warn "已有安装使用系统服务（$SERVICE_KIND），升级将按系统服务方式进行。"
	fi
	if [ "$NO_SERVICE" != 1 ] && [ "$SERVICE_KIND" = none ]; then
		warn "已有安装为 --no-service 方式，本次升级不会安装系统服务。"
	fi
	do_upgrade
else
	SERVICE_KIND=none
	do_install
fi
