import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // simple-mind-map 依赖 @svgdotjs/svg.js（纯 ESM），显式预打包避免开发期 504
    include: ['simple-mind-map', '@svgdotjs/svg.js'],
  },
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
