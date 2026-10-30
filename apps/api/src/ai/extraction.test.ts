import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { createAnthropicExtractor } from './anthropic-extractor.js';
import { estimateCostMinor } from './cost.js';
import type { CategoryContextEntry, ExtractInput } from './document-extractor.js';
import { prepareForVision, VISION_MAX_EDGE_PX } from './prepare-for-vision.js';
import { formatCategoryContext } from './prompts/extraction-prompt.js';
import {
  parseExtraction,
  receiptSchema,
  statementSchema,
  validDateOrNull,
} from './schemas/extraction.js';

/**
 * Testy warstwy AI (`F7-2`…`F7-4`, 08 §3–§9). Żaden test nie woła prawdziwej usługi.
 */

const GROCERIES = '01JC7K00000000000000000001';
const RESTAURANTS = '01JC7K00000000000000000002';
const SALARY = '01JC7K00000000000000000003';

const CATEGORIES: CategoryContextEntry[] = [
  { id: GROCERIES, path: 'Jedzenie > Zakupy spożywcze', kind: 'expense', hints: 'Biedronka, Lidl' },
  { id: RESTAURANTS, path: 'Jedzenie > Restauracje', kind: 'expense', hints: null },
  { id: SALARY, path: 'Wynagrodzenie', kind: 'income', hints: '' },
];
const KNOWN = new Set([GROCERIES, RESTAURANTS, SALARY]);

/**
 * Poprawna odpowiedź dla paragonu Lidla.
 *
 * @param overrides - Nadpisane pola.
 * @returns JSON odpowiedzi.
 */
function receiptJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    merchant: '  Lidl sp. z o.o. ',
    bookedOn: '2026-09-18',
    totalMinor: 1047,
    currency: 'PLN',
    confidence: 0.94,
    notes: null,
    items: [
      {
        description: 'Mleko 3,2% 1L',
        quantity: 2,
        unitPriceMinor: 349,
        amountMinor: 698,
        direction: 'outflow',
        categoryId: GROCERIES,
        suggestedCategoryName: null,
        confidence: 0.97,
      },
      {
        description: 'Baterie AA',
        quantity: null,
        unitPriceMinor: null,
        amountMinor: 349,
        direction: 'outflow',
        categoryId: null,
        suggestedCategoryName: 'Elektronika',
        confidence: 0.4,
      },
    ],
    ...overrides,
  });
}

describe('schematy structured outputs', () => {
  /**
   * Sprawdza rekurencyjnie wymagania structured outputs: każdy obiekt ma
   * `additionalProperties: false` i wszystkie pola wymagane.
   *
   * @param schema - Węzeł schematu.
   */
  function assertStrict(schema: unknown): void {
    if (typeof schema !== 'object' || schema === null) return;
    const node = schema as Record<string, unknown>;
    if (node.type === 'object') {
      expect(node.additionalProperties).toBe(false);
      expect(node.required).toEqual(Object.keys(node.properties as object));
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(assertStrict);
      else assertStrict(value);
    }
  }

  it('paragon i wyciąg spełniają ograniczenia (bez minimum/maximum)', () => {
    for (const schema of [receiptSchema([GROCERIES]), statementSchema([GROCERIES])]) {
      assertStrict(schema);
      expect(JSON.stringify(schema)).not.toMatch(/"minimum"|"maximum"|"minLength"/u);
    }
  });

  it('categoryId to enum identyfikatorów z listy albo null', () => {
    const properties = receiptSchema([GROCERIES, RESTAURANTS]).properties as Record<
      string,
      { items: { properties: { categoryId: unknown } } }
    >;
    const item = properties.items;
    expect(item?.items.properties.categoryId).toMatchObject({
      anyOf: [{ type: 'string', enum: [GROCERIES, RESTAURANTS] }, { type: 'null' }],
    });
  });
});

