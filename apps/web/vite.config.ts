import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt": o app nunca recarrega sozinho com operações pendentes (SPECS §9.2).
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'playTorneios',
        short_name: 'playTorneios',
        lang: 'pt-BR',
        start_url: '/',
        display: 'standalone',
        background_color: '#0A0E14',
        theme_color: '#0A0E14',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/p\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: 'index.html', public: 'public.html' } },
  },
  server: { proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true } } },
});
