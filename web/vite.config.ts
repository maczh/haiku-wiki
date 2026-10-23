import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/

/**
 * 开发期 API 代理目标。
 *
 * 必须与后端实际端口一致，否则 /api 会被代理到一个不存在（或不属于本项目）的服务上，
 * 表现为难以理解的 404 / 500 —— 曾经就这么排查过半天：后端在 8081，
 * 而单独 `npm run dev` 起的 Vite 没继承 HAIKU_DEV_API_TARGET，回落到了 8080。
 *
 * `./dev.sh` 会自动 export 这个变量（见脚本内 `export HAIKU_DEV_API_TARGET=...`）；
 * 手动起 dev 时必须自己设，或直接用 dev.sh。
 */
const apiTarget = process.env.HAIKU_DEV_API_TARGET || 'http://localhost:8080'
if (!process.env.HAIKU_DEV_API_TARGET) {
  console.warn(
    `[vite] 未设置 HAIKU_DEV_API_TARGET，/api 与 /uploads 将代理到 ${apiTarget}。\n` +
      '       若后端不在该端口，页面会报 404/500 且看不出原因。\n' +
      '       建议改用 ./dev.sh 启动（自动设置），或手动执行：\n' +
      '       export HAIKU_DEV_API_TARGET=http://127.0.0.1:<后端端口>',
  )
}

export default defineConfig({
  plugins: [react()],
  // docx-editor 的 HarfBuzz/WASM 加载器使用顶层 await，需要交给现代浏览器原样处理。
  optimizeDeps: {
    exclude: ['emf-converter'],
    esbuildOptions: { target: 'esnext' },
  },
  // 旧的 simple-mind-map 依赖 @svgdotjs/svg.js（纯 ESM）需要显式预打包；
  // 现在思维导图走 vendored 的 mindmap-vite，无特殊 ESM 依赖，交给 Vite 自动预打包即可。
  server: {
    port: 5173,
    proxy: {
      // 开发期代理到本地 Go 服务
      '/api': { target: apiTarget, changeOrigin: true },
      '/uploads': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    chunkSizeWarningLimit: 2000,
    rollupOptions: { external: ['@napi-rs/canvas'] },
  },
})