describe('parseExtraction', () => {
  it('paragon: przycina teksty, zostawia kategorię z listy i propozycję nowej', () => {
    const result = parseExtraction('receipt', receiptJson(), KNOWN);
    expect(result).toMatchObject({
      ok: true,
      header: { merchant: 'Lidl sp. z o.o.', bookedOn: '2026-09-18', totalMinor: 1047 },
      items: [
        { amountMinor: 698, categoryId: GROCERIES, suggestedCategoryName: null, quantity: 2 },
        { amountMinor: 349, categoryId: null, suggestedCategoryName: 'Elektronika' },
      ],
    });
  });

  it('kategoria spoza listy → null; propozycja przy wybranej kategorii znika', () => {
    const result = parseExtraction(
      'receipt',
      receiptJson({
        items: [
          {
            description: 'Chleb',
            quantity: null,
            unitPriceMinor: null,
            amountMinor: 420,
            direction: 'outflow',
            categoryId: '01JC7K0000000000000000ZZZZ',
            suggestedCategoryName: 'Pieczywo',
            confidence: 0.8,
          },
          {
            description: 'Woda',
            quantity: null,
            unitPriceMinor: null,
            amountMinor: 199,
            direction: 'outflow',
            categoryId: GROCERIES,
            suggestedCategoryName: 'Napoje',
            confidence: 0.9,
          },
        ],
      }),
      KNOWN,
    );
    expect(
      result.ok && result.items.map((item) => [item.categoryId, item.suggestedCategoryName]),
    ).toEqual([
      [null, 'Pieczywo'],
      [GROCERIES, null],
    ]);
  });

  it('kwota ujemna to rabat (odwrócony kierunek), zerowa znika, pewność przycięta', () => {
    const line = (amountMinor: number, confidence: number): Record<string, unknown> => ({
      description: 'x',
      quantity: null,
      unitPriceMinor: null,
      amountMinor,
      direction: 'outflow',
      categoryId: null,
      suggestedCategoryName: null,
      confidence,
    });
    const result = parseExtraction(
      'receipt',
      receiptJson({ items: [line(-150, 1.03), line(0, 0.5)], bookedOn: '2026-02-30' }),
      KNOWN,
    );
    expect(result).toMatchObject({
      ok: true,
      header: { bookedOn: null },
      items: [{ amountMinor: 150, direction: 'inflow', confidence: 1 }],
    });
    expect(result.ok && result.items).toHaveLength(1);
  });

  it('wyciąg: operacje z datami, okres, konto', () => {
    const result = parseExtraction(
      'bank_statement',
      JSON.stringify({
        accountHint: 'mBank 1234',
        periodFrom: '2026-09-01',
        periodTo: '2026-09-30',
        confidence: 0.9,
        notes: '',
        operations: [
          {
            bookedOn: '2026-09-10',
            description: 'Wynagrodzenie',
            counterparty: 'Firma',
            amountMinor: 850_000,
            direction: 'inflow',
            categoryId: SALARY,
            suggestedCategoryName: null,
            confidence: 0.99,
          },
        ],
      }),
      KNOWN,
    );
    expect(result).toMatchObject({
      ok: true,
      header: { accountHint: 'mBank 1234', periodFrom: '2026-09-01', notes: null },
      items: [{ bookedOn: '2026-09-10', direction: 'inflow', counterparty: 'Firma' }],
    });
  });

  it('niepoprawny JSON albo kształt → odrzucenie (AI_SCHEMA_MISMATCH u wołającego)', () => {
    expect(parseExtraction('receipt', '{"merchant":', KNOWN).ok).toBe(false);
    expect(parseExtraction('receipt', JSON.stringify({ merchant: 'x' }), KNOWN).ok).toBe(false);
  });

  it('validDateOrNull odrzuca daty spoza kalendarza', () => {
    expect(validDateOrNull('2028-02-29')).toBe('2028-02-29');
    expect(validDateOrNull('2026-02-29')).toBeNull();
    expect(validDateOrNull('18.09.2026')).toBeNull();
  });
});

describe('formatCategoryContext', () => {
  it('ścieżka i podpowiedzi jak w 08 §4; osobny blok przychodów', () => {
    const text = formatCategoryContext(CATEGORIES);
    expect(text).toContain(
      `DOSTĘPNE KATEGORIE WYDATKÓW:\n${GROCERIES}  Jedzenie > Zakupy spożywcze\n           podpowiedzi: Biedronka, Lidl\n${RESTAURANTS}  Jedzenie > Restauracje`,
    );
    expect(text).toContain(`DOSTĘPNE KATEGORIE PRZYCHODÓW:\n${SALARY}  Wynagrodzenie`);
  });
});

describe('estimateCostMinor', () => {
  it('grosze w górę; paragon to ułamek grosza → 1 gr', () => {
    const rates = { inputCostMinorPerMTok: 800, outputCostMinorPerMTok: 4000 };
    expect(estimateCostMinor({ inputTokens: 2000, outputTokens: 500 }, rates)).toBe(4);
    expect(estimateCostMinor({ inputTokens: 1_000_000, outputTokens: 0 }, rates)).toBe(800);
    expect(estimateCostMinor({ inputTokens: 0, outputTokens: 0 }, rates)).toBe(0);
    expect(estimateCostMinor({ inputTokens: 1, outputTokens: 0 }, rates)).toBe(1);
  });
});

