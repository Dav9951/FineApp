import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ApiErrorCodeSchema,
  ApiErrorDetailSchema,
  ApiErrorSchema,
  apiResponse,
  CursorPaginationSchema,
  HealthSchema,
  PaginationMetaSchema,
} from './envelope.js';

describe('apiResponse', () => {
  it('opakowuje dane w klucz `data`', () => {
    const schema = apiResponse(z.object({ id: z.string() }));
    expect(schema.parse({ data: { id: 'x' } })).toEqual({ data: { id: 'x' } });
  });

  it('odrzuca odpowiedź bez koperty', () => {
    const schema = apiResponse(z.object({ id: z.string() }));
    expect(schema.safeParse({ id: 'x' }).success).toBe(false);
  });

  it('dokłada `meta`, gdy podano jej schemat', () => {
    const schema = apiResponse(z.array(z.string()), PaginationMetaSchema);
    const value = { data: ['a'], meta: { nextCursor: null, hasMore: false } };
    expect(schema.parse(value)).toEqual(value);
  });

  it('bez schematu `meta` nie wymaga tego klucza', () => {
    const schema = apiResponse(z.string());
    expect(schema.safeParse({ data: 'x' }).success).toBe(true);
  });
});

describe('ApiErrorSchema', () => {
  it('przyjmuje kontrakt z 04 §3', () => {
    const value = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Kwota musi być większa od zera.',
        details: [{ path: 'amountMinor', message: 'Oczekiwano liczby dodatniej' }],
        requestId: '01JB2X9K7TQW3R5Y7U9I1O3P5A',
      },
    };
    expect(ApiErrorSchema.safeParse(value).success).toBe(true);
  });

  it('`details` jest opcjonalne', () => {
    const value = { error: { code: 'NOT_FOUND', message: 'Nie ma.', requestId: 'r' } };
    expect(ApiErrorSchema.safeParse(value).success).toBe(true);
  });

  it('wymaga requestId — bez niego nie da się odnaleźć wpisu w logu', () => {
    const value = { error: { code: 'NOT_FOUND', message: 'Nie ma.' } };
    expect(ApiErrorSchema.safeParse(value).success).toBe(false);
  });

  it('odrzuca kod spoza kontraktu', () => {
    const value = { error: { code: 'TEAPOT', message: 'x', requestId: 'r' } };
    expect(ApiErrorSchema.safeParse(value).success).toBe(false);
  });

  it('zna komplet dwunastu kodów', () => {
    expect(ApiErrorCodeSchema.options).toHaveLength(12);
    expect(ApiErrorCodeSchema.options).toContain('DOMAIN_RULE_VIOLATION');
    expect(ApiErrorCodeSchema.options).toContain('AI_BUDGET_EXCEEDED');
  });
});

describe('ApiErrorDetailSchema', () => {
  it('wskazuje pole i powód', () => {
    expect(ApiErrorDetailSchema.safeParse({ path: 'amountMinor', message: 'x' }).success).toBe(
      true,
    );
    expect(ApiErrorDetailSchema.safeParse({ path: 'amountMinor' }).success).toBe(false);
  });
});

describe('CursorPaginationSchema', () => {
  it('domyślnie zwraca 50 pozycji', () => {
    expect(CursorPaginationSchema.parse({})).toEqual({ limit: 50 });
  });

  it('przyjmuje limit jako napis z query stringa', () => {
    expect(CursorPaginationSchema.parse({ limit: '25' }).limit).toBe(25);
  });

  it('pilnuje zakresu limitu', () => {
    expect(CursorPaginationSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(CursorPaginationSchema.safeParse({ limit: 201 }).success).toBe(false);
    expect(CursorPaginationSchema.safeParse({ limit: 200 }).success).toBe(true);
  });
});

describe('PaginationMetaSchema', () => {
  it('`nextCursor: null` oznacza koniec listy', () => {
    expect(PaginationMetaSchema.parse({ nextCursor: null, hasMore: false })).toEqual({
      nextCursor: null,
      hasMore: false,
    });
  });

  it('`totalCount` jest opcjonalne', () => {
    const value = { nextCursor: 'c', hasMore: true, totalCount: 120 };
    expect(PaginationMetaSchema.parse(value)).toEqual(value);
  });
});

describe('HealthSchema', () => {
  it('przyjmuje kontrakt z 10 §8', () => {
    const value = { status: 'ok', version: '0.1.0', dbOk: true, uptimeSeconds: 84_321 };
    expect(HealthSchema.safeParse(value).success).toBe(true);
  });

  it('wymaga `dbOk` — kontener bez bazy nie jest zdrowy', () => {
    const value = { status: 'ok', version: '0.1.0', uptimeSeconds: 1 };
    expect(HealthSchema.safeParse(value).success).toBe(false);
  });

  it('nie przyjmuje ujemnego czasu działania', () => {
    const value = { status: 'ok', version: '0.1.0', dbOk: true, uptimeSeconds: -1 };
    expect(HealthSchema.safeParse(value).success).toBe(false);
  });
});
