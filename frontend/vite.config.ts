import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Tailwind v4 是「CSS-first」配置：不再需要 tailwind.config.js，
  // 主题变量直接写在 CSS 里（见 src/index.css）。
  // 加这个插件后，Vite 会在构建时扫描源码里用到的类名并按需生成样式。
  plugins: [react(), tailwindcss()],
})
