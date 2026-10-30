import type { AccountBalanceDto, AccountDto, BalancesMeta } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import { archivedOutsideBalances, assetsMinor, groupBalances } from './accounts-view.js';

/**
 * Testy grupowania ekranu kont ([06 §3.7](../../../../../plans/06-ui-views.md#37-konta--accounts)).
 */

/**
 * Saldo konta.
 *
 * @param accountId - Identyfikator.
 * @param overrides - Nadpisane pola.
 * @returns Saldo.
 */
function balance(accountId: string, overrides: Partial<AccountBalanceDto> = {}): AccountBalanceDto {
  return {
    accountId,
    name: accountId,
    type: 'checking',
    allocationClass: 'spending',
    color: null,
    icon: null,
    isArchived: false,
    balanceMinor: 100,
    balanceAtMonthStartMinor: 100,
    changeInMonthMinor: 0,
    ...overrides,
  };
}

const META: BalancesMeta = {
  asOf: '2026-09-23',
  totalsByClass: { spending: 300, savings: 5_000, investment: 0 },
  netWorthMinor: 4_300,
  liabilitiesRemainingMinor: 1_000,
};

describe('groupBalances', () => {
  it('grupuje po puli, nie po rodzaju, w stałej kolejności i bez pustych grup', () => {
    const cushion = balance('Poduszka', { type: 'checking', allocationClass: 'savings' });
    const groups = groupBalances(
      [cushion, balance('ROR'), balance('Gotówka', { type: 'cash' })],
      META,
    );
    expect(groups.map((group) => [group.label, group.totalMinor, group.accounts.length])).toEqual([
      ['Na bieżące wydatki', 300, 2],
      ['Oszczędności', 5_000, 1],
    ]);
    expect(groups[1]?.accounts[0]?.name).toBe('Poduszka');
  });

  it('brak kont — brak grup', () => {
    expect(groupBalances([], META)).toEqual([]);
  });
});

describe('archivedOutsideBalances', () => {
  it('zwraca tylko zarchiwizowane, których nie ma wśród sald', () => {
    const account = (id: string, isArchived: boolean): AccountDto =>
      ({ id, isArchived }) as AccountDto;
    const result = archivedOutsideBalances(
      [account('A', false), account('B', true), account('C', true)],
      [balance('A'), balance('C', { isArchived: true })],
    );
    expect(result.map((item) => item.id)).toEqual(['B']);
  });
});

describe('assetsMinor', () => {
  it('to majątek netto plus pozostałe zobowiązania', () => {
    expect(assetsMinor(META)).toBe(5_300);
  });
});
