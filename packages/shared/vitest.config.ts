import { defineConfig } from 'vitest/config';

/**
 * Konfiguracja testów paczki kontraktów.
 *
 * Progi pokrycia są **twarde i ustawione na 100%**, bo to jest wymaganie zadania `F0-3`
 * z [11-roadmap.md](../../plans/11-roadmap.md): `money.ts` i `month.ts` są fundamentem
 * poprawności wszystkich obliczeń w aplikacji. Próg zapisany w konfiguracji sprawdza się
 * sam przy każdym uruchomieniu; próg zapisany w dokumencie sprawdza się nigdy.
 *
 * Z pomiaru wyłączony jest `index.ts` — to barrel bez logiki.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      reporter: ['text', 'text-summary'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
