import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  resolve: {
    alias: {
      '@Nexus/shared': '../../shared'
    }
  },
  plugins: [react()],
  server: {
    port: 5174, // 固定端口给 docs 应用
  }
})