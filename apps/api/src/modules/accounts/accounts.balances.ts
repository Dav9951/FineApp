import {
  monthKeyOf,
  monthRange,
  type AccountBalanceDto,
  type AllocationClass,
  type BalancesMeta,
  type BalancesQuery,
} from '@fineapp/shared';

import type { AccountRow } from '../../db/schema/accounts.js';
import type { AccountFlow } from '../transactions/transactions.ledger.js';

/**
 * Wyliczanie sald kont i majątku netto — zadanie `F2-2`
 * ([07 §7](../../../../../../plans/07-domain-rules.md#7-salda-kont)).
 *
 * Czyste funkcje bez dostępu do bazy: dostają wiersze kont i zsumowane ruchy, oddają
 * DTO. Salda **nie są materializowane** (03 §3.5) — liczymy je przy każdym odczycie.
 */

/** Okres, dla którego liczymy salda. */
export interface BalancePeriod {
  /** Pierwszy dzień miesiąca budżetowego — saldo „na początek miesiąca" jest sprzed niego. */
  readonly monthStart: string;
  /** Dzień, na który liczymy saldo (włącznie). */
  readonly asOf: string;
}

/**
 * Wyznacza okres sald z parametrów zapytania.
 *
 * - `month` → saldo na **ostatni** dzień miesiąca budżetowego, bo tak czyta się
 *   podsumowanie zamkniętego miesiąca („ile było na koniec września");
 * - `asOf` → saldo na ten dzień, a ruch od początku **jego** miesiąca;
 * - nic → dziś w strefie gospodarstwa.
 *
 * @param query - Zwalidowane parametry (co najwyżej jedno z `asOf` / `month`).
 * @param today - Dzisiejsza data biznesowa gospodarstwa.
 * @param monthStartDay - Dzień rozpoczęcia miesiąca budżetowego.
 * @returns Granice okresu.
 */
export function resolveBalancePeriod(
  query: BalancesQuery,
  today: string,
  monthStartDay: number,
): BalancePeriod {
  if (query.month !== undefined) {
    const range = monthRange(query.month, monthStartDay);
    return { monthStart: range.from, asOf: range.to };
  }
  const asOf = query.asOf ?? today;
  return { monthStart: monthRange(monthKeyOf(asOf, monthStartDay), monthStartDay).from, asOf };
}

/**
 * Saldo jednego konta na koniec okresu i na początek jego miesiąca.
 *
 * Saldo początkowe wchodzi do **obu** wartości, więc nie jest „ruchem w miesiącu" —
 * także wtedy, gdy konto założono w środku tego miesiąca. Inaczej założenie konta
 * z 10 000 zł wyglądałoby na ekranie jak wpływ 10 000 zł.
 *
 * @param account - Wiersz konta.
 * @param flow - Zsumowany ruch; brak znaczy brak transakcji.
 * @returns Saldo na początek miesiąca i na koniec okresu, w groszach.
 */
export function accountBalance(
  account: Pick<AccountRow, 'openingBalanceMinor'>,
  flow: AccountFlow | undefined,
): { atMonthStartMinor: number; balanceMinor: number } {
  return {
    atMonthStartMinor: account.openingBalanceMinor + (flow?.beforeMonthMinor ?? 0),
    balanceMinor: account.openingBalanceMinor + (flow?.throughAsOfMinor ?? 0),
  };
}

/**
 * Składa listę sald i podsumowanie majątku.
 *
 * **Które konta.** Aktywne zawsze. Zarchiwizowane — tylko gdy na początku miesiąca
 * albo na koniec okresu miały niezerowe saldo. Konto zarchiwizowane z zerem nie wnosi
 * do sum nic, więc jego pominięcie niczego nie zmienia; konto zarchiwizowane z saldem
 * musi zostać, bo „nic, co wpływa na liczby w zamkniętych miesiącach, nie znika"
 * (07 §10) — archiwizacja w listopadzie nie może zmienić majątku z marca.
 *
 * **Sumy per klasa** obejmują wszystkie pokazane konta — mają się zgadzać z listą,
 * którą użytkownik widzi pod nagłówkiem klasy. **Majątek netto** liczy wyłącznie
 * konta z `includeInNetWorth` (07 §7) i odejmuje pozostałe zobowiązania.
 *
 * @param accounts - Wszystkie konta gospodarstwa w kolejności wyświetlania.
 * @param flows - Ruchy per konto.
 * @param period - Okres sald.
 * @param liabilitiesRemainingMinor - Suma pozostałych zobowiązań.
 * @returns Salda w kolejności kont i podsumowanie.
 */
export function buildBalances(
  accounts: readonly AccountRow[],
  flows: ReadonlyMap<string, AccountFlow>,
  period: BalancePeriod,
  liabilitiesRemainingMinor: number,
): { data: AccountBalanceDto[]; meta: BalancesMeta } {
  const totalsByClass: Record<AllocationClass, number> = { spending: 0, savings: 0, investment: 0 };
  let assetsMinor = 0;
  const data: AccountBalanceDto[] = [];

  for (const account of accounts) {
    const { atMonthStartMinor, balanceMinor } = accountBalance(account, flows.get(account.id));
    if (account.isArchived && atMonthStartMinor === 0 && balanceMinor === 0) continue;

    totalsByClass[account.allocationClass] += balanceMinor;
    if (account.includeInNetWorth) assetsMinor += balanceMinor;
    data.push({
      accountId: account.id,
      name: account.name,
      type: account.type,
      allocationClass: account.allocationClass,
      color: account.color,
      icon: account.icon,
      isArchived: account.isArchived,
      balanceMinor,
      balanceAtMonthStartMinor: atMonthStartMinor,
      changeInMonthMinor: balanceMinor - atMonthStartMinor,
    });
  }

  return {
    data,
    meta: {
      asOf: period.asOf,
      totalsByClass,
      netWorthMinor: assetsMinor - liabilitiesRemainingMinor,
      liabilitiesRemainingMinor,
    },
  };
}
