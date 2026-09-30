import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 旧的 simple-mind-map 依赖 @svgdotjs/svg.js（纯 ESM）需要显式预打包；
  // 现在思维导图走 vendored 的 mindmap-vite，无特殊 ESM 依赖，交给 Vite 自动预打包即可。
  server: {
    port: 5173,
    proxy: {
      // 开发期代理到本地 Go 服务
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/uploads': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
})
