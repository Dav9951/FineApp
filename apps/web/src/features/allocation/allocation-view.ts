import {
  formatMonth,
  fromBps,
  type AccountBalanceDto,
  toBps,
  type AllocationKind,
  type AllocationLineDto,
  type AllocationStatusDto,
  type MonthKey,
} from '@fineapp/shared';

import type { TrendChartPoint } from '../../components/charts/trend-chart.js';
import type { ProgressPool } from '../../components/ui/index.js';

/**
 * Czyste reguły rozkładu docelowego — ekran `/allocation` i kafel „Cele procentowe"
 * ([06 §3.1](../../../../../plans/06-ui-views.md#31-miesiąc-dashboard--mmonth),
 * [§3.6](../../../../../plans/06-ui-views.md#36-rozkład-docelowy--allocation), `F5-7`, `F5-8`).
 */

/** Nazwy pul. */
export const ALLOCATION_KIND_LABEL: Readonly<Record<AllocationKind, string>> = {
  savings: 'Oszczędności',
  investment: 'Inwestycje',
  debt_repayment: 'Spłata długu',
};

/** Pula → kolor pierścienia i paska (15 §4.7). */
export const ALLOCATION_POOL: Readonly<Record<AllocationKind, ProgressPool>> = {
  savings: 'savings',
  investment: 'investment',
  debt_repayment: 'debt',
};

/** Udziały planu edytowane suwakami. */
export interface AllocationShares {
  readonly savingsPercentBps: number;
  readonly investmentPercentBps: number;
  readonly debtPercentBps: number;
}

/** Krok suwaka: pół procenta. */
export const SHARE_STEP_BPS = 50;

/**
 * Udziały z bieżącego stanu — punkt wyjścia suwaków.
 *
 * @param status - Stan rozkładu w miesiącu.
 * @returns Udziały planu (bez linii — 0%).
 */
export function sharesFrom(status: Pick<AllocationStatusDto, 'lines'>): AllocationShares {
  const share = (kind: AllocationKind): number =>
    status.lines.find((line) => line.kind === kind)?.targetPercentBps ?? 0;
  return {
    savingsPercentBps: share('savings'),
    investmentPercentBps: share('investment'),
    debtPercentBps: share('debt_repayment'),
  };
}

/** Podgląd planu przy bieżących suwakach (06 §3.6). */
export interface SharesPreview {
  readonly savingsMinor: number;
  readonly investmentMinor: number;
  readonly debtMinor: number;
  readonly totalBps: number;
  readonly totalMinor: number;
  /** „Na życie zostaje" — może być ujemne, gdy plan przekracza wpływy. */
  readonly remainingBps: number;
  readonly remainingMinor: number;
}

/**
 * Kwoty planu przy bieżących suwakach i „Na życie zostaje".
 *
 * Wiersz „Na życie zostaje" jest wyliczany, żeby pokazać realny skutek podniesienia celu
 * (06 §3.6) — przy planie ponad 100% jest ujemny, a UI ostrzega, nie blokuje (07 §2.7).
 *
 * @param shares - Udziały z suwaków.
 * @param incomeBaseMinor - Podstawa: wpływy miesiąca wliczane do alokacji.
 * @returns Kwoty i reszta.
 */
export function sharesPreview(shares: AllocationShares, incomeBaseMinor: number): SharesPreview {
  const savingsMinor = fromBps(shares.savingsPercentBps, incomeBaseMinor);
  const investmentMinor = fromBps(shares.investmentPercentBps, incomeBaseMinor);
  const debtMinor = fromBps(shares.debtPercentBps, incomeBaseMinor);
  const totalBps = shares.savingsPercentBps + shares.investmentPercentBps + shares.debtPercentBps;
  const totalMinor = savingsMinor + investmentMinor + debtMinor;
  return {
    savingsMinor,
    investmentMinor,
    debtMinor,
    totalBps,
    totalMinor,
    remainingBps: 10_000 - totalBps,
    remainingMinor: incomeBaseMinor - totalMinor,
  };
}

/**
 * Czy suwaki różnią się od zapisanego planu — „Zapisz" ma sens tylko wtedy.
 *
 * @param a - Udziały pierwsze.
 * @param b - Udziały drugie.
 * @returns `true`, gdy któryś udział jest inny.
 */
export function sharesChanged(a: AllocationShares, b: AllocationShares): boolean {
  return (
    a.savingsPercentBps !== b.savingsPercentBps ||
    a.investmentPercentBps !== b.investmentPercentBps ||
    a.debtPercentBps !== b.debtPercentBps
  );
}

/** Ocena linii w słowach — status niesie tekst i glif, nie sam kolor (15 §2.4). */
export interface LineVerdict {
  readonly tone: 'success' | 'warning' | 'muted';
  readonly label: string;
}

/**
 * Ocena linii porównania (07 §2.5).
 *
 * @param line - Linia porównania.
 * @returns Ton i etykieta.
 */
export function lineVerdict(
  line: Pick<AllocationLineDto, 'status' | 'actualAmountMinor' | 'targetAmountMinor'>,
): LineVerdict {
  if (line.actualAmountMinor < 0) return { tone: 'warning', label: 'wypłaty ponad wpłaty' };
  if (line.targetAmountMinor === 0) return { tone: 'muted', label: 'bez planu' };
  switch (line.status) {
    case 'ahead':
      return { tone: 'success', label: 'ponad plan' };
    case 'met':
      return { tone: 'success', label: 'plan wykonany' };
    case 'on_track':
      return { tone: 'muted', label: 'w tempie' };
    case 'behind':
      return { tone: 'warning', label: 'poniżej tempa' };
  }
}

