# syntax=docker/dockerfile:1
# ===== 寄海文库（haiku-wiki）多阶段构建 =====

# 阶段 0：构建 DWG → DXF 转换器（libredwg 的 dwg2dxf / dwgread）
# DWG 是 AutoCAD 的专有二进制格式，纯 Go 无法解析；服务端借这个外部转换器把
# .dwg 还原成矢量预览（SVG/PNG），没有它就只能退化为「抽取 DWG 内嵌预览位图」。
# 因此这里的构建失败**不阻断镜像**：/out 目录始终创建，复制进镜像的可能是空目录，
# 运行期会在启动日志与 GET /api/cad/converter 里如实报告降级状态。
# 镜像内只用 libm/libc，构建在 alpine 上完成即可与运行期 ABI 一致。
# 国内网络拉不到 ftp.gnu.org 时，可用 --build-arg 换镜像源，或直接跳过该能力。
FROM alpine:3.20 AS dwg-builder
ARG LIBREDWG_VERSION=0.14
ARG LIBREDWG_URL=https://ftp.gnu.org/gnu/libredwg
RUN apk add --no-cache build-base curl \
 && mkdir -p /out \
 && ( \
      set -eux; \
      curl -fsSL "${LIBREDWG_URL}/libredwg-${LIBREDWG_VERSION}.tar.gz" -o /build-libredwg.tar.gz; \
      mkdir -p /build-src && tar -xzf /build-libredwg.tar.gz -C /build-src; \
      cd "/build-src/libredwg-${LIBREDWG_VERSION}"; \
      ./configure --disable-bindings --disable-python --disable-shared --enable-static --disable-docs; \
      make -j"$(nproc)" -C src; \
      make -j"$(nproc)" -C programs dwg2dxf dwgread; \
      cp programs/dwg2dxf programs/dwgread /out/; \
    ) \
 || echo "!! libredwg 构建失败：镜像将不含 DWG 矢量转换器，导入 .dwg 时降级为内嵌预览位图"

# 阶段 1：构建前端（Vite 产物）
FROM node:22-alpine AS web-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ ./
# prebuild 会同步 Vditor 与 draw.io 两套自托管静态资源：
#   web/vendor/drawio 已随构建上下文带入时直接复用；缺失时自动联网拉取，
#   拉取失败只告警不中断（绘图文档类型会提示"绘图组件未部署"）。
RUN npm run build

# 阶段 2：构建后端（纯 Go，免 CGO，嵌入前端产物）
FROM golang:1.23-alpine AS server-builder
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
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata fontconfig font-wqy-zenhei && adduser -D -u 10001 haiku
WORKDIR /app
COPY --from=server-builder /bin/haiku-wiki /app/haiku-wiki
# dwg2dxf / dwgread（libredwg 构建失败时为空目录，不影响启动）
COPY --from=dwg-builder /out/ /usr/local/bin/
ENV PORT=8080 \
    DATA_DIR=/app/data \
    GIN_MODE=release \
    EXPORT_FONT_PATH=/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc
RUN mkdir -p /app/data && chown -R haiku:haiku /app
VOLUME ["/app/data"]
EXPOSE 8080
USER haiku
ENTRYPOINT ["/app/haiku-wiki"]
