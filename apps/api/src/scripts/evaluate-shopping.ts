import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { STARTER_STAPLES } from '@fineapp/shared';

import { estimateCostMinor } from '../ai/cost.js';
import { prepareForVision } from '../ai/prepare-for-vision.js';
import { createAnthropicShoppingExtractor } from '../ai/shopping-extractor.js';
import { loadConfig } from '../core/config.js';
import { isEntryPoint } from '../core/entry-point.js';
import { loadEnvFile } from '../core/env-file.js';
import { safeFetchHtml } from '../core/safe-fetch.js';
import type { PreparedPart } from '../ai/document-extractor.js';
import { normalizeUpload, sniffMediaType } from '../modules/documents/documents.files.js';
import { recipeSourceFromHtml } from '../modules/shopping/shopping.recipe-source.js';
import {
  ExpectedListSchema,
  ExpectedRecipeSchema,
  SHOPPING_TARGETS,
  scoreEntries,
  shoppingQualityReport,
  type EntryScore,
  type ShoppingQualityReport,
} from './shopping-metrics.js';

/**
 * Ocena jakości importów list zakupów — `pnpm --filter @fineapp/api shopping:evaluate`
 * ([17 §11](../../../../plans/17-shopping-lists.md#11-zadania), `F10-10`).
 *
 * Katalog (domyślnie `test/fixtures/shopping/`, poza repozytorium — `.gitignore`) zawiera
 * pary: wejście i oczekiwania `<nazwa>.expected.json`. Rodzaj wynika z przedrostka:
 *
 * - `lista-*.jpg|png|webp|heic` — zdjęcie listy: `{ "items": [{ "name": "mleko", "quantityMilli": 2000 }] }`;
 * - `przepis-*.jpg|png|webp|heic` (zrzut), `przepis-*.txt` (wklejony tekst),
 *   `przepis-*.url` (jedna linia z adresem) — przepis:
 *   `{ "baseServings": 12, "ingredients": [{ "name": "czekolada", "baseAmountMilli": 200000, "baseUnit": "g" }, { "name": "sól", "pantryStaple": true }] }`.
 *
 * Model dostaje startowe „zawsze w domu" (`STARTER_STAPLES`), jak świeża instalacja.
 * Każdy plik to **prawdziwe wywołanie płatnej usługi** (`AI_MODEL`, `ANTHROPIC_API_KEY`
 * z `.env`); link to też prawdziwe pobranie strony przez `safeFetchHtml`.
 */

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);
const RECIPE_TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['.txt', '.url']);

/**
 * Procent do tabeli.
 *
 * @param value - Ułamek albo `null`.
 * @returns Np. `96,0%` albo `—`.
 */
