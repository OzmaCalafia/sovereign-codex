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
        // Precache app files; cache printed page scans on first view
        globPatterns: ['**/*.{js,css,html,ico,md,png,svg,woff2,json}'],
        runtimeCaching: [
          { urlPattern: /\/print\/p-\d+\.jpg$/, handler: 'CacheFirst', options: { cacheName: 'archive-print-pages' } }
        ]
      }
    })
  ]
});
