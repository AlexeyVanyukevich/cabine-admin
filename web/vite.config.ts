import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // One origin in development too, so the session cookie needs no cross-site relaxation and
  // there is no CORS to configure differently from production.
  //
  // `changeOrigin: false` is load-bearing, not tidiness. The server refuses any write whose
  // `Origin` disagrees with the `Host` it was addressed to — a CSRF check that needs no
  // configured origin. Vite 8 defaults this to true, which rewrites `Host` to the target while
  // the browser's `Origin` stays :5173, and every write in development answers 403
  // `forbidden_origin`. The shorthand string form takes that default silently.
  server: { proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } } },
  build: { outDir: '../server/public', emptyOutDir: true },
})
