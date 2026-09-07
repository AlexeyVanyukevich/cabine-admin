import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // `public/manifest.json` is hand-written and already linked from index.html. Letting the
      // plugin generate a second one would put two manifests on the page.
      manifest: false,
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
        // A client-side route must survive a reload with no network, exactly as it survives one
        // with a network via the server's SPA fallback.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Never cached, at any age. A stale availability grid answered as if fresh is the
            // "everything is free" mistake the fourth invariant exists to prevent; the offline
            // cache is written deliberately by the app, under a staleness stamp, not by Workbox.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            // The interface's typeface, so the offline shell is not a system-font fallback.
            urlPattern: ({ url }) =>
              url.origin.endsWith('googleapis.com') || url.origin.endsWith('gstatic.com'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // One origin in development too, so the session cookie needs no cross-site relaxation and
  // there is no CORS to configure differently from production.
  //
  // `changeOrigin: false` is load-bearing, not tidiness. The server refuses any write whose
  // `Origin` disagrees with the `Host` it was addressed to — a CSRF check that needs no
  // configured origin. Left to its default the proxy rewrites `Host` to the target while the
  // browser's `Origin` stays the dev server's, and every write in development is refused. The
  // shorthand string form of a proxy entry takes that default silently.
  server: { proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } } },
  build: { outDir: '../server/public', emptyOutDir: true },
})
