# LinkMe 服务器镜像。使用预先编译好的静态程序（node scripts/build-server.mjs），
# 构建上下文为仓库根目录：
#   docker build -f deploy/docker/Dockerfile -t linkme-server:local .
FROM alpine:3.24

ARG TARGETARCH=amd64
# 从仓库构建时使用默认路径；从 linkme-server-docker.tar.gz 安装包构建时，
# install-docker.sh 会改为 bin 与 entrypoint.sh（见 compose.yaml 的 build.args）。
ARG BIN_DIR=dist/server/bin
ARG ENTRYPOINT_SRC=deploy/docker/entrypoint.sh

RUN apk add --no-cache ca-certificates tzdata su-exec \
	&& addgroup -S -g 10001 linkme \
	&& adduser -S -D -H -u 10001 -G linkme -h /data -s /sbin/nologin linkme \
	&& mkdir -p /config /data \
	&& chown linkme:linkme /config /data

COPY --chmod=0755 ${BIN_DIR}/linux-${TARGETARCH}/linkme-server /usr/local/bin/linkme-server
COPY --chmod=0755 ${ENTRYPOINT_SRC} /usr/local/bin/linkme-entrypoint

# 由容器的 restart 策略负责重启：控制台“重启”按钮以非零代码退出
ENV LINKME_SUPERVISED=1 \
	LINKME_API_PORT=8250 \
	LINKME_DOWNLOAD_PORT=8251 \
	LINKME_TURN_PORT=8252 \
	LINKME_CONSOLE_PORT=8253 \
	LINKME_MEDIA_ENABLED=1 \
	LINKME_CONSOLE_USER=admin \
	TZ=Asia/Shanghai

VOLUME ["/config", "/data"]
EXPOSE 8250/tcp 8251/tcp 8252/tcp 8252/udp 8253/tcp 20000-20127/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD wget -q -T 4 -O - "http://127.0.0.1:${LINKME_API_PORT}/health" | grep -q '"ok":true' || exit 1

# 入口脚本以 root 启动，只用于修正挂载目录的属主和首次初始化，
# 随后通过 su-exec 以非 root 用户 linkme（uid 10001）运行服务器。
ENTRYPOINT ["/usr/local/bin/linkme-entrypoint"]
