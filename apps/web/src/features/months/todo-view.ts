import {
  formatMonth,
  type LiabilityDto,
  type MonthSummaryDto,
  type PlannedExpenseDto,
  type RecurringOccurrenceDto,
} from '@fineapp/shared';

import { formatDateShort } from '../../lib/format.js';

/**
 * Czyste reguły sekcji „Do zrobienia" na dashboardzie
 * ([06 §3.1](../../../../../plans/06-ui-views.md#31-dashboard-miesiąca--mmonth), `F4-7`,
 * [07 §6.6](../../../../../plans/07-domain-rules.md#66-zaległości)). Bez Reacta.
 */

/** Wiersz z wystąpieniem reguły cyklicznej. */
export interface OccurrenceTodo {
  readonly kind: 'occurrence';
  readonly key: string;
  readonly occurrence: RecurringOccurrenceDto;
  readonly name: string;
  readonly dueOn: string;
  readonly amountMinor: number;
  readonly caption: string;
  readonly overdue: boolean;
  /** Czy wiersz ma przyciski — nie dla podglądu przyszłości (`id: null`). */
  readonly actionable: boolean;
}

/** Wiersz z ratą zobowiązania bez reguły cyklicznej. */
export interface LiabilityTodo {
  readonly kind: 'liability';
  readonly key: string;
  readonly liability: LiabilityDto;
  readonly name: string;
  readonly dueOn: string | null;
  readonly amountMinor: number;
  readonly caption: string;
  readonly overdue: boolean;
  readonly actionable: true;
}

/** Wiersz z planowanym wydatkiem w miesiącu terminu (`F6-8`) — „Zapłacone". */
export interface PlannedTodo {
  readonly kind: 'planned';
  readonly key: string;
  readonly planned: PlannedExpenseDto;
  readonly name: string;
  readonly dueOn: string | null;
  readonly amountMinor: number;
  readonly caption: string;
  readonly overdue: boolean;
  readonly actionable: true;
}

/** Wiersz sekcji „Do zrobienia". */
export type TodoRow = OccurrenceTodo | LiabilityTodo | PlannedTodo;

/**
 * Opis planowanego wydatku: rodzaj, termin, zaległość, szacunek.
 *
 * @param item - Wydatek.
 * @returns Podpis wiersza.
 */
function plannedCaption(item: PlannedExpenseDto): string {
  const parts = ['planowany wydatek'];
  if (item.dueOn !== null) parts.push(formatDateShort(item.dueOn));
  if (item.monthsUntilDue < 0) parts.push(`zaległe za ${formatMonth(item.dueMonth)}`);
  if (item.amountIsEstimate) parts.push('kwota szacunkowa');
  return parts.join(' · ');
}

/**
 * Opis wystąpienia: termin, zaległość z innym miesiącem, kwota szacunkowa.
 *
 * @param occurrence - Wystąpienie.
 * @param month - Oglądany miesiąc.
 * @returns Podpis wiersza.
 */
function occurrenceCaption(occurrence: RecurringOccurrenceDto, month: string): string {
  const parts = [formatDateShort(occurrence.dueOn)];
  if (occurrence.monthKey !== month) parts.push(`zaległe za ${formatMonth(occurrence.monthKey)}`);
  else if (occurrence.isOverdue) parts.push('po terminie');
  if (occurrence.amountIsEstimate) parts.push('kwota szacunkowa');
  return parts.join(' · ');
}

/**
 * Wiersze „Do zrobienia" (ADR-050).
 *
 * - Wystąpienia z `summary.recurring.items` — czekające w miesiącu, w bieżącym także
 *   zaległe z wcześniejszych (z podpisem miesiąca, 07 §6.6).
 * - W miesiącu bieżącym także raty zobowiązań **bez** reguły cyklicznej, niezapłacone
 *   w tym miesiącu i przypadające najpóźniej w nim (ADR-068): zobowiązanie z regułą ma ratę wśród wystąpień, więc pokazanie jej
 *   drugi raz dałoby dwa przyciski do tej samej raty.
 * - Planowane wydatki gotowe do zapłaty (`summary.plannedExpenses.readyToPay` — serwer
 *   wypełnia je tylko w miesiącu bieżącym, `F6-8`) z przyciskiem „Zapłacone".
 *
 * Kolejność: zaległe najpierw, potem po terminie; raty bez dnia płatności na końcu.
 *
 * @param summary - Podsumowanie miesiąca.
 * @param today - Dzisiejsza data.
 * @returns Wiersze sekcji.
 */
export function todoRows(summary: MonthSummaryDto, today: string): TodoRow[] {
  const occurrences: OccurrenceTodo[] = summary.recurring.items.map((occurrence) => ({
    kind: 'occurrence',
    key: occurrence.id ?? `${occurrence.ruleId}:${occurrence.dueOn}`,
    occurrence,
    name: occurrence.ruleName,
    dueOn: occurrence.dueOn,
    amountMinor: occurrence.plannedAmountMinor,
    caption: occurrenceCaption(occurrence, summary.month),
    overdue: occurrence.isOverdue,
    actionable: occurrence.id !== null && !summary.isFuture,
  }));

  const liabilities: LiabilityTodo[] = summary.isCurrent
    ? summary.liabilities.items
        .filter(
          (item) =>
            item.recurringRuleId === null &&
            item.remainingMinor > 0 &&
            !item.paidThisMonth &&
            // Rata z przyszłego miesiąca (spłata od listopada) nie jest do zrobienia teraz.
            (item.nextDueOn === null || item.nextDueOn.slice(0, 7) <= summary.month),
        )
        .map((liability) => {
          const overdue = liability.nextDueOn !== null && liability.nextDueOn < today;
          return {
            kind: 'liability',
            key: `liability:${liability.id}`,
            liability,
            name: liability.name,
            dueOn: liability.nextDueOn,
            amountMinor: liability.monthlyPaymentMinor,
            caption: [
              liability.nextDueOn === null
                ? 'rata'
                : `rata · ${formatDateShort(liability.nextDueOn)}`,
              ...(overdue ? ['po terminie'] : []),
            ].join(' · '),
            overdue,
            actionable: true,
          };
        })
    : [];

  const planned: PlannedTodo[] = summary.plannedExpenses.readyToPay.map((item) => ({
    kind: 'planned',
    key: `planned:${item.id}`,
    planned: item,
    name: item.name,
    dueOn: item.dueOn,
    amountMinor: item.estimatedAmountMinor,
    caption: plannedCaption(item),
    overdue: item.monthsUntilDue < 0,
    actionable: true,
  }));

  return [...occurrences, ...liabilities, ...planned].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueOn === null || b.dueOn === null) return a.dueOn === null ? 1 : -1;
    return a.dueOn.localeCompare(b.dueOn) || a.name.localeCompare(b.name);
  });
}

/**
 * Czy pokazać sekcję: coś czeka albo coś było w planie miesiąca. Gospodarstwo bez
 * pozycji cyklicznych i zobowiązań nie widzi pustej sekcji (06 §3.1 — kolejność pytań,
 * nie lista pustych kafli).
 *
 * @param summary - Podsumowanie miesiąca.
 * @param rows - Wiersze z {@link todoRows}.
 * @returns `true`, gdy sekcja ma coś do powiedzenia.
 */
export function showTodo(summary: MonthSummaryDto, rows: readonly TodoRow[]): boolean {
  return rows.length > 0 || summary.recurring.plannedTotalMinor > 0;
}
