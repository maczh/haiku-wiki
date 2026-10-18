# syntax=docker/dockerfile:1
# ===== 寄海文库（haiku-wiki）多阶段构建 =====
#
# 可选换源（默认空 = 用官方源；国内网络建议构建时显式传）：
#   --build-arg APK_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/alpine
#   --build-arg NPM_MIRROR=https://registry.npmmirror.com
#
# ⚠️ 常见构建失败：`failed to resolve source metadata for docker.io/docker/dockerfile:1`
#    这是上面 syntax 行指定的「BuildKit Dockerfile 前端镜像」拉不下来（国内直连 Docker Hub
#    超时），**不是**本项目代码或 Dockerfile 语法的问题。解决方式见
#    README「1.3.1 国内网络 / 代理环境构建」——给 `~/.docker/config.json` 写 proxies，
#    或 `DOCKER_BUILDKIT=0` 退回 classic builder 绕开前端拉取。
#    仓库里的 `./docker-build-cn.sh` 已把这些开关封装好。

# 全局构建参数（第一个 FROM 之前声明，各阶段需重新 ARG 才能用）
ARG APK_MIRROR=""
ARG NPM_MIRROR=""

# 阶段 1：构建前端（Vite 产物）
FROM node:22-alpine AS web-builder
ARG NPM_MIRROR=""
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
ENV NODE_OPTIONS="--max-old-space-size=4096"
# NPM_MIRROR 非空时才指定 registry（例如 https://registry.npmmirror.com），留空走官方源
RUN if [ -n "${NPM_MIRROR}" ]; then \
      npm install --no-audit --no-fund --registry "${NPM_MIRROR}"; \
    else \
      npm install --no-audit --no-fund; \
    fi
COPY web/ ./
# prebuild 会同步 Vditor 与 draw.io 两套自托管静态资源：
#   web/vendor/drawio 已随构建上下文带入时直接复用；缺失时自动联网拉取，
#   拉取失败只告警不中断（绘图文档类型会提示"绘图组件未部署"）。
RUN npm run build

# 阶段 2：构建后端（纯 Go，免 CGO，嵌入前端产物）
FROM golang:1.25-alpine AS server-builder
WORKDIR /app/server
COPY server/go.mod server/go.sum* ./
RUN GOPROXY=https://goproxy.cn go mod download
COPY server/ ./
# 用真实的前端产物覆盖占位目录（embed 进二进制）
COPY --from=web-builder /app/web/dist ./internal/static/dist
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-s -w" -o /bin/haiku-wiki ./cmd/server

# 阶段 3：运行时（单容器：二进制 + 数据卷）
# 中文字体：PDF / PNG 导出需要真实 CJK 字体（缺字体时中文会渲染为空白）
# EXPORT_FONT_PATH 必须指向 font-wqy-zenhei 实际安装的位置
# （apk 包把 wqy-zenhei.ttc 放在 /usr/share/fonts/wqy-zenhei/）。
#
# 字体选型说明（避免后人改错；实测矩阵见 internal/service/exportx/font.go 头部注释）：
#   · font-wqy-zenhei 位于 Alpine **community** 仓库（main 仓没有，Alpine 也只提供
#     这一个 wqy 包）。若基础镜像的 /etc/apk/repositories 未启用 community，
#     `apk add` 会失败并中断构建 —— 届时需显式 --repository 指定 community 源。
#   · 该 .ttc 已实测同时通过 hasCJK（freetype）与 gopdf 加载两道校验，可正常出 PDF/PNG。
#   · **不要**改投 font-noto-cjk：其 .ttc 内部为 CFF 轮廓（sfntVersion='OTTO'），
#     现有管线（freetype truetype + TTC 抽首字体）解析不了，换了反而彻底无字体可用。
#   · 即使 EXPORT_FONT_PATH 指向了渲染器不能用的字体，LoadFont 也会告警并回退自动探测，
#     不会重演「LoadFont 成功、BuildPDF 全线失败」（BUG-R6-02）。
FROM alpine:3.20
ARG APK_MIRROR=""
# 图片库需要把 HEIC/PSD/CDR/AI 转成预览图：ImageMagick 负责通用位图，
# libheif-tools 的 heif-convert 是 HEIC 的官方解码器（Alpine 的 ImageMagick 常未编 heif delegate）。
# 两者都在 community 仓库（与 font-wqy-zenhei 同源），故显式指定仓库。
# 装不上**不阻断镜像**：运行期按降级处理（只保存原件、不生成预览图），
# 并在 GET /api/images/converter 里如实报告，不会让服务起不来。
# 同 dwg-builder：APK_MIRROR 非空时把官方源域名换成镜像站。
# 下面这个 --repository 是 community 仓的兜底（wpy-zenhei 与 imagemagick 都在这里），
# 同理按 APK_MIRROR 拼，避免换了镜像站却只换了一半源、卡在 dl-cdn 上超时。
RUN if [ -n "${APK_MIRROR}" ]; then \
      sed -i -E "s#https?://dl-cdn\.alpinelinux\.org/alpine#${APK_MIRROR}#g" /etc/apk/repositories; \
    fi
RUN apk add --no-cache ca-certificates tzdata fontconfig font-wqy-zenhei su-exec \
      --repository "${APK_MIRROR:-https://dl-cdn.alpinelinux.org/alpine}/v3.20/community" \
      imagemagick libheif-tools \
    || apk add --no-cache ca-certificates tzdata fontconfig font-wqy-zenhei su-exec
RUN adduser -D -u 10001 haiku
WORKDIR /app
COPY --from=server-builder /bin/haiku-wiki /app/haiku-wiki
# 主配置模板：运行期挂载自己的目录覆盖（docker-compose 默认挂 ./conf:/app/conf）。
# 没挂时也能直接用 ENV 启动——config.Load 找不到文件会回退环境变量，不会起不来。
COPY conf/application.yml /app/conf/application.yml
# 入口脚本：root 启动时先修正挂载卷属主为 haiku(10001) 再降权执行，见脚本头部注释
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENV PORT=8080 \
    CONF_DIR=/app/conf \
    DATA_DIR=/app/data \
    GIN_MODE=release \
    EXPORT_FONT_PATH=/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc
RUN mkdir -p /app/data /app/conf && chown -R haiku:haiku /app
EXPOSE 8080
# 不再 USER haiku 固定降权：宿主机 bind mount 目录属主若是 root，
# UID 10001 无法在数据目录创建 SQLite -wal/-shm 文件，启动即报
# "unable to open database file: out of memory (14)"（实为目录不可写，非内存问题）。
# 改由入口脚本以 root 修正属主后 su-exec 降权为 haiku 运行；
# --user 非 root 启动时脚本直接透传执行。
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
