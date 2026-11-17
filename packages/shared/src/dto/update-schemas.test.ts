import { describe, expect, it } from 'vitest';

import * as shared from '../index.js';

/**
 * Od Zod 4 `.partial()` nie wyłącza `default` (ADR-089): pole z wartością domyślną
 * w schemacie tworzenia wracałoby do niej przy każdym `PATCH`, który go pomija.
 * Każdy schemat `Update…RequestSchema` przepuszcza więc puste ciało bez dopisywania pól.
 * Wyjątek to schematy z polami wymaganymi — te zastępują całość, nie są częściowe.
 */
const FULL_REPLACEMENT = new Set([
  'UpdateAiModelRequestSchema',
  'UpdateBudgetGroupRequestSchema',
  'UpdateBudgetLayoutRequestSchema',
]);

const updateSchemas = Object.entries(shared).filter(
  ([name, value]) =>
    /^Update\w+RequestSchema$/.test(name) &&
    !FULL_REPLACEMENT.has(name) &&
    typeof (value as { safeParse?: unknown }).safeParse === 'function',
) as [string, { safeParse: (input: unknown) => { success: boolean; data?: unknown } }][];

describe('schematy Update…RequestSchema', () => {
  it('są wykrywane', () => {
    expect(updateSchemas.length).toBeGreaterThan(5);
  });

  it.each(updateSchemas)('%s nie dopisuje wartości domyślnych do pustego ciała', (_, schema) => {
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({});
  });
});
