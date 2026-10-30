import { describe, expect, it } from 'vitest';

import {
  EXPORT_TABLES,
  ExportCsvQuerySchema,
  ExportDtoSchema,
  exportFileName,
  isValidTimeZone,
  ResetDataRequestSchema,
  ResetDataResultSchema,
  UpdateHouseholdRequestSchema,
  UpdateProfileRequestSchema,
} from './settings.js';

/**
 * Testy kontraktów ustawień
 * ([05 §13a](../../../../plans/05-dto-contracts.md#13a-ustawienia--dtosettingsts)).
 */

const ID = '01J9ZQK8WQ0000000000000000';

/** Wynik `safeParse` w zakresie potrzebnym testom. */
interface ParseResult {
  success: boolean;
  error?: { issues: { message: string }[] };
}

/**
 * Pierwszy komunikat błędu walidacji.
 *
 * @param result - Wynik `safeParse`.
 * @returns Komunikat albo pusty napis przy sukcesie.
 */
function firstMessage(result: ParseResult): string {
  return result.success ? '' : (result.error?.issues[0]?.message ?? '');
}

describe('isValidTimeZone', () => {
  it('przyjmuje strefy IANA', () => {
    for (const zone of ['Europe/Warsaw', 'UTC', 'America/New_York', 'Asia/Tokyo']) {
      expect(isValidTimeZone(zone)).toBe(true);
    }
  });

  it('odrzuca nieznane i puste', () => {
    for (const zone of ['', 'Europe/Gdansk', 'Warszawa', 'GMT+99']) {
      expect(isValidTimeZone(zone)).toBe(false);
    }
  });
});

describe('UpdateHouseholdRequestSchema', () => {
  it('każde pole jest opcjonalne', () => {
    expect(UpdateHouseholdRequestSchema.parse({})).toEqual({});
  });

  it('przycina nazwę i odrzuca pustą', () => {
    expect(UpdateHouseholdRequestSchema.parse({ name: '  Dom  ' })).toEqual({ name: 'Dom' });
    expect(firstMessage(UpdateHouseholdRequestSchema.safeParse({ name: '   ' }))).toBe(
      'Nazwa jest wymagana',
    );
  });

  it('limit wstecz od 0 do 12', () => {
    expect(UpdateHouseholdRequestSchema.safeParse({ backPostingLimitMonths: 0 }).success).toBe(
      true,
    );
    expect(UpdateHouseholdRequestSchema.safeParse({ backPostingLimitMonths: 12 }).success).toBe(
      true,
    );
    expect(
      firstMessage(UpdateHouseholdRequestSchema.safeParse({ backPostingLimitMonths: 13 })),
    ).toBe('Limit może wynosić najwyżej 12 miesięcy');
    expect(UpdateHouseholdRequestSchema.safeParse({ backPostingLimitMonths: -1 }).success).toBe(
      false,
    );
    expect(UpdateHouseholdRequestSchema.safeParse({ backPostingLimitMonths: 1.5 }).success).toBe(
      false,
    );
  });

  it('strefa czasowa musi być znana', () => {
    expect(UpdateHouseholdRequestSchema.parse({ timezone: 'Europe/London' })).toEqual({
      timezone: 'Europe/London',
    });
    expect(firstMessage(UpdateHouseholdRequestSchema.safeParse({ timezone: 'Mars/Olympus' }))).toBe(
      'Nieznana strefa czasowa',
    );
  });

  it('dzień startu miesiąca tylko 1 (ADR-006)', () => {
    expect(UpdateHouseholdRequestSchema.safeParse({ monthStartDay: 1 }).success).toBe(true);
    expect(firstMessage(UpdateHouseholdRequestSchema.safeParse({ monthStartDay: 26 }))).toBe(
      'W tej wersji miesiąc zaczyna się zawsze 1. dnia',
    );
  });

  it('pomija pola spoza kontraktu (waluta, język)', () => {
    expect(UpdateHouseholdRequestSchema.parse({ baseCurrency: 'EUR', locale: 'en-US' })).toEqual(
      {},
    );
  });
});

