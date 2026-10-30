// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import prettier from 'eslint-config-prettier';

/**
 * Wspólna konfiguracja ESLint dla całego monorepo.
 * Zasady JSDoc są wymuszane na eksportowanych symbolach — zgodnie z wytycznymi projektu
 * (patrz plans/02-architecture.md → "Konwencje kodu").
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/migrations/**', 'data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  jsdoc.configs['flat/recommended-typescript'],
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      'jsdoc/require-jsdoc': [
        'warn',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
          },
          contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration'],
        },
      ],
      'jsdoc/require-param-description': 'warn',
      'jsdoc/require-returns-description': 'warn',
      'jsdoc/tag-lines': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Konfiguracje w JS (eslint.config.js, postcss.config.js) nie należą do żadnego
    // tsconfiga, więc usługa projektu nie potrafi ich sparsować. Reguły wymagające
    // typów są tu wyłączone — plik nadal przechodzi przez reguły składniowe.
    files: ['**/*.config.js', 'eslint.config.js', 'design/tools/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' },
    },
    rules: {
      // Skrypty narzędziowe uruchamia człowiek z terminala i to `console.log` jest
      // ich jedynym wyjściem — zakaz z reguły głównej dotyczy kodu aplikacji.
      'no-console': 'off',
    },
  },
  {
    // Skrypt motywu z `public/` przeglądarka ładuje bez bundlera, przed pierwszym
    // malowaniem (ADR-067) — zwykły JS poza tsconfigiem, więc bez reguł z typami.
    files: ['apps/web/public/**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly' },
    },
  },
  {
    // Skrypty CLI z `apps/api/src/scripts/` uruchamia człowiek z terminala i to
    // standardowe wyjście jest ich interfejsem. `user:create` musi wypisać PIN
    // na ekran, a NIE do loggera — logger pisze do pliku i do systemu zbierania
    // logów, gdzie PIN nie ma prawa się znaleźć (09 §7).
    files: ['apps/api/src/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // `lib/query-keys.ts` to tabela stałych zapisana jako jednoliniowe fabryki.
    // Każdy klucz ma już opis nad sobą, a `@param month - Klucz miesiąca` przy
    // `month: (month) => ['months', month]` byłby dokładnie tym szumem, którego
    // zakazuje `plans/02-architecture.md §8`. Sam obiekt `qk` — jedyny eksport tego
    // modułu, a więc jedyny objęty regułą z `CLAUDE.md` — jest udokumentowany.
    files: ['**/lib/query-keys.ts'],
    rules: {
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**'],
    rules: {
      'jsdoc/require-jsdoc': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  prettier,
);
