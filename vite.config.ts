import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Relative base so the build works from any static host path (GitHub Pages, a /travel/ folder on PythonAnywhere…).
export default defineConfig({
  base: './',
  // Local testing of sync: run `python3 server/travel_sync.py` (port 8792) next to `npm run dev`.
  server: { proxy: { '/travel-api': 'http://127.0.0.1:8792' } },
  build: {
    rolldownOptions: {
      output: {
        // Ship the map worker as .js: some static hosts serve .mjs with a MIME type browsers refuse for module workers.
        assetFileNames: (asset) => (asset.names?.[0]?.endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Travel Manager',
        short_name: 'Trips',
        description: 'Plan trips and follow them day by day, offline.',
        theme_color: '#0f766e',
        background_color: '#f6f5f1',
        display: 'standalone',
        start_url: './index.html', // explicit file: not every static host serves a folder's index page
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Map style, vector tiles, fonts and sprites: keep what you have viewed for offline use.
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 5000, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.hostname.endsWith('wikipedia.org') || url.hostname.endsWith('wikimedia.org'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'wiki',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
})
