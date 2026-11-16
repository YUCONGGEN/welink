#!/bin/sh
# LinkMe 容器入口：首次启动时根据环境变量生成 /config/config.json，
# 创建控制台管理员，然后以非 root 用户 linkme 运行服务器。
#
# 环境变量：
#   LINKME_PUBLIC_HOST       必填：客户端访问的公网 IP 或域名
#   LINKME_API_PORT          默认 8250
#   LINKME_DOWNLOAD_PORT     默认 8251
#   LINKME_TURN_PORT         默认 8252
#   LINKME_CONSOLE_PORT      默认 8253
#   LINKME_MEDIA_ENABLED     默认 1（启用媒体中继，需要发布 UDP 20000-20127）
#   LINKME_CONSOLE_USER      默认 admin
#   LINKME_CONSOLE_PASSWORD  可选；不填则自动生成并写入 /data/console-admin.txt
#   LINKME_CONSOLE_RESET     设为 1 时，在本次启动重新设置管理员密码
# sh -c '...' 中的 $1 等由子 shell 展开，属预期写法：
# shellcheck disable=SC2016
set -eu

CONFIG=/config/config.json
# 与安装程序相同的布局：/config 属 linkme（0700），密钥放 private/，控制台备份放 config-backups/
SECRET=/config/private/media-secret
ADMIN_MARK=/data/.console-admin-initialized
ADMIN_FILE=/data/console-admin.txt
BIN=/usr/local/bin/linkme-server
RUN_USER=linkme

log() { printf '[linkme-entrypoint] %s\n' "$*" >&2; }
die() { log "错误：$*"; exit 1; }

API_PORT=${LINKME_API_PORT:-8250}
DOWNLOAD_PORT=${LINKME_DOWNLOAD_PORT:-8251}
TURN_PORT=${LINKME_TURN_PORT:-8252}
CONSOLE_PORT=${LINKME_CONSOLE_PORT:-8253}
MEDIA_ENABLED=${LINKME_MEDIA_ENABLED:-1}
CONSOLE_USER=${LINKME_CONSOLE_USER:-admin}

as_user() {
	if [ "$(id -u)" = 0 ]; then
		su-exec "$RUN_USER" "$@"
	else
		"$@"
	fi
}

if [ "$(id -u)" = 0 ]; then
	mkdir -p /config /data
	# 宿主机绑定目录通常属于 root；只在属主不对时递归修正
	for d in /config /data; do
		if [ "$(stat -c %u "$d")" != 10001 ]; then
			chown -R "$RUN_USER:$RUN_USER" "$d"
		fi
	done
	chmod 700 /config
fi
as_user mkdir -p /config/private
as_user chmod 700 /config/private

