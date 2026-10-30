import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Konfiguracja testów frontu.
 *
 * Osobna od `vite.config.ts`, bo ta druga ładuje wtyczkę PWA — generowanie service
 * workera przy każdym uruchomieniu testów kosztuje sekundy i nie sprawdza niczego.
 *
 * Alias `@fineapp/shared` kieruje na **źródło**, tak samo jak w `apps/api`: po świeżym
 * klonie `pnpm test` ma działać bez wcześniejszego `pnpm build` (ADR-015).
 *
 * Środowisko `jsdom`, bo prymitywy z `15 §4` niosą reguły, których nie da się sprawdzić
 * bez renderu: znak kwoty, `aria-label`, wysokość celu dotykowego, kształt znacznika celu.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@fineapp/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./test/setup.ts'],
  },
});
