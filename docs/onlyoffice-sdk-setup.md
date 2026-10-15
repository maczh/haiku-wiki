# OnlyOffice 静态 SDK 构建输入

OnlyOffice 组件源码已在 `web/src/components/onlyoffice-web-comp`，但组件还需要独立的静态 SDK。`npm install` 只安装前端依赖，不会安装 SDK。SDK 体积较大，被 Git 忽略；切换分支或克隆仓库不会自动恢复它。

错误 `Failed to load OnlyOffice DocsAPI script` 对应的首个资源为：

`/packages/onlyoffice/9.4.0-develop/web-apps/apps/api/documents/api.js`

## 恢复资源

`npm run dev` / `npm run build` 会优先使用本地 SDK。缺失时，根据原仓库 `https://github.com/electroluxcode/onlyoffice-web-comp` 的固定提交 `99dbe255893b82fba46b82b337c571eb7d41f668` 获取完整静态 SDK。资源去重后并发下载，优先使用上游文档提供的资源 CDN，并逐文件校验 Git blob SHA；不匹配时回退到固定提交的 GitHub 原文件。资源最终仍由本站托管。首次准备约 1GB 本地文件，需要网络和 curl；下载或校验失败会停止构建。Docker 构建阶段已安装所需工具。

可以提前运行 `npm run prepare:onlyoffice` 准备资源；`npm run verify:onlyoffice` 只检查已有资源，不下载。离线构建可采用下面的手动恢复方式。

从原先可运行的 v2-oo 环境或原组件仓库取得完整的 `public/packages` 目录，放到本项目 `web/public/packages`。应包含 `onlyoffice/9.4.0-develop/`，其下有 `web-apps`、`sdkjs`、`x2t` 和 `x2t-fonts`，不能只复制 api.js。

也可以指定外部 packages 目录，让脚本复制到本项目：

```sh
cd web
ONLYOFFICE_PACKAGES_DIR=/absolute/path/to/public/packages npm run prepare:onlyoffice
npm run build
```

脚本也会自动检查同级 `onlyoffice-web-comp/public/packages` 和 `web/vendor/onlyoffice-packages`。`npm run dev`、`npm run build` 都先执行 SDK 校验，缺少关键文件时会直接报告路径并退出。

Docker 构建前可先在宿主机完成上述准备，`web/public/packages` 会随 `COPY web/` 进入前端构建阶段；未提前准备时由构建阶段下载。然后由 Vite 复制到 dist、由 Go embed 纳入后端。只重编译前端不会更新已编译的后端二进制，需要重建实际部署的镜像或 Go embed 二进制。

本项目保持 SDK 自托管，不会因缺少本地文件而自动将文档编辑切换到第三方 CDN。
