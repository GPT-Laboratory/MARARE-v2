import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const urlConfig = JSON.parse(
  readFileSync(join(__dirname, 'config/appUrls.json'), 'utf-8')
)

const apiPort = process.env.VITE_API_PORT || urlConfig.local.apiPort
const backendProxyTarget =
  process.env.VITE_SOCKET_URL ||
  urlConfig.local.backendBaseUrl ||
  `http://localhost:${apiPort}`
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills()
  ],
  server: {
    proxy: {
      '/api1': {
        target: backendProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api1/, '')
      },
      
    }
  },
  build: {
    outDir: 'dist'
  },
})