describe('prepareForVision', () => {
  it('skaluje do 1568 px dłuższego boku, bez EXIF-u', async () => {
    const big = await sharp({
      create: { width: 3000, height: 1000, channels: 3, background: '#fff' },
    })
      .jpeg()
      .withExif({ IFD0: { Make: 'Telefon' } })
      .toBuffer();
    const [part] = await prepareForVision(big, 'image/jpeg');
    expect(part?.kind).toBe('image');
    const meta = await sharp(
      Buffer.from(part?.kind === 'image' ? part.base64 : '', 'base64'),
    ).metadata();
    expect([meta.width, meta.height]).toEqual([VISION_MAX_EDGE_PX, 523]);
    expect(meta.exif).toBeUndefined();
  });

  it('małego nie powiększa; PDF idzie w całości', async () => {
    const small = await sharp({
      create: { width: 100, height: 50, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    const [part] = await prepareForVision(small, 'image/jpeg');
    const meta = await sharp(
      Buffer.from(part?.kind === 'image' ? part.base64 : '', 'base64'),
    ).metadata();
    expect(meta.width).toBe(100);
    expect(await prepareForVision(Buffer.from('%PDF-1.4'), 'application/pdf')).toEqual([
      { kind: 'pdf', base64: Buffer.from('%PDF-1.4').toString('base64') },
    ]);
  });
});

describe('createAnthropicExtractor', () => {
  const config = {
    enabled: true,
    apiKey: 'test',
    model: 'claude-sonnet-5',
    maxOutputTokens: 16000,
    monthlyBudgetMinor: 5000,
    inputCostMinorPerMTok: 800,
    outputCostMinorPerMTok: 4000,
  };
  const input: ExtractInput = {
    kind: 'receipt',
    parts: [{ kind: 'image', mediaType: 'image/jpeg', base64: 'AAAA' }],
    categories: CATEGORIES.filter((category) => category.kind === 'expense'),
    timezone: 'Europe/Warsaw',
    currency: 'PLN',
  };

  /**
   * Klient SDK z podmienionym `messages.create`.
   *
   * @param create - Atrapa metody.
   * @returns Klient.
   */
  function fakeClient(create: ReturnType<typeof vi.fn>): Anthropic {
    return { messages: { create } } as unknown as Anthropic;
  }

  /**
   * Odpowiedź Messages API z tekstem.
   *
   * @param text - Treść odpowiedzi.
   * @param stopReason - Powód zakończenia.
   * @returns Odpowiedź.
   */
  function message(text: string, stopReason: string = 'end_turn'): Record<string, unknown> {
    return {
      model: 'claude-sonnet-5',
      stop_reason: stopReason,
      content: [{ type: 'text', text }],
      usage: { input_tokens: 1800, output_tokens: 450, cache_read_input_tokens: 0 },
      _request_id: 'req_1',
    };
  }

  it('wysyła obraz, kontekst i schemat — bez temperature i bez wymuszonego narzędzia', async () => {
    const create = vi.fn().mockResolvedValue(message(receiptJson()));
    const result = await createAnthropicExtractor(config, fakeClient(create)).extract(input);

    const params = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).toMatchObject({ model: 'claude-sonnet-5', max_tokens: 16000 });
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('tool_choice');
    expect(params.output_config).toMatchObject({ format: { type: 'json_schema' } });
    const content = (params.messages as { content: { type: string; text?: string }[] }[])[0]
      ?.content;
    expect(content?.map((block) => block.type)).toEqual(['image', 'text']);
    expect(content?.[1]?.text).toContain(GROCERIES);
    expect(content?.[1]?.text).not.toContain(SALARY);

    expect(result).toMatchObject({
      usage: { inputTokens: 1800, outputTokens: 450 },
      requestId: 'req_1',
      model: 'claude-sonnet-5',
      items: [{ categoryId: GROCERIES }, { suggestedCategoryName: 'Elektronika' }],
    });
  });

  it('PDF jako blok dokumentu', async () => {
    const create = vi.fn().mockResolvedValue(message(receiptJson()));
    await createAnthropicExtractor(config, fakeClient(create)).extract({
      ...input,
      parts: [{ kind: 'pdf', base64: 'JVBERg==' }],
    });
    const params = create.mock.calls[0]?.[0] as { messages: { content: unknown[] }[] };
    expect(params.messages[0]?.content[0]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERg==' },
    });
  });

  it('błędy: usługa → AI_UNAVAILABLE, ucięta → AI_OUTPUT_TRUNCATED, odmowa, zły kształt', async () => {
    const cases: [ReturnType<typeof vi.fn>, string][] = [
      [
        vi
          .fn()
          .mockRejectedValue(new Anthropic.APIError(529, undefined, 'overloaded', new Headers())),
        'AI_UNAVAILABLE',
      ],
      [vi.fn().mockResolvedValue(message('{"merchant":', 'max_tokens')), 'AI_OUTPUT_TRUNCATED'],
      [vi.fn().mockResolvedValue(message('', 'refusal')), 'AI_REFUSED'],
      [vi.fn().mockResolvedValue(message('{"merchant":1}')), 'AI_SCHEMA_MISMATCH'],
    ];
    for (const [create, code] of cases) {
      await expect(
        createAnthropicExtractor(config, fakeClient(create)).extract(input),
      ).rejects.toMatchObject({ code });
    }
  });

  it('błąd walidacji niesie zużycie i surową odpowiedź — nieudany odczyt też kosztuje', async () => {
    const create = vi.fn().mockResolvedValue(message('{"merchant":1}'));
    await expect(
      createAnthropicExtractor(config, fakeClient(create)).extract(input),
    ).rejects.toMatchObject({
      details: { usage: { inputTokens: 1800, outputTokens: 450 }, rawResponse: '{"merchant":1}' },
    });
  });
});