describe('UpdateProfileRequestSchema', () => {
  it('przyjmuje nazwę i kolor', () => {
    expect(
      UpdateProfileRequestSchema.parse({ displayName: ' Ania ', avatarColor: '#7A5AF8' }),
    ).toEqual({ displayName: 'Ania', avatarColor: '#7A5AF8' });
  });

  it('kolor `null` przywraca domyślny', () => {
    expect(UpdateProfileRequestSchema.parse({ avatarColor: null })).toEqual({ avatarColor: null });
  });

  it('odrzuca kolor spoza formatu i zbyt długą nazwę', () => {
    expect(UpdateProfileRequestSchema.safeParse({ avatarColor: 'red' }).success).toBe(false);
    expect(UpdateProfileRequestSchema.safeParse({ displayName: 'x'.repeat(41) }).success).toBe(
      false,
    );
  });
});

describe('ExportDtoSchema', () => {
  it('przyjmuje plik z kompletem tabel', () => {
    const tables = Object.fromEntries(EXPORT_TABLES.map((table) => [table, []]));
    const result = ExportDtoSchema.safeParse({
      format: 'fineapp-export',
      version: 1,
      exportedAt: 1,
      appVersion: '1.0.0',
      household: {
        id: ID,
        name: 'Dom',
        baseCurrency: 'PLN',
        timezone: 'Europe/Warsaw',
        locale: 'pl-PL',
        backPostingLimitMonths: 1,
        monthStartDay: 1,
        defaultExpenseAccountId: null,
      },
      users: [
        {
          id: ID,
          email: 'a@example.com',
          displayName: 'A',
          avatarColor: null,
          isActive: true,
          createdAt: 1,
        },
      ],
      tables: { ...tables, accounts: [{ id: ID, name: 'Konto' }] },
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca plik bez tabeli', () => {
    const tables = Object.fromEntries(
      EXPORT_TABLES.filter((table) => table !== 'transactions').map((table) => [table, []]),
    );
    expect(
      ExportDtoSchema.shape.tables.safeParse(tables).success,
      'brak transakcji to niekompletny eksport',
    ).toBe(false);
  });

  it('transakcje są ostatnie — po wszystkim, do czego się odwołują', () => {
    expect(EXPORT_TABLES.at(-1)).toBe('transactions');
    expect(EXPORT_TABLES.indexOf('documents')).toBeLessThan(EXPORT_TABLES.indexOf('documentItems'));
  });

  it('linie szkicu budżetu idą po szkicach i po źródłach, na które wskazują', () => {
    const at = (table: (typeof EXPORT_TABLES)[number]): number => EXPORT_TABLES.indexOf(table);
    expect(at('budgetDrafts')).toBeLessThan(at('budgetDraftLines'));
    for (const source of [
      'categories',
      'incomeSources',
      'goals',
      'liabilities',
      'recurringRules',
      'plannedExpenses',
    ] as const) {
      expect(at(source)).toBeLessThan(at('budgetDraftLines'));
    }
  });
});

describe('ExportCsvQuerySchema', () => {
  it('miesiąc opcjonalny, ale poprawny', () => {
    expect(ExportCsvQuerySchema.parse({})).toEqual({});
    expect(ExportCsvQuerySchema.parse({ month: '2026-09' })).toEqual({ month: '2026-09' });
    expect(ExportCsvQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false);
  });
});

describe('exportFileName', () => {
  it('składa nazwę z datą albo miesiącem', () => {
    expect(exportFileName('json', '2026-09-25')).toBe('fineapp-2026-09-25.json');
    expect(exportFileName('csv', '2026-09')).toBe('fineapp-2026-09.csv');
  });
});

describe('ResetDataRequestSchema', () => {
  it('wymaga PIN-u w formacie logowania', () => {
    expect(ResetDataRequestSchema.safeParse({ pin: '482915' }).success).toBe(true);
    expect(firstMessage(ResetDataRequestSchema.safeParse({ pin: '12' }))).toBe(
      'PIN musi mieć od 6 do 8 cyfr',
    );
    expect(ResetDataRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('ResetDataResultSchema', () => {
  it('liczy usunięte wiersze w każdej tabeli eksportu', () => {
    const deleted = Object.fromEntries(EXPORT_TABLES.map((table) => [table, 0]));
    expect(ResetDataResultSchema.safeParse({ deleted }).success).toBe(true);
    expect(
      ResetDataResultSchema.safeParse({ deleted: { ...deleted, transactions: -1 } }).success,
    ).toBe(false);
  });
});
