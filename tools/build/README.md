# tools/build —— 本地构建脚本

| 脚本 | 作用 |
| --- | --- |
| `build-embed.sh` | 前端 `vite build` → 刷新 `server/internal/static/dist`（embed）→ `go build` 出 `$TMPDIR/haiku-wiki`。**跑浏览器回归前必须先跑它**，否则套件测的是旧产物。 |
| `build-guide-pdf.sh` | `docs/寄海文库功能指南.md` → PDF（pandoc 出 standalone HTML，再 Chrome headless `--print-to-pdf`）。样式在 `docs/.guide-style.css`。 |

## 注意

- 本机 pandoc 是 **2.17.1.1，没有 `--embed-resources`** → 脚本用 `--self-contained`。
- `vite build` 的 `emptyDir` 会撞上宿主的批量删除守卫，所以脚本里是**先把旧产物 `mv` 走**再构建，
  绝不用 `rm -rf`。刷新 embed 目录同样是 `mv`。
- 刷新 embed 时不能碰 `.gitkeep`（`*` 不匹配点号开头的文件，它会被原地保留）。
- 视频流水线在 `../video/`（`seed-demo.py` → `capture-shots.sh` → `build-guide-video.py`），
  见其 README。
- 回归套件在 `../verify/`，跑法见其 README。
