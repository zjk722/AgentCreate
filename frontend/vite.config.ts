import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Tailwind v4 是「CSS-first」配置：不再需要 tailwind.config.js，
  // 主题变量直接写在 CSS 里（见 src/index.css）。
  // 加这个插件后，Vite 会在构建时扫描源码里用到的类名并按需生成样式。
  plugins: [react(), tailwindcss()],

  /* ⚑ 开发期代理：把 `/v1/**` 与 `/health` 转到 Python 引擎（§3.4 的接口）。
     为什么用它、而不是让 `test.html` 跨域直打 8000：
       省掉 CORS 配置，而且页面里写的路径和"将来由 Java 提供"时长得一样
       （只差前缀：目标架构里是 `/api/v1/**` 走 Java）。

     ⚠️ 这是【开发脚手架】，只存在于 `test-frontend` 分支 ——
        A6 之后前端只跟 Java 说话，这两条代理要一起撤掉。 */
  server: {
    proxy: {
      '/v1': { target: 'http://localhost:8000', changeOrigin: true },
      '/health': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
