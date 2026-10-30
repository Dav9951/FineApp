import {
  formatMonth,
  FULL_COVERAGE_BPS,
  type LiquidityWarningDto,
  type MonthKey,
  type PlannedExpenseDto,
  type PlannedExpensePriority,
} from '@fineapp/shared';

import { formatDateShort } from '../../lib/format.js';

/**
 * Czyste reguły ekranu `/planned` i sekcji „Nadchodzące"
 * ([06 §3.10](../../../../../plans/06-ui-views.md#310-planowane-wydatki--planned), `F6-6`,
 * `F6-8`). Bez Reacta.
 */

/** Ważność w słowach — te same w formularzu i na karcie. */
export const PRIORITY_LABEL: Readonly<Record<PlannedExpensePriority, string>> = {
  nice: 'opcjonalne',
  should: 'planowane',
  must: 'konieczne',
};

/** Kolejność opcji ważności w formularzu (06 §3.10). */
export const PRIORITY_ORDER: readonly PlannedExpensePriority[] = ['nice', 'should', 'must'];

/** Grupa ekranu: miesiąc terminu z sumą. */
export interface DueMonthGroup {
  readonly month: MonthKey;
  /** Suma szacunków miesiąca — to ona decyduje o obciążeniu budżetu. */
  readonly totalMinor: number;
  readonly items: readonly PlannedExpenseDto[];
}

/**
 * Grupy po miesiącu terminu, rosnąco — najbliższe u góry (06 §3.10). Wydatki w grupie
 * zostają w kolejności z API (dzień terminu, nazwa).
 *
 * @param items - Aktywne wydatki.
 * @returns Grupy.
 */
export function groupByDueMonth(items: readonly PlannedExpenseDto[]): DueMonthGroup[] {
  const byMonth = new Map<MonthKey, PlannedExpenseDto[]>();
  for (const item of items) {
    const list = byMonth.get(item.dueMonth) ?? [];
    list.push(item);
    byMonth.set(item.dueMonth, list);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => ({
      month,
      totalMinor: list.reduce((sum, item) => sum + item.estimatedAmountMinor, 0),
      items: list,
    }));
}

/**
 * Ile zostało do terminu — słowami.
 *
 * @param monthsUntilDue - Pełne miesiące do terminu (ujemne — zaległy).
 * @returns Np. „za 2 mies.", „w tym miesiącu", „po terminie".
 */
export function dueDistanceLabel(monthsUntilDue: number): string {
  if (monthsUntilDue < 0) return 'po terminie';
  if (monthsUntilDue === 0) return 'w tym miesiącu';
  if (monthsUntilDue === 1) return 'za miesiąc';
  return `za ${String(monthsUntilDue)} mies.`;
}

/**
 * Podpis terminu na karcie: dzień, gdy znany, inaczej odległość.
 *
 * @param item - Wydatek.
 * @returns Np. „14 mar" albo „za 2 mies.".
 */
export function dueCaption(item: Pick<PlannedExpenseDto, 'dueOn' | 'monthsUntilDue'>): string {
  if (item.monthsUntilDue < 0) return 'po terminie';
  return item.dueOn === null ? dueDistanceLabel(item.monthsUntilDue) : formatDateShort(item.dueOn);
}

/** Stan odkładania na karcie. */
export type FundingState = 'off' | 'covered' | 'funding';

/**
 * Stan odkładania: bez odkładania, pokryte w całości, w trakcie.
 *
 * Pokryte liczy się także bez włączonego odkładania — ktoś, kto od razu wpisał „Już mam"
 * w pełnej kwocie, nie ma czego odkładać.
 *
 * @param item - Wydatek.
 * @returns Stan.
 */
export function fundingState(item: Pick<PlannedExpenseDto, 'setAside'>): FundingState {
  if (item.setAside.coverageBps >= FULL_COVERAGE_BPS) return 'covered';
  return item.setAside.enabled ? 'funding' : 'off';
}

/**
 * Nazwa miesiąca w mianowniku bez roku — do „Wpłata za wrzesień".
 *
 * @param month - Miesiąc.
 * @returns Np. `wrzesień`.
 */
export function monthName(month: MonthKey): string {
  return formatMonth(month).split(' ')[0] ?? month;
}

/**
 * Czy karta ma przycisk „Odłóż teraz": odkładanie włączone, coś zostało, a w tym miesiącu
 * jeszcze nie odłożono. Po wpłacie przycisk ustępuje „✓ Wpłata za wrzesień" — druga
 * wpłata jest możliwa z arkusza szczegółów, ale nie jest tu zachętą.
 *
 * @param item - Wydatek.
 * @returns `true`, gdy pokazać przycisk.
 */
export function canSetAsideNow(item: Pick<PlannedExpenseDto, 'setAside' | 'status'>): boolean {
  return (
    item.setAside.enabled &&
    item.setAside.remainingMinor > 0 &&
    !item.setAside.paidThisMonth &&
    item.status !== 'posted' &&
    item.status !== 'cancelled'
  );
}

/** Podsumowanie ekranu (06 §3.10): horyzont, odłożone, rata, pokrycie. */
export interface PlannedSummary {
  readonly upcomingMinor: number;
  readonly setAsideMinor: number;
  readonly monthlyMinor: number;
  /** Pokrycie horyzontu; 0 bez wydatków. */
  readonly coverageBps: number;
}

/**
 * Podsumowanie z prognozy serwera.
 *
 * @param meta - Metadane `GET /planned-expenses/upcoming`.
 * @param meta.totalUpcomingMinor - Suma szacunków w horyzoncie.
 * @param meta.totalSetAsideMinor - Odłożone na wydatki w horyzoncie.
 * @param meta.monthlySetAsideRequiredMinor - Rata łączna.
 * @returns Podsumowanie.
 */
export function plannedSummary(meta: {
  totalUpcomingMinor: number;
  totalSetAsideMinor: number;
  monthlySetAsideRequiredMinor: number;
}): PlannedSummary {
  const coverageBps =
    meta.totalUpcomingMinor === 0
      ? 0
      : Math.min(
          FULL_COVERAGE_BPS,
          Math.floor((meta.totalSetAsideMinor * FULL_COVERAGE_BPS) / meta.totalUpcomingMinor),
        );
  return {
    upcomingMinor: meta.totalUpcomingMinor,
    setAsideMinor: meta.totalSetAsideMinor,
    monthlyMinor: meta.monthlySetAsideRequiredMinor,
    coverageBps,
  };
}

/**
 * Procent pokrycia słowami, zaokrąglony w dół — 99,9% to jeszcze nie „100%".
 *
 * @param bps - Pokrycie w punktach bazowych.
 * @returns Np. `33%`.
 */
export function coveragePercent(bps: number): string {
  return `${String(Math.floor(bps / 100))}%`;
}

/** Działanie przy ostrzeżeniu. */
export type WarningAction = 'set-aside' | 'enable' | null;

/**
 * Co można zrobić z ostrzeżeniem: spóźnione odkładanie — „Odłóż teraz", konieczny bez
 * odkładania — „Włącz odkładanie", brak na koncie — nic jednym przyciskiem (to kwestia
 * całego budżetu, nie jednego wydatku).
 *
 * @param warning - Ostrzeżenie.
 * @returns Działanie albo `null`.
 */
export function warningAction(warning: Pick<LiquidityWarningDto, 'code'>): WarningAction {
  if (warning.code === 'SET_ASIDE_BEHIND') return 'set-aside';
  if (warning.code === 'UNFUNDED_MUST_EXPENSE') return 'enable';
  return null;
}
