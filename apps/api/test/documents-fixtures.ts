import sharp from 'sharp';

import type {
  DocumentExtractor,
  ExtractedHeader,
  ExtractedItem,
  ExtractInput,
  ExtractResult,
} from '../src/ai/document-extractor.js';

/**
 * Dane testowe dokumentów: treść `multipart`, pliki, atrapa ekstraktora.
 *
 * Żaden test nie woła prawdziwej usługi AI — atrapa odtwarza zaprogramowane wyniki
 * i zapamiętuje wejście, żeby dało się sprawdzić, co poszłoby do modelu.
 */

/**
 * Buduje minimalny PDF z drzewem stron o podanej liczbie stron.
 *
 * @param pages - Liczba stron.
 * @returns Zawartość pliku.
 */
export function tinyPdf(pages: number): Buffer {
  const kids = Array.from({ length: pages }, (_, index) => `${String(index + 3)} 0 R`).join(' ');
  const pageObjects = Array.from(
    { length: pages },
    (_, index) => `${String(index + 3)} 0 obj << /Type /Page /Parent 2 0 R >> endobj`,
  ).join('\n');
  return Buffer.from(
    `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [${kids}] /Count ${String(pages)} >> endobj\n${pageObjects}\n%%EOF\n`,
    'latin1',
  );
}

/**
 * Zdjęcie paragonu: JPEG z EXIF-em (producent, GPS).
 *
 * @param seed - Kolor tła — różne ziarno daje inny plik (inny SHA-256).
 * @returns Zawartość pliku.
 */
export async function receiptPhoto(seed = '#ffffff'): Promise<Buffer> {
  return sharp({ create: { width: 60, height: 120, channels: 3, background: seed } })
    .jpeg()
    .withExif({ IFD0: { Make: 'Telefon' }, IFD3: { GPSLatitudeRef: 'N' } })
    .toBuffer();
}

/** Plik w treści `multipart`. */
export interface MultipartFile {
  readonly field?: string;
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Buffer;
}

/**
 * Składa treść `multipart/form-data` dla `app.inject()`.
 *
 * @param fields - Pola tekstowe.
 * @param file - Plik albo `null`.
 * @returns Treść i nagłówek `content-type`.
 */
export function multipart(
  fields: Readonly<Record<string, string>>,
  file: MultipartFile | null,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----fineapp-test-boundary';
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  if (file !== null) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field ?? 'file'}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.bytes,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** Nagłówek bez wartości — do wypełnienia w teście. */
export const EMPTY_HEADER: ExtractedHeader = {
  merchant: null,
  bookedOn: null,
  totalMinor: null,
  currency: 'PLN',
  confidence: null,
  notes: null,
  accountHint: null,
  periodFrom: null,
  periodTo: null,
};

/**
 * Pozycja odczytu z wartościami domyślnymi.
 *
 * @param overrides - Nadpisane pola.
 * @returns Pozycja.
 */
export function extractedItem(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    description: 'Pozycja',
    quantity: null,
    unitPriceMinor: null,
    amountMinor: 1000,
    direction: 'outflow',
    bookedOn: null,
    counterparty: null,
    categoryId: null,
    suggestedCategoryName: null,
    confidence: 0.9,
    ...overrides,
  };
}

/** Krok atrapy: wynik albo błąd do rzucenia. */
export type FakeStep =
  | { readonly header?: Partial<ExtractedHeader>; readonly items: readonly ExtractedItem[] }
  | { readonly error: Error };

/** Atrapa ekstraktora z historią wywołań. */
export interface FakeExtractor extends DocumentExtractor {
  readonly calls: ExtractInput[];
  /** Dokłada kolejny zaprogramowany wynik. */
  push(step: FakeStep): void;
}

/**
 * Tworzy atrapę ekstraktora — kolejne wywołania biorą kolejne kroki.
 *
 * @returns Atrapa.
 */
export function fakeExtractor(): FakeExtractor {
  const steps: FakeStep[] = [];
  const calls: ExtractInput[] = [];
  return {
    provider: 'fake',
    model: 'fake-model',
    calls,
    push(step) {
      steps.push(step);
    },
    extract(input): Promise<ExtractResult> {
      calls.push(input);
      const step = steps.shift() ?? { items: [] };
      if ('error' in step) return Promise.reject(step.error);
      return Promise.resolve({
        header: { ...EMPTY_HEADER, ...step.header },
        items: [...step.items],
        usage: { inputTokens: 2000, outputTokens: 500 },
        provider: 'fake',
        model: 'fake-model',
        requestId: 'req_test',
        rawResponse: '{}',
      });
    },
  };
}
