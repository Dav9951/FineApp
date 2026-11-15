import { describe, expect, it } from 'vitest';

import { AI_MODELS, AiModelIdSchema, findAiModel } from './ai-models.js';

/** Katalog modeli odczytu (ADR-085). */
describe('AI_MODELS', () => {
  it('każdy model z katalogu przechodzi przez schemat i odwrotnie', () => {
    expect(AI_MODELS.map((option) => option.id)).toEqual(AiModelIdSchema.options);
  });

  it('Haiku jest tańszy od Sonneta w obu stawkach', () => {
    const haiku = findAiModel('claude-haiku-5-5');
    const sonnet = findAiModel('claude-sonnet-5-5');
    expect(haiku?.inputCostMinorPerMTok).toBeLessThan(sonnet?.inputCostMinorPerMTok ?? 0);
    expect(haiku?.outputCostMinorPerMTok).toBeLessThan(sonnet?.outputCostMinorPerMTok ?? 0);
  });

  it('model spoza katalogu: brak opisu, schemat odrzuca z polskim komunikatem', () => {
    expect(findAiModel('claude-opus-5-5')).toBeUndefined();
    const parsed = AiModelIdSchema.safeParse('claude-opus-5-5');
    expect(parsed.success ? null : parsed.error.issues[0]?.message).toBe('Nieznany model AI');
  });
});
