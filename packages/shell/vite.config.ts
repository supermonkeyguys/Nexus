import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

export default defineConfig({
  resolve: {
    alias: {
      '@Nexus/shared': path.join(__dirname, '../shared/index.ts') // 确保指向源码
    }
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // 确保这些 Node 原生模块不被打包进 main.js
              external: ['electron', 'axios', 'mongoose', 'node:path', 'node:url', 'node:module']
            }
          }
        }
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            rollupOptions: {
              output: {
                // 关键点：强制使用 CommonJS 格式并命名为 .cjs
                format: 'cjs',
                entryFileNames: 'preload.cjs'
              }
            }
          }
        }
      },
      renderer: {}
    }),
  ],
})