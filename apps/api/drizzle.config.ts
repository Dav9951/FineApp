import { defineConfig } from 'drizzle-kit';

/**
 * Konfiguracja drizzle-kit (generowanie migracji SQL ze schematu TS).
 *
 * Migracje są generowane do `src/db/migrations` i commitowane do repo —
 * uruchamiane deterministycznie przy starcie kontenera (patrz plans/10-deployment.md).
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? './data/fineapp.db',
  },
  strict: true,
  verbose: true,
});
