import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // One origin in development too, so the session cookie needs no cross-site relaxation and
  // there is no CORS to configure differently from production.
  server: { proxy: { '/api': 'http://localhost:4000' } },
  build: { outDir: '../server/public', emptyOutDir: true },
})
