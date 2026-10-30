import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { todayInTimezone } from '@fineapp/shared';

import { createAnthropicExtractor } from '../ai/anthropic-extractor.js';
import { estimateCostMinor } from '../ai/cost.js';
import { prepareForVision } from '../ai/prepare-for-vision.js';
import { loadConfig } from '../core/config.js';
import { isEntryPoint } from '../core/entry-point.js';
import { loadEnvFile } from '../core/env-file.js';
import { openDatabase } from '../db/client.js';
import { applyMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed/index.js';
import { listCategoriesFlat } from '../modules/categories/categories.service.js';
import { normalizeUpload, sniffMediaType } from '../modules/documents/documents.files.js';
import { buildCategoryContext } from '../modules/documents/documents.service.js';
import {
  ExpectedReceiptSchema,
  qualityReport,
  scoreReceipt,
  type QualityReport,
  type ReceiptScore,
} from './ocr-metrics.js';

/**
 * Ocena jakości OCR na rzeczywistych paragonach — `pnpm --filter @fineapp/api ocr:evaluate`
 * ([08 §15](../../../../plans/08-ocr-ai-pipeline.md#15-ocena-jakości), `F7-11`).
 *
 * Katalog (domyślnie `test/fixtures/receipts/`, poza repozytorium — `.gitignore`) zawiera
 * pary: zdjęcie `lidl-1.jpg` i oczekiwania `lidl-1.expected.json`:
 *
 * ```json
 * { "totalMinor": 12799, "bookedOn": "2026-09-18",
 *   "items": [{ "amountMinor": 698, "category": "zakupy-spozywcze" }] }
 * ```
 *
 * Kategorie to `slug` z kategorii domyślnych — skrypt zakłada bazę w pamięci z seedem,
 * więc model widzi ten sam kontekst co świeża instalacja. Każdy paragon to **prawdziwe
 * wywołanie płatnej usługi** (`AI_MODEL`, `ANTHROPIC_API_KEY` z `.env`).
 */

/** Rozszerzenia plików branych do oceny. */
const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.pdf',
]);

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
 * @param report - Wskaźniki zbioru.
 * @param costMinor - Łączny szacowany koszt w groszach.
 * @returns Tekst tabeli Markdown.
 */
export function formatQualityReport(report: QualityReport, costMinor: number): string {
  return [
    `Paragonów: ${String(report.receipts)} · szacowany koszt: ${String(costMinor)} gr`,
    '',
    '| Wskaźnik | Cel | Wynik |',
    '|---|---|---|',
    `| Trafność odczytu sumy | ≥ 95% | ${percent(report.totalAccuracy)} |`,
    `| Trafność odczytu daty | ≥ 90% | ${percent(report.dateAccuracy)} |`,
    `| Trafność kategorii (confidence ≥ 0.8) | ≥ 85% | ${percent(report.categoryAccuracy)} |`,
    `| Pozycje do ręcznej korekty | ≤ 20% | ${percent(report.correctionRate)} |`,
    '',
    report.meetsTargets
      ? 'Cele spełnione.'
      : 'Cele NIE są spełnione — praca nad promptem i ai_hints.',
  ].join('\n');
}

/** Punkt wejścia. */
async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig({ ...process.env, AI_ENABLED: 'true' });
  const dir = process.argv[2] ?? join(process.cwd(), 'test', 'fixtures', 'receipts');
  const handle = openDatabase(':memory:');
  applyMigrations(handle);
  const { householdId } = seedDatabase(handle, config);
  const slugs = new Map(
    listCategoriesFlat(handle, householdId, { includeArchived: false }).map((category) => [
      category.id,
      category.slug,
    ]),
  );
  const extractor = createAnthropicExtractor(config.ai);
  const today = todayInTimezone(config.defaults.timezone);

  const files = (await readdir(dir)).filter((file) =>
    DOCUMENT_EXTENSIONS.has(extname(file).toLowerCase()),
  );
  const scores: ReceiptScore[] = [];
  let costMinor = 0;
  for (const file of files.sort()) {
    const name = basename(file, extname(file));
    const expected = ExpectedReceiptSchema.parse(
      JSON.parse(await readFile(join(dir, `${name}.expected.json`), 'utf8')),
    );
    const bytes = await readFile(join(dir, file));
    const mediaType = sniffMediaType(bytes.subarray(0, 16));
    if (mediaType === null) {
      console.error(`  ${file}: nieobsługiwany typ — pomijam`);
      continue;
    }
    const normalized = await normalizeUpload(bytes, mediaType);
    try {
      const result = await extractor.extract({
        kind: 'receipt',
        parts: await prepareForVision(normalized.bytes, normalized.mimeType),
        categories: buildCategoryContext(handle, householdId, 'receipt', today),
        timezone: config.defaults.timezone,
        currency: config.defaults.currency,
      });
      costMinor += estimateCostMinor(result.usage, config.ai);
      const score = scoreReceipt(expected, {
        totalMinor: result.header.totalMinor,
        bookedOn: result.header.bookedOn,
        items: result.items
          .filter((item) => item.direction === 'outflow')
          .map((item) => ({
            amountMinor: item.amountMinor,
            category: item.categoryId === null ? null : (slugs.get(item.categoryId) ?? null),
            confidence: item.confidence,
          })),
      });
      scores.push(score);
      console.log(
        `  ${file}: suma ${score.totalCorrect ? '✓' : '✗'} · data ${score.dateCorrect ? '✓' : '✗'} · korekt ${String(score.corrections)}/${String(score.expectedItems)}`,
      );
    } catch (error) {
      console.error(
        `  ${file}: odczyt nieudany — ${error instanceof Error ? error.message : String(error)}`,
      );
      scores.push(scoreReceipt(expected, { totalMinor: null, bookedOn: null, items: [] }));
    }
  }
  handle.close();
  console.log(`\n${formatQualityReport(qualityReport(scores), costMinor)}\n`);
}

if (isEntryPoint(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
