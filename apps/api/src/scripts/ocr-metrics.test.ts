import { describe, expect, it } from 'vitest';

import { formatQualityReport } from './evaluate-ocr.js';
import { qualityReport, scoreReceipt, type ReceiptScore } from './ocr-metrics.js';

/**
 * Wskaźniki jakości OCR (08 §15, `F7-11`).
 */

const EXPECTED = {
  totalMinor: 3197,
  bookedOn: '2026-09-18',
  items: [
    { amountMinor: 698, category: 'zakupy' },
    { amountMinor: 2499, category: 'chemia' },
  ],
};

describe('scoreReceipt', () => {
  it('pary po kwocie; pewne pozycje liczą się do trafności kategorii', () => {
    expect(
      scoreReceipt(EXPECTED, {
        totalMinor: 3197,
        bookedOn: '2026-09-18',
        items: [
          { amountMinor: 2499, category: 'zakupy', confidence: 0.9 },
          { amountMinor: 698, category: 'zakupy', confidence: 0.97 },
        ],
      }),
    ).toEqual({
      totalCorrect: true,
      dateCorrect: true,
      confidentItems: 2,
      confidentCorrect: 1,
      expectedItems: 2,
      corrections: 1,
    });
  });

  it('brakująca i nadmiarowa pozycja to korekty; niska pewność poza trafnością', () => {
    expect(
      scoreReceipt(EXPECTED, {
        totalMinor: 3000,
        bookedOn: null,
        items: [
          { amountMinor: 698, category: 'zakupy', confidence: 0.5 },
          { amountMinor: 100, category: null, confidence: 0.9 },
        ],
      }),
    ).toMatchObject({ totalCorrect: false, dateCorrect: false, confidentItems: 0, corrections: 2 });
  });
});

describe('qualityReport', () => {
  const ok: ReceiptScore = {
    totalCorrect: true,
    dateCorrect: true,
    confidentItems: 10,
    confidentCorrect: 9,
    expectedItems: 10,
    corrections: 1,
  };

  it('cele z 08 §15: suma ≥ 95%, data ≥ 90%, kategoria ≥ 85%, korekty ≤ 20%', () => {
    expect(qualityReport(Array.from({ length: 20 }, () => ok))).toMatchObject({
      receipts: 20,
      totalAccuracy: 1,
      categoryAccuracy: 0.9,
      correctionRate: 0.1,
      meetsTargets: true,
    });
    const oneBadTotal = [{ ...ok, totalCorrect: false }, ...Array.from({ length: 9 }, () => ok)];
    expect(qualityReport(oneBadTotal)).toMatchObject({ totalAccuracy: 0.9, meetsTargets: false });
  });

  it('pusty zbiór i brak pozycji — bez dzielenia przez zero', () => {
    expect(qualityReport([])).toMatchObject({
      receipts: 0,
      totalAccuracy: 0,
      categoryAccuracy: null,
      correctionRate: null,
      meetsTargets: false,
    });
  });

  it('tabela do 13-progress.md', () => {
    const text = formatQualityReport(qualityReport([ok]), 42);
    expect(text).toContain('| Trafność kategorii (confidence ≥ 0.8) | ≥ 85% | 90,0% |');
    expect(text).toContain('szacowany koszt: 42 gr');
  });
});
