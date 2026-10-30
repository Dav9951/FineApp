import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/**
 * Konfiguracja Vite dla aplikacji webowej.
 *
 * - `/api` jest proxowane na backend w trybie dev (w produkcji Fastify serwuje `dist/` obok API).
 * - PWA daje instalowalność na telefonie oraz offline shell (dane zawsze z sieci).
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'FineApp — budżet domowy',
        short_name: 'FineApp',
        description: 'Planowanie budżetu domowego',
        // Wartość `--background` motywu ciemnego z `src/styles/tokens.css`
        // (28 14% 9%). Aplikacja startuje w ciemnym motywie (06 §1.5), więc pasek
        // statusu i ekran powitalny mają ten sam kolor co treść. Manifest nie czyta
        // CSS, więc jest to jedyne miejsce w projekcie z zapisem HEX — przy zmianie
        // tokenu trzeba je poprawić ręcznie.
        theme_color: '#1a1714',
        background_color: '#1a1714',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        lang: 'pl',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Dane finansowe nigdy nie są cache'owane — tylko powłoka aplikacji.
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@fineapp/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Bez map źródeł w produkcji — cały kod frontu byłby do pobrania pod /assets/*.map
    // (Z-45, ADR-066). Do debugowania: `vite build --sourcemap` lokalnie.
    sourcemap: false,
  },
});