/**
 * Ostrzeżenie o ubytku w puli — mówi, **co się stało** (15 §5 „Ostrzeżenie w kaflu").
 *
 * @param lines - Linie porównania.
 * @returns Zdanie albo `null`, gdy żadna pula nie jest na minusie.
 */
export function withdrawalNotice(lines: readonly AllocationLineDto[]): string | null {
  const negative = lines.filter((line) => line.actualAmountMinor < 0);
  if (negative.length === 0) return null;
  const names = negative.map((line) =>
    line.kind === 'savings' ? 'oszczędności' : line.kind === 'investment' ? 'inwestycji' : 'spłaty',
  );
  return `Z ${names.join(' i ')} wypłacono więcej, niż wpłacono.`;
}

/** Punkt trendu: plan i wykonanie łącznie. */
export interface TrendPoint {
  readonly month: MonthKey;
  readonly targetBps: number;
  readonly actualBps: number;
  /** Realizacja planu łącznie; 0 bez planu. */
  readonly fulfillmentBps: number;
  readonly hasIncome: boolean;
}

/**
 * Punkty trendu z serii stanów (06 §3.6) — łącznie wszystkie pule miesiąca.
 *
 * @param statuses - Stany miesięcy rosnąco.
 * @returns Punkty w tej samej kolejności.
 */
export function trendPoints(statuses: readonly AllocationStatusDto[]): TrendPoint[] {
  return statuses.map((status) => ({
    month: status.month,
    targetBps: status.totals.targetPercentBps,
    actualBps: status.totals.actualPercentBps,
    fulfillmentBps: toBps(status.totals.actualAmountMinor, status.totals.targetAmountMinor),
    hasIncome: status.incomeBaseMinor > 0,
  }));
}

/**
 * Punkty wykresu trendu (`F8-5`): wykonanie bez wpływów to brak wartości (przerwa
 * w linii), a nie zero — miesiąc bez wpływów nie ma procentu (07 §2.7). Plan zerowy
 * to „bez planu", więc też przerwa.
 *
 * @param points - Punkty trendu.
 * @returns Punkty w kształcie wykresu, od najstarszego.
 */
export function trendChartPoints(points: readonly TrendPoint[]): TrendChartPoint[] {
  return points.map((point) => ({
    key: point.month,
    label: monthShortLabel(point.month),
    title: formatMonth(point.month),
    actual: point.hasIncome ? point.actualBps : null,
    plan: point.targetBps === 0 ? null : point.targetBps,
  }));
}

/**
 * Podziałka osi wykresu: pełne procenty z minusem typograficznym (15 §2) — „−10%".
 *
 * @param bps - Wartość w punktach bazowych.
 * @returns Napis podziałki.
 */
export function percentTick(bps: number): string {
  const whole = Math.round(Math.abs(bps) / 100);
  return `${bps < 0 && whole > 0 ? '−' : ''}${String(whole)}%`;
}

/**
 * Skrót miesiąca do osi wykresu: „wrz".
 *
 * @param month - Klucz miesiąca.
 * @returns Skrót po polsku, bez kropki.
 */
export function monthShortLabel(month: MonthKey): string {
  return new Intl.DateTimeFormat('pl-PL', { month: 'short', timeZone: 'UTC' })
    .format(new Date(`${month}-01T00:00:00Z`))
    .replace('.', '');
}

/** Przelew „Uzupełnij": kwota niedoboru i konto puli, której brakuje najwięcej. */
export interface TopUpPreset {
  readonly amountMinor: number;
  readonly counterAccountId: string | null;
}

/**
 * Wartości z góry dla „Uzupełnij" / „Przelej teraz" (06 §3.1): cały niedobór miesiąca
 * i konto docelowe z puli o największym niedoborze — pierwsze aktywne konto tej klasy.
 * Dzięki temu domknięcie planu to otwarcie arkusza i „Zapisz". Spłata długu nie ma konta
 * puli, więc wtedy konto zostaje do wyboru.
 *
 * @param status - Stan rozkładu.
 * @param accounts - Salda kont z podsumowania miesiąca (w kolejności wyświetlania).
 * @returns Kwota i konto docelowe.
 */
export function topUpPreset(
  status: Pick<AllocationStatusDto, 'lines' | 'totals'>,
  accounts: readonly Pick<AccountBalanceDto, 'accountId' | 'allocationClass' | 'isArchived'>[],
): TopUpPreset {
  const worst = [...status.lines]
    .map((line) => ({ kind: line.kind, gap: line.targetAmountMinor - line.actualAmountMinor }))
    .filter((line) => line.gap > 0)
    .sort((a, b) => b.gap - a.gap)[0];
  const account =
    worst === undefined || worst.kind === 'debt_repayment'
      ? undefined
      : accounts.find((item) => !item.isArchived && item.allocationClass === worst.kind);
  return {
    amountMinor: status.totals.shortfallMinor,
    counterAccountId: account?.accountId ?? null,
  };
}
