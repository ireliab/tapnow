import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// WEB_PORT / API_PORT let a sandbox instance run next to the normal one (see scripts/dev-sandbox.mjs)
const api = `127.0.0.1:${process.env.API_PORT ?? 8787}`
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': `http://${api}`, '/files': `http://${api}`, '/mcp': `http://${api}`, '/ws': { target: `ws://${api}`, ws: true } },
  },
})