if [ ! -f "$CONFIG" ]; then
	HOST=${LINKME_PUBLIC_HOST:-}
	[ -n "$HOST" ] || die "首次启动必须设置 LINKME_PUBLIC_HOST（客户端访问的公网 IP 或域名）"
	case $HOST in
	*[!A-Za-z0-9.-]*) die "LINKME_PUBLIC_HOST 只能包含字母、数字、点和短横线：$HOST" ;;
	esac
	for p in "$API_PORT" "$DOWNLOAD_PORT" "$TURN_PORT" "$CONSOLE_PORT"; do
		case $p in '' | *[!0-9]*) die "端口必须是数字：$p" ;; esac
	done
	case $MEDIA_ENABLED in
	1 | true | yes) MEDIA=true ;;
	*) MEDIA=false ;;
	esac
	if [ "$MEDIA" = true ]; then
		STUN="\"stun:$HOST:$TURN_PORT\""
		if [ ! -s "$SECRET" ]; then
			as_user sh -c 'umask 077; od -An -tx1 -N32 /dev/urandom | tr -d " \n" > "$1"' _ "$SECRET"
		fi
	else
		STUN=''
	fi
	as_user sh -c 'umask 077; cat > "$1"' _ "$CONFIG" <<EOF
{
  "listen": ":$API_PORT",
  "download_listen": ":$DOWNLOAD_PORT",
  "data_dir": "/data/data",
  "downloads_dir": "/data/downloads",
  "public_url": "http://$HOST:$API_PORT",
  "download_url": "http://$HOST:$DOWNLOAD_PORT",
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
    "enabled": $MEDIA,
    "listen": ":$TURN_PORT",
    "public_address": "$HOST",
    "urls": [
      "turn:$HOST:$TURN_PORT?transport=udp",
      "turn:$HOST:$TURN_PORT?transport=tcp"
    ],
    "secret_file": "$SECRET",
    "realm": "linkme",
    "credential_seconds": 21600,
    "direct_timeout_ms": 15000,
    "relay_min_port": 20000,
    "relay_max_port": 20127,
    "max_allocations_per_user": 32,
    "bytes_per_second": 4194304,
    "allowed_peer_cidrs": []
  },
  "meetings": {
    "max_participants": 8,
    "duration_minutes": 120,
    "stun_urls": [$STUN]
  }
}
EOF
	log "已根据环境变量生成 $CONFIG（公网地址 $HOST）"
fi

as_user mkdir -p /data/data /data/downloads
as_user "$BIN" -config "$CONFIG" -check-config >/dev/null || die "配置检查未通过：$CONFIG"

if [ ! -f "$ADMIN_MARK" ] || [ "${LINKME_CONSOLE_RESET:-0}" = 1 ]; then
	PASSWORD=${LINKME_CONSOLE_PASSWORD:-}
	GENERATED=0
	if [ -z "$PASSWORD" ]; then
		PASSWORD=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)
		GENERATED=1
	fi
	[ "${#PASSWORD}" -ge 10 ] || die "LINKME_CONSOLE_PASSWORD 至少 10 位"
	PW_FILE=/config/.console-password.$$
	as_user sh -c 'umask 077; printf "%s\n" "$2" > "$1"' _ "$PW_FILE" "$PASSWORD"
	if ! as_user "$BIN" -config "$CONFIG" -console-admin "$CONSOLE_USER" -console-password-file "$PW_FILE" >&2; then
		rm -f "$PW_FILE"
		die "创建控制台管理员失败"
	fi
	rm -f "$PW_FILE"
	if [ "$GENERATED" = 1 ]; then
		as_user sh -c 'umask 077; printf "控制台地址：http://%s:%s/\n用户名：%s\n密码：%s\n" "$2" "$3" "$4" "$5" > "$1"' _ "$ADMIN_FILE" "${LINKME_PUBLIC_HOST:-HOST}" "$CONSOLE_PORT" "$CONSOLE_USER" "$PASSWORD"
		chmod 600 "$ADMIN_FILE" 2>/dev/null || true
		if [ -n "${LINKME_HOST_DATA_DIR:-}" ]; then
			_where="$ADMIN_FILE（宿主机：$LINKME_HOST_DATA_DIR/data/console-admin.txt）"
		else
			_where=$ADMIN_FILE
		fi
		log "控制台管理员 $CONSOLE_USER 已创建，自动生成的密码已写入 $_where，权限 600。"
		log "查看：docker compose exec linkme cat $ADMIN_FILE"
	else
		log "控制台管理员 $CONSOLE_USER 已设置（密码来自 LINKME_CONSOLE_PASSWORD）"
	fi
	as_user touch "$ADMIN_MARK"
fi

log "启动 LinkMe 服务器（API :$API_PORT，下载页 :$DOWNLOAD_PORT，控制台 :$CONSOLE_PORT）"
if [ "$(id -u)" = 0 ]; then
	exec su-exec "$RUN_USER" "$BIN" -config "$CONFIG" "$@"
fi
exec "$BIN" -config "$CONFIG" "$@"
