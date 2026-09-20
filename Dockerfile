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
# ⚠️ 这里曾经漏装 pkgconf，导致 configure 直接失败在
#     `configure: error: pkg-config not found`。
#     Alpine 的 build-base **不含** pkg-config（与 Debian 的 build-essential 不同），
#     而 libredwg 的 configure 硬依赖它 —— 于是整段构建失败，又被外层 `||` 静默吞掉，
#     镜像里 /out 是空的，运行期只会看到「未安装 DWG 转换器」这个看不出原因的现象。
#     故：构建日志落盘、失败原因写入 /out/converter-status.txt 一并带进镜像，
#     让运行期能报出真实原因，而不是变成一个哑谜。
#     （libtool / bash / perl 是 libredwg 构建脚本的常见依赖，一并装上以求稳。）
RUN apk add --no-cache build-base curl pkgconf libtool bash perl \
 && mkdir -p /out \
 && ( \
      set -eux; \
      log=/tmp/libredwg-build.log; \
      for base in "${LIBREDWG_URL}" \
                  https://mirrors.tuna.tsinghua.edu.cn/gnu/libredwg \
                  https://mirrors.aliyun.com/gnu/libredwg \
                  https://mirrors.ustc.edu.cn/gnu/libredwg; do \
        if curl -fsSL "${base}/libredwg-${LIBREDWG_VERSION}.tar.gz" -o /tmp/libredwg.tar.gz; then \
          echo "libredwg 源码已从 ${base} 下载"; break; \
        fi; \
        echo "!! 该镜像源不可用：${base}"; \
      done; \
      test -s /tmp/libredwg.tar.gz; \
      mkdir -p /build-src && tar -xzf /tmp/libredwg.tar.gz -C /build-src; \
      cd "/build-src/libredwg-${LIBREDWG_VERSION}"; \
      ./configure --disable-bindings --disable-python --disable-shared --enable-static --disable-docs > "$log" 2>&1; \
      make -j"$(nproc)" -C src >> "$log" 2>&1; \
      make -j"$(nproc)" -C programs dwg2dxf dwgread >> "$log" 2>&1; \
      ./programs/dwg2dxf --version >> "$log" 2>&1; \
      cp programs/dwg2dxf programs/dwgread /out/; \
      printf 'ok %s\n' "$(./programs/dwg2dxf --version 2>&1 | head -n1)" > /out/converter-status.txt; \
    ) \
 || { \
      echo "!! libredwg 构建失败：镜像将不含 DWG 矢量转换器，导入 .dwg 时降级为内嵌预览位图"; \
      { echo "libredwg 构建失败，原因（日志末尾）："; tail -n 40 /tmp/libredwg-build.log 2>/dev/null; } \
        > /out/converter-status.txt 2>&1 || true; \
      echo "!! 失败原因已写入 /usr/local/bin/converter-status.txt，可据此排查"; \
      tail -n 25 /out/converter-status.txt 2>/dev/null || true; \
    }

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
# 图片库需要把 HEIC/PSD/CDR/AI 转成预览图：ImageMagick 负责通用位图，
# libheif-tools 的 heif-convert 是 HEIC 的官方解码器（Alpine 的 ImageMagick 常未编 heif delegate）。
# 两者都在 community 仓库（与 font-wqy-zenhei 同源），故显式指定仓库。
# 装不上**不阻断镜像**：运行期按降级处理（只保存原件、不生成预览图），
# 并在 GET /api/images/converter 里如实报告，不会让服务起不来。
RUN apk add --no-cache ca-certificates tzdata fontconfig font-wqy-zenhei su-exec \
      --repository https://dl-cdn.alpinelinux.org/alpine/v3.20/community \
      imagemagick libheif-tools \
    || apk add --no-cache ca-certificates tzdata fontconfig font-wqy-zenhei su-exec
RUN adduser -D -u 10001 haiku
WORKDIR /app
COPY --from=server-builder /bin/haiku-wiki /app/haiku-wiki
# dwg2dxf / dwgread（libredwg 构建失败时为空目录，不影响启动）
COPY --from=dwg-builder /out/ /usr/local/bin/
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
    EXPORT_FONT_PATH=/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc \
    EXPORT_DWG_CONVERTER=/usr/local/bin/dwg2dxf \
    EXPORT_DWG_BUILD_STATUS=/usr/local/bin/converter-status.txt
RUN mkdir -p /app/data /app/conf && chown -R haiku:haiku /app
EXPOSE 8080
# 不再 USER haiku 固定降权：宿主机 bind mount 目录属主若是 root，
# UID 10001 无法在数据目录创建 SQLite -wal/-shm 文件，启动即报
# "unable to open database file: out of memory (14)"（实为目录不可写，非内存问题）。
# 改由入口脚本以 root 修正属主后 su-exec 降权为 haiku 运行；
# --user 非 root 启动时脚本直接透传执行。
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
