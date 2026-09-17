# syntax=docker/dockerfile:1
# ===== 海库（haiku-wiki）多阶段构建 =====
# 阶段 1：构建前端（Vite 产物）
FROM node:22-alpine AS web-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ ./
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
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 haiku
WORKDIR /app
COPY --from=server-builder /bin/haiku-wiki /app/haiku-wiki
ENV PORT=8080 \
    DATA_DIR=/app/data \
    GIN_MODE=release
RUN mkdir -p /app/data && chown -R haiku:haiku /app
VOLUME ["/app/data"]
EXPOSE 8080
USER haiku
ENTRYPOINT ["/app/haiku-wiki"]
