import {
  roundHalfAwayFromZero,
  type AccountDto,
  type AllocationClass,
  type Frequency,
  type RecurringRuleDto,
} from '@fineapp/shared';

/**
 * Czyste reguły ekranu pozycji cyklicznych
 * ([06 §3.9](../../../../../plans/06-ui-views.md#39-pozycje-cykliczne--recurring), `F4-5`):
 * grupy, miesięczne odpowiedniki kwot i opisy terminarza. Bez Reacta — testowane wprost.
 */

/** Grupa na ekranie. */
export type RecurringGroupKey = 'fixed' | 'expense' | 'saving' | 'transfer' | 'income' | 'paused';

/** Kolejność grup: od tego, co trzeba zapłacić, przez odkładanie, do wpływów. */
export const RECURRING_GROUP_ORDER: readonly RecurringGroupKey[] = [
  'fixed',
  'expense',
  'saving',
  'transfer',
  'income',
  'paused',
];

/** Nagłówek grupy. */
export const RECURRING_GROUP_LABEL: Readonly<Record<RecurringGroupKey, string>> = {
  fixed: 'Wydatki stałe',
  expense: 'Inne wydatki',
  saving: 'Odkładanie',
  transfer: 'Przelewy',
  income: 'Wpływy',
  paused: 'Wstrzymane',
};

/** Pule, do których przelew „odkłada". */
const SAVING_CLASSES: ReadonlySet<AllocationClass> = new Set(['savings', 'investment']);

/**
 * Czy przelew odkłada pieniądze — na konto oszczędnościowe albo inwestycyjne, albo
 * z nadpisaniem alokacji na te pule (06 §3.9: „Odkładanie" realizuje wymaganie #9).
 *
 * @param rule - Reguła.
 * @param classes - Klasy kont po identyfikatorze.
 * @returns `true` dla przelewu liczonego do oszczędności lub inwestycji.
 */
export function isSavingTransfer(
  rule: Pick<RecurringRuleDto, 'flow' | 'counterAccountId' | 'allocationOverride'>,
  classes: ReadonlyMap<string, AllocationClass>,
): boolean {
  if (rule.flow !== 'transfer' || rule.allocationOverride === 'none') return false;
  if (rule.allocationOverride !== null) return true;
  const target = rule.counterAccountId === null ? undefined : classes.get(rule.counterAccountId);
  return target !== undefined && SAVING_CLASSES.has(target);
}

/**
 * Grupa reguły. Wstrzymana trafia do „Wstrzymane" niezależnie od rodzaju — przełącznik
 * `○` ma być w jednym miejscu, a nie rozsiany po grupach.
 *
 * @param rule - Reguła.
 * @param classes - Klasy kont po identyfikatorze.
 * @returns Klucz grupy.
 */
export function groupOf(
  rule: RecurringRuleDto,
  classes: ReadonlyMap<string, AllocationClass>,
): RecurringGroupKey {
  if (!rule.isActive) return 'paused';
  if (rule.flow === 'income') return 'income';
  if (rule.flow === 'expense') return rule.isFixedExpense ? 'fixed' : 'expense';
  return isSavingTransfer(rule, classes) ? 'saving' : 'transfer';
}

/**
 * Miesięczny odpowiednik kwoty reguły — do sum „Miesięcznie".
 *
 * Tydzień to 52/12 wystąpienia w miesiącu, dwa tygodnie — 26/12; reguły rzadsze niż
 * miesięczne dzielą kwotę przez odstęp. To średnia do porównania z budżetem, nie plan
 * konkretnego miesiąca (ten liczą wystąpienia) — dlatego zaokrąglenie per reguła,
 * połówka od zera, jak w całej aplikacji (07 §8.3).
 *
 * @param rule - Kwota i terminarz reguły.
 * @returns Grosze na miesiąc.
 */
export function monthlyEquivalentMinor(
  rule: Pick<RecurringRuleDto, 'amountMinor' | 'frequency' | 'intervalCount'>,
): number {
  const perMonth: Readonly<Record<Frequency, number>> = {
    monthly: 1,
    every_n_months: 1 / Math.max(1, rule.intervalCount),
    quarterly: 1 / 3,
    yearly: 1 / 12,
    weekly: 52 / 12,
    biweekly: 26 / 12,
  };
  return roundHalfAwayFromZero(rule.amountMinor * perMonth[rule.frequency]);
}

