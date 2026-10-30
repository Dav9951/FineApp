import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Konfiguracja testów API.
 *
 * `@fineapp/shared` wystawia na zewnątrz `dist` — to jest warunek tego, żeby
 * `node dist/index.js` w kontenerze w ogóle wystartował (ADR-015). Testy nie mogą
 * jednak zależeć od wcześniejszego zbudowania paczki: po świeżym klonie `pnpm test`
 * musi działać bez `pnpm build`. Dlatego alias kieruje na **źródło**, dokładnie tak
 * samo jak robi to `apps/web/vite.config.ts`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@fineapp/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
