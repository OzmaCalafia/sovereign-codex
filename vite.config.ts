import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    port: 5180,
    strictPort: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: '[SC] [SOVEREIGN CODEX]',
        short_name: '[SC]',
        description: 'Offline-first writing and archival tool with encrypted entry content and portable backups',
        theme_color: '#090a0f',
        background_color: '#090a0f',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        // Precache the app shell; large media and non-Latin font subsets are cached on first use.
        globPatterns: ['**/*.{js,css,html,ico,md,png,svg,woff2,json}'],
        globIgnores: [
          '**/protocol-00-baseline-anchor.png',
          '**/ubuntu-cyrillic*',
          '**/ubuntu-greek*',
          '**/ubuntu-latin-ext-*'
        ],
        runtimeCaching: [
          { urlPattern: /\/print\/p-\d+\.jpg$/, handler: 'CacheFirst', options: { cacheName: 'archive-print-pages' } },
          { urlPattern: /\/(protocol-00-baseline-anchor\.png|archive-cover-(front|back)\.jpg)$/, handler: 'CacheFirst', options: { cacheName: 'archive-media' } },
          { urlPattern: /\/assets\/ubuntu-.*\.woff2$/, handler: 'CacheFirst', options: { cacheName: 'fonts' } }
        ]
      }
    })
  ]
});
