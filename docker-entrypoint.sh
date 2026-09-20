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
    # 卷未挂载时目录已在镜像内属 haiku；挂载卷属主是 root 时，先在 root 下把属主
    # 修正为 haiku，再降权运行（postgres 镜像同款模式）。
    # 注意：chown 失败**不再静默吞掉**——打印明确告警，让真正的权限问题暴露出来，
    # 而不是等 gorm 透出那句摸不着头脑的 "unable to open database file: out of memory (14)"。
    for d in /app/data /app/conf; do
        if [ -d "$d" ]; then
            if chown -R "$RUN_USER":"$RUN_GROUP" "$d" 2>/tmp/haiku-chown.err; then
                :
            else
                echo "[entrypoint] 警告：修正 $d 属主为 $RUN_USER:$RUN_GROUP 失败：" >&2
                sed 's/^/    /' /tmp/haiku-chown.err >&2
                echo "[entrypoint] 这说明挂载目录无法被 root 改属主（常见于只读挂载或底层文件系统不支持 chown）。" >&2
                echo "[entrypoint] 请以 --user $RUN_USER 启动，并自行保证 $d 对该 UID 可写；或改用可写挂载。" >&2
            fi
        fi
    done
    exec su-exec "$RUN_USER":"$RUN_GROUP" /app/haiku-wiki "$@"
fi

exec /app/haiku-wiki "$@"