function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1).replace('.', ',')}%`;
}

/**
 * Tabela wyników do wklejenia w `plans/13-progress.md`.
 *
 * @param title - Nagłówek (rodzaj wejścia).
 * @param report - Wskaźniki zbioru.
 * @returns Tekst tabeli Markdown.
 */
export function formatShoppingReport(title: string, report: ShoppingQualityReport): string {
  return [
    `${title}: ${String(report.samples)}`,
    '',
    '| Wskaźnik | Cel | Wynik |',
    '|---|---|---|',
    `| Znalezione pozycje | ≥ ${percent(SHOPPING_TARGETS.recall)} | ${percent(report.recall)} |`,
    `| Pozycje nadmiarowe | ≤ ${percent(SHOPPING_TARGETS.extraRate)} | ${percent(report.extraRate)} |`,
    `| Trafne ilości (±10%) | ≥ ${percent(SHOPPING_TARGETS.amountAccuracy)} | ${percent(report.amountAccuracy)} |`,
    `| Trafne porcje | — | ${percent(report.servingsAccuracy)} |`,
    '',
    report.meetsTargets ? 'Cele spełnione.' : 'Cele NIE są spełnione — praca nad promptem.',
  ].join('\n');
}

/**
 * Obrazy pliku w postaci dla modelu (HEIC → JPEG, EXIF usunięty).
 *
 * @param bytes - Zawartość pliku.
 * @returns Przygotowane obrazy albo `null` dla nieobsługiwanego typu.
 */
async function imageParts(bytes: Buffer): Promise<PreparedPart[] | null> {
  const mediaType = sniffMediaType(bytes.subarray(0, 16));
  if (mediaType === null || mediaType === 'application/pdf') return null;
  const normalized = await normalizeUpload(bytes, mediaType);
  return prepareForVision(normalized.bytes, normalized.mimeType);
}

/** Punkt wejścia. */
async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig({ ...process.env, AI_ENABLED: 'true' });
  const dir = process.argv[2] ?? join(process.cwd(), 'test', 'fixtures', 'shopping');
  const extractor = createAnthropicShoppingExtractor(config.ai);
  const staples = STARTER_STAPLES.map((staple) => staple.name);
  const files = (await readdir(dir)).filter((file) => !file.endsWith('.expected.json')).sort();

  const lists: EntryScore[] = [];
  const recipes: EntryScore[] = [];
  let costMinor = 0;
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    const name = basename(file, extname(file));
    const isList = name.startsWith('lista-');
    if (!isList && !name.startsWith('przepis-')) continue;
    if (!IMAGE_EXTENSIONS.has(ext) && !(RECIPE_TEXT_EXTENSIONS.has(ext) && !isList)) continue;
    const expectedJson: unknown = JSON.parse(
      await readFile(join(dir, `${name}.expected.json`), 'utf8'),
    );
    const content = await readFile(join(dir, file));
    try {
      if (isList) {
        const expected = ExpectedListSchema.parse(expectedJson);
        const parts = await imageParts(content);
        if (parts === null) {
          console.error(`  ${file}: nieobsługiwany typ — pomijam`);
          continue;
        }
        const result = await extractor.extractList({ model: config.ai.model, parts });
        costMinor += estimateCostMinor(result.usage, config.ai);
        const score = scoreEntries(
          expected.items.map((item) => ({
            name: item.name,
            amountMilli: item.quantityMilli,
            unit: null,
            pantryStaple: false,
          })),
          result.items.map((item) => ({
            name: item.name,
            amountMilli: item.quantityMilli,
            unit: item.unit,
            pantryStaple: false,
          })),
          null,
        );
        lists.push(score);
        console.log(
          `  ${file}: ${String(score.found)}/${String(score.expected)} · nadmiarowe ${String(score.extra)}`,
        );
        continue;
      }
      const expected = ExpectedRecipeSchema.parse(expectedJson);
      let parts: PreparedPart[] = [];
      let text: string | null = null;
      if (ext === '.txt') text = content.toString('utf8');
      else if (ext === '.url') {
        const page = await safeFetchHtml(content.toString('utf8').trim());
        text = recipeSourceFromHtml(page.html).text;
      } else {
        const prepared = await imageParts(content);
        if (prepared === null) {
          console.error(`  ${file}: nieobsługiwany typ — pomijam`);
          continue;
        }
        parts = prepared;
      }
      const result = await extractor.extractRecipe({
        model: config.ai.model,
        parts,
        text,
        staples,
      });
      costMinor += estimateCostMinor(result.usage, config.ai);
      const score = scoreEntries(
        expected.ingredients.map((item) => ({
          name: item.name,
          amountMilli: item.baseAmountMilli,
          unit: item.baseUnit,
          pantryStaple: item.pantryStaple,
        })),
        result.ingredients.map((item) => ({
          name: item.name,
          amountMilli: item.baseAmountMilli,
          unit: item.baseUnit,
          pantryStaple: item.pantryStaple,
        })),
        { expected: expected.baseServings, predicted: result.baseServings },
      );
      recipes.push(score);
      console.log(
        `  ${file}: ${String(score.found)}/${String(score.expected)} · nadmiarowe ${String(score.extra)} · ilości ${String(score.amountCorrect)}/${String(score.amountChecked)}`,
      );
    } catch (error) {
      console.error(
        `  ${file}: odczyt nieudany — ${error instanceof Error ? error.message : String(error)}`,
      );
      const missed = scoreEntries([], [], null);
      const count = isList
        ? ExpectedListSchema.parse(expectedJson).items.length
        : ExpectedRecipeSchema.parse(expectedJson).ingredients.length;
      (isList ? lists : recipes).push({ ...missed, expected: count });
    }
  }
  console.log(`\nSzacowany koszt: ${String(costMinor)} gr\n`);
  console.log(`${formatShoppingReport('Zdjęć listy', shoppingQualityReport(lists))}\n`);
  console.log(`${formatShoppingReport('Przepisów', shoppingQualityReport(recipes))}\n`);
}

if (isEntryPoint(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