/** Grupa reguł z sumą. */
export interface RecurringGroup {
  readonly key: RecurringGroupKey;
  readonly label: string;
  /** Suma miesięcznych odpowiedników; dla wstrzymanych — `null` (nic nie płacą). */
  readonly monthlyMinor: number | null;
  readonly rules: readonly RecurringRuleDto[];
}

/**
 * Grupuje reguły; puste grupy są pomijane. Kolejność w grupie — z API (po nazwie).
 *
 * @param rules - Reguły.
 * @param accounts - Konta (klasa konta docelowego przelewu).
 * @returns Niepuste grupy w stałej kolejności.
 */
export function groupRules(
  rules: readonly RecurringRuleDto[],
  accounts: readonly AccountDto[],
): RecurringGroup[] {
  const classes = new Map(accounts.map((account) => [account.id, account.allocationClass]));
  return RECURRING_GROUP_ORDER.map((key) => {
    const members = rules.filter((rule) => groupOf(rule, classes) === key);
    return {
      key,
      label: RECURRING_GROUP_LABEL[key],
      monthlyMinor:
        key === 'paused'
          ? null
          : members.reduce((sum, rule) => sum + monthlyEquivalentMinor(rule), 0),
      rules: members,
    };
  }).filter((group) => group.rules.length > 0);
}

/** Podsumowanie „Miesięcznie" nad listą. */
export interface MonthlySummary {
  readonly expenseMinor: number;
  readonly incomeMinor: number;
  readonly savingMinor: number;
  /** Czy któraś aktywna reguła nie jest miesięczna — wtedy sumy to średnie. */
  readonly isAverage: boolean;
}

/**
 * Sumy aktywnych reguł w przeliczeniu na miesiąc (06 §3.9): wydatki (stałe i inne),
 * wpływy, odkładanie. Zwykłe przelewy między kontami nie są ani wydatkiem, ani wpływem.
 *
 * @param groups - Grupy z {@link groupRules}.
 * @param rules - Wszystkie reguły.
 * @returns Podsumowanie.
 */
export function monthlySummary(
  groups: readonly RecurringGroup[],
  rules: readonly RecurringRuleDto[],
): MonthlySummary {
  const total = (keys: readonly RecurringGroupKey[]): number =>
    groups
      .filter((group) => keys.includes(group.key))
      .reduce((sum, group) => sum + (group.monthlyMinor ?? 0), 0);
  return {
    expenseMinor: total(['fixed', 'expense']),
    incomeMinor: total(['income']),
    savingMinor: total(['saving']),
    isAverage: rules.some((rule) => rule.isActive && rule.frequency !== 'monthly'),
  };
}

/** Dzień tygodnia w bierniku z przyimkiem: 0 = niedziela. */
const WEEKDAY_ON: readonly string[] = [
  'w niedzielę',
  'w poniedziałek',
  'we wtorek',
  'w środę',
  'w czwartek',
  'w piątek',
  'w sobotę',
];

/** Nazwa dnia tygodnia w mianowniku: 0 = niedziela. */
export const WEEKDAY_NAME: readonly string[] = [
  'niedziela',
  'poniedziałek',
  'wtorek',
  'środa',
  'czwartek',
  'piątek',
  'sobota',
];

/** Miesiąc w dopełniaczu: „15 marca". */
const MONTH_GENITIVE: readonly string[] = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
];

/**
 * Opis terminarza w podpisie wiersza: „10. dnia", „co kwartał, 10. dnia",
 * „co roku, 15 marca", „co tydzień, w poniedziałek".
 *
 * @param rule - Terminarz reguły.
 * @returns Opis po polsku.
 */
export function scheduleLabel(
  rule: Pick<
    RecurringRuleDto,
    'frequency' | 'intervalCount' | 'dayOfMonth' | 'weekday' | 'monthOfYear'
  >,
): string {
  const day = rule.dayOfMonth === null ? '' : `${String(rule.dayOfMonth)}. dnia`;
  const weekday = rule.weekday === null ? '' : (WEEKDAY_ON[rule.weekday] ?? '');
  switch (rule.frequency) {
    case 'monthly':
      return day;
    case 'quarterly':
      return `co kwartał, ${day}`;
    case 'every_n_months':
      return `co ${String(rule.intervalCount)} mies., ${day}`;
    case 'yearly': {
      const month = rule.monthOfYear === null ? '' : (MONTH_GENITIVE[rule.monthOfYear - 1] ?? '');
      return `co roku, ${String(rule.dayOfMonth ?? '')} ${month}`;
    }
    case 'weekly':
      return `co tydzień, ${weekday}`;
    case 'biweekly':
      return `co 2 tygodnie, ${weekday}`;
  }
}
