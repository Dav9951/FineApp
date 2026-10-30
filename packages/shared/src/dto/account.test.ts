import { describe, expect, it } from 'vitest';

import {
  AccountBalanceDtoSchema,
  AccountDetailDtoSchema,
  AccountDtoSchema,
  BalancesMetaSchema,
  BalancesQuerySchema,
  CreateAccountRequestSchema,
  ListAccountsQuerySchema,
  ReorderAccountsRequestSchema,
  UpdateAccountRequestSchema,
} from './account.js';

/**
 * Testy kontraktów kont
 * ([05 §5](../../../../plans/05-dto-contracts.md#5-konta--dtoaccountdtots)).
 */

/** Poprawne identyfikatory ULID do wypełniania przykładów. */
const ID = '01J9ZQK8WQ0000000000000000';
const ID2 = '01J9ZQK8WQ0000000000000001';

describe('CreateAccountRequestSchema', () => {
  it('przyjmuje przykład z 04 §5', () => {
    const parsed = CreateAccountRequestSchema.parse({
      name: 'Konto mieszkaniowe',
      type: 'savings',
      allocationClass: 'savings',
      openingBalanceMinor: 1_250_000,
      openingBalanceOn: '2026-09-01',
      institution: 'mBank',
      color: '#22c55e',
      icon: 'piggy-bank',
      includeInNetWorth: true,
    });
    expect(parsed.openingBalanceMinor).toBe(1_250_000);
  });

  it('uzupełnia wartości domyślne i nie wymyśla klasy', () => {
    const parsed = CreateAccountRequestSchema.parse({
      name: '  ROR  ',
      type: 'checking',
      openingBalanceOn: '2026-09-01',
    });
    expect(parsed).toEqual({
      name: 'ROR',
      type: 'checking',
      openingBalanceMinor: 0,
      openingBalanceOn: '2026-09-01',
      includeInNetWorth: true,
    });
    // Klasę uzupełnia serwis z `type` — kontrakt jej nie zgaduje.
    expect(parsed.allocationClass).toBeUndefined();
  });

  it('dopuszcza ujemne saldo początkowe (debet)', () => {
    const result = CreateAccountRequestSchema.safeParse({
      name: 'Karta',
      type: 'other',
      openingBalanceMinor: -50_000,
      openingBalanceOn: '2026-09-01',
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca pustą nazwę, ułamek grosza i nieistniejącą datę', () => {
    const result = CreateAccountRequestSchema.safeParse({
      name: '   ',
      type: 'checking',
      openingBalanceMinor: 10.5,
      openingBalanceOn: '2026-02-30',
    });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(
      expect.arrayContaining(['name', 'openingBalanceMinor', 'openingBalanceOn']),
    );
  });
});

describe('UpdateAccountRequestSchema', () => {
  it('nie wstawia wartości domyślnych do pominiętych pól', () => {
    expect(UpdateAccountRequestSchema.parse({ name: 'Nowa' })).toEqual({ name: 'Nowa' });
  });

  it('przyjmuje null jako wyczyszczenie pola', () => {
    expect(UpdateAccountRequestSchema.parse({ institution: null })).toEqual({ institution: null });
  });
});

describe('ListAccountsQuerySchema', () => {
  it('domyślnie pomija zarchiwizowane', () => {
    expect(ListAccountsQuerySchema.parse({})).toEqual({ includeArchived: false });
  });

  it('czyta "false" jako fałsz, a nie jako niepusty napis', () => {
    expect(ListAccountsQuerySchema.parse({ includeArchived: 'false' }).includeArchived).toBe(false);
    expect(ListAccountsQuerySchema.parse({ includeArchived: 'true' }).includeArchived).toBe(true);
  });

  it('odrzuca inne wartości', () => {
    expect(ListAccountsQuerySchema.safeParse({ includeArchived: '1' }).success).toBe(false);
  });
});

describe('ReorderAccountsRequestSchema', () => {
  it('przyjmuje listę unikalnych identyfikatorów', () => {
    expect(ReorderAccountsRequestSchema.parse({ ids: [ID, ID2] }).ids).toEqual([ID, ID2]);
  });

  it('odrzuca pustą listę i powtórzenia', () => {
    expect(ReorderAccountsRequestSchema.safeParse({ ids: [] }).success).toBe(false);
    const duplicated = ReorderAccountsRequestSchema.safeParse({ ids: [ID, ID] });
    expect(duplicated.success).toBe(false);
    expect(duplicated.success ? '' : duplicated.error.issues[0]?.message).toBe(
      'Konto występuje na liście więcej niż raz',
    );
  });
});

describe('schematy odpowiedzi', () => {
  it('AccountDtoSchema przyjmuje pełne konto', () => {
    const result = AccountDtoSchema.safeParse({
      id: ID,
      name: 'ROR',
      type: 'checking',
      allocationClass: 'spending',
      currency: 'PLN',
      openingBalanceMinor: 0,
      openingBalanceOn: '2026-09-01',
      institution: null,
      color: null,
      icon: null,
      includeInNetWorth: true,
      sortOrder: 0,
      isArchived: false,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(result.success).toBe(true);
  });

  it('salda przyjmują przykład z 04 §5', () => {
    expect(
      AccountBalanceDtoSchema.safeParse({
        accountId: ID,
        name: 'ROR',
        type: 'checking',
        allocationClass: 'spending',
        color: null,
        icon: null,
        isArchived: false,
        balanceMinor: 843_210,
        balanceAtMonthStartMinor: 512_000,
        changeInMonthMinor: 331_210,
      }).success,
    ).toBe(true);
    expect(
      BalancesMetaSchema.safeParse({
        asOf: '2026-09-30',
        totalsByClass: { spending: 843_210, savings: 4_200_000, investment: 1_800_000 },
        netWorthMinor: 6_843_210,
        liabilitiesRemainingMinor: 3_200_000,
      }).success,
    ).toBe(true);
  });
});

describe('BalancesQuerySchema', () => {
  it('przyjmuje asOf, month albo nic', () => {
    expect(BalancesQuerySchema.parse({})).toEqual({});
    expect(BalancesQuerySchema.parse({ asOf: '2026-09-15' })).toEqual({ asOf: '2026-09-15' });
    expect(BalancesQuerySchema.parse({ month: '2026-09' })).toEqual({ month: '2026-09' });
  });

  it('odrzuca oba naraz, ze ścieżką pola', () => {
    const result = BalancesQuerySchema.safeParse({ asOf: '2026-09-15', month: '2026-09' });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues[0]?.path).toEqual(['month']);
  });

  it('odrzuca nieistniejącą datę i zły miesiąc', () => {
    expect(BalancesQuerySchema.safeParse({ asOf: '2026-02-29' }).success).toBe(false);
    expect(BalancesQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false);
  });
});

describe('AccountDetailDtoSchema', () => {
  it('to konto z saldem i dniem, na który je policzono', () => {
    const result = AccountDetailDtoSchema.safeParse({
      id: ID,
      name: 'ROR',
      type: 'checking',
      allocationClass: 'spending',
      currency: 'PLN',
      openingBalanceMinor: 0,
      openingBalanceOn: '2026-09-01',
      institution: null,
      color: null,
      icon: null,
      includeInNetWorth: true,
      sortOrder: 0,
      isArchived: false,
      createdAt: 1,
      updatedAt: 1,
      balanceMinor: -1_500,
      balanceAsOf: '2026-09-23',
    });
    expect(result.success).toBe(true);
  });
});
