import { describe, expect, it } from 'vitest';

import type { AccountRow } from '../../db/schema/accounts.js';
import type { AccountFlow } from '../transactions/transactions.ledger.js';
import { accountBalance, buildBalances, resolveBalancePeriod } from './accounts.balances.js';

/**
 * Testy wyliczania sald
 * ([07 §7](../../../../../../plans/07-domain-rules.md#7-salda-kont)).
 */

const PERIOD = { monthStart: '2026-09-01', asOf: '2026-09-30' };

/**
 * Buduje wiersz konta z rozsądnymi wartościami domyślnymi.
 *
 * @param overrides - Nadpisane pola.
 * @returns Wiersz konta.
 */
function account(overrides: Partial<AccountRow>): AccountRow {
  return {
    id: 'A',
    householdId: 'H',
    name: 'ROR',
    type: 'checking',
    allocationClass: 'spending',
    currency: 'PLN',
    openingBalanceMinor: 0,
    openingBalanceOn: '2026-01-01',
    institution: null,
    color: null,
    icon: null,
    includeInNetWorth: true,
    sortOrder: 0,
    isArchived: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/**
 * Buduje mapę ruchów.
 *
 * @param entries - Trójki: konto, ruch przed miesiącem, ruch do `asOf`.
 * @returns Mapa ruchów.
 */
function flows(...entries: [string, number, number][]): Map<string, AccountFlow> {
  return new Map(
    entries.map(([accountId, beforeMonthMinor, throughAsOfMinor]) => [
      accountId,
      { accountId, beforeMonthMinor, throughAsOfMinor },
    ]),
  );
}

describe('resolveBalancePeriod', () => {
  it('miesiąc → od pierwszego do ostatniego dnia', () => {
    expect(resolveBalancePeriod({ month: '2026-09' }, '2026-12-01', 1)).toEqual({
      monthStart: '2026-09-01',
      asOf: '2026-09-30',
    });
  });

  it('luty roku przestępnego kończy się 29.', () => {
    expect(resolveBalancePeriod({ month: '2028-02' }, '2028-03-01', 1).asOf).toBe('2028-02-29');
    expect(resolveBalancePeriod({ month: '2026-02' }, '2026-03-01', 1).asOf).toBe('2026-02-28');
  });

  it('asOf → ruch od początku jego miesiąca', () => {
    expect(resolveBalancePeriod({ asOf: '2026-09-15' }, '2026-12-01', 1)).toEqual({
      monthStart: '2026-09-01',
      asOf: '2026-09-15',
    });
  });

  it('bez parametrów → dziś gospodarstwa', () => {
    expect(resolveBalancePeriod({}, '2026-10-01', 1)).toEqual({
      monthStart: '2026-10-01',
      asOf: '2026-10-01',
    });
  });

  it('respektuje dzień startu miesiąca większy od 1', () => {
    // 20 września przy starcie 26. należy do miesiąca budżetowego sierpnia (07 §1.2).
    expect(resolveBalancePeriod({ asOf: '2026-09-20' }, '2026-12-01', 26).monthStart).toBe(
      '2026-08-26',
    );
  });
});

describe('accountBalance', () => {
  it('saldo = początkowe + ruch; brak ruchu = saldo początkowe', () => {
    expect(accountBalance({ openingBalanceMinor: 10_000 }, undefined)).toEqual({
      atMonthStartMinor: 10_000,
      balanceMinor: 10_000,
    });
    expect(
      accountBalance(
        { openingBalanceMinor: 10_000 },
        { accountId: 'A', beforeMonthMinor: -2_000, throughAsOfMinor: 500 },
      ),
    ).toEqual({ atMonthStartMinor: 8_000, balanceMinor: 10_500 });
  });

  it('dopuszcza saldo ujemne (debet)', () => {
    expect(
      accountBalance(
        { openingBalanceMinor: 0 },
        { accountId: 'A', beforeMonthMinor: 0, throughAsOfMinor: -12_799 },
      ).balanceMinor,
    ).toBe(-12_799);
  });
});

describe('buildBalances', () => {
  it('liczy saldo, stan na początek miesiąca i zmianę', () => {
    const { data } = buildBalances(
      [account({ openingBalanceMinor: 500_000 })],
      flows(['A', 12_000, 343_210]),
      PERIOD,
      0,
    );
    expect(data[0]).toMatchObject({
      balanceMinor: 843_210,
      balanceAtMonthStartMinor: 512_000,
      changeInMonthMinor: 331_210,
    });
  });

  it('saldo początkowe konta założonego w tym miesiącu nie jest zmianą', () => {
    const { data } = buildBalances(
      [account({ openingBalanceMinor: 1_000_000, openingBalanceOn: '2026-09-15' })],
      new Map(),
      PERIOD,
      0,
    );
    expect(data[0]?.changeInMonthMinor).toBe(0);
  });

  it('sumuje per klasa i odejmuje zobowiązania od majątku', () => {
    const { data, meta } = buildBalances(
      [
        account({ id: 'A', openingBalanceMinor: 843_210 }),
        account({ id: 'B', allocationClass: 'savings', openingBalanceMinor: 4_200_000 }),
        account({ id: 'C', allocationClass: 'investment', openingBalanceMinor: 1_800_000 }),
      ],
      new Map(),
      PERIOD,
      3_200_000,
    );
    expect(data).toHaveLength(3);
    expect(meta).toEqual({
      asOf: '2026-09-30',
      totalsByClass: { spending: 843_210, savings: 4_200_000, investment: 1_800_000 },
      netWorthMinor: 3_643_210,
      liabilitiesRemainingMinor: 3_200_000,
    });
  });

  it('konto spoza majątku netto jest w sumie klasy, ale nie w majątku', () => {
    const { meta } = buildBalances(
      [
        account({ id: 'A', openingBalanceMinor: 10_000 }),
        account({ id: 'B', openingBalanceMinor: 5_000, includeInNetWorth: false }),
      ],
      new Map(),
      PERIOD,
      0,
    );
    expect(meta.totalsByClass.spending).toBe(15_000);
    expect(meta.netWorthMinor).toBe(10_000);
  });

  it('pusty zestaw kont daje zera, nie NaN', () => {
    const { data, meta } = buildBalances([], new Map(), PERIOD, 0);
    expect(data).toEqual([]);
    expect(meta.totalsByClass).toEqual({ spending: 0, savings: 0, investment: 0 });
    expect(meta.netWorthMinor).toBe(0);
  });

  it('pomija zarchiwizowane z zerem, zostawia zarchiwizowane z saldem', () => {
    const { data, meta } = buildBalances(
      [
        account({ id: 'A', openingBalanceMinor: 1_000 }),
        account({ id: 'Z', isArchived: true }),
        account({ id: 'S', isArchived: true, openingBalanceMinor: 2_000 }),
      ],
      new Map(),
      PERIOD,
      0,
    );
    expect(data.map((row) => [row.accountId, row.isArchived])).toEqual([
      ['A', false],
      ['S', true],
    ]);
    expect(meta.netWorthMinor).toBe(3_000);
  });

  it('zarchiwizowane opróżnione w tym miesiącu zostaje — zmiana musi być widoczna', () => {
    const { data } = buildBalances(
      [account({ id: 'Z', isArchived: true, openingBalanceMinor: 5_000 })],
      flows(['Z', 0, -5_000]),
      PERIOD,
      0,
    );
    expect(data[0]).toMatchObject({ balanceMinor: 0, changeInMonthMinor: -5_000 });
  });
});
