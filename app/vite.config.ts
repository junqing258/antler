import path from 'node:path';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'test' ? [] : [codeInspectorPlugin({ bundler: 'vite' })]),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        id: '/',
        name: 'Antler',
        short_name: 'Antler',
        description: 'Antler AI 助手',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#14a883',
        background_color: '#ffffff',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/health(?:\/|$)/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}']
    }
  }
}));
