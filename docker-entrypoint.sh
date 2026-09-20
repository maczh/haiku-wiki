#!/bin/sh
# haiku-wiki 容器入口脚本。
#
# 为什么需要它：镜像内的服务以 haiku (UID 10001) 运行；SQLite(WAL) 要在数据
# 目录里创建 <db>-wal/-shm 文件，因此**目录本身**必须可写。宿主机 bind mount
# 的目录属主往往是 root（例如 docker run -v /root/haiku/data:/app/data），
# 此时启动直接失败，且 glebarez 纯 Go 驱动只报一句误导性的
# "unable to open database file: out of memory (14)"（实为目录不可写）。
#
# 处理方式（官方 postgres 镜像同款模式）：
#   · 容器以 root 启动（docker 默认）→ 先把挂载卷属主修正为 haiku:haiku，
#     再通过 su-exec 降权执行服务，服务进程本身绝不以 root 跑。
#   · 以 --user 显式指定非 root 用户启动 → 无权改属主，直接透传执行。
#     （此时请自行保证挂载目录对该 UID 可写。）
set -e

RUN_USER=haiku
RUN_GROUP=haiku

if [ "$(id -u)" = "0" ]; then
    # 卷未挂载时目录已在镜像内属 haiku；属主修正失败（如只读挂载）不阻断启动，
    # 让服务自己报出后续的真实错误。
    chown -R "$RUN_USER":"$RUN_GROUP" /app/data /app/conf 2>/dev/null || true
    exec su-exec "$RUN_USER":"$RUN_GROUP" /app/haiku-wiki "$@"
fi

exec /app/haiku-wiki "$@"
