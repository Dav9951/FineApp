import {
  budgetSectionOf,
  formatMinor,
  sortBudgetLines,
  toBps,
  type BudgetActualsDto,
  type BudgetDraftDto,
  type BudgetGroupDto,
  type BudgetLineDto,
  type BudgetLineFlow,
  type BudgetSection,
  type CategoryAveragesDto,
  type CategoryTreeDto,
  type CreateBudgetLineRequest,
} from '@fineapp/shared';

import type { MoneyVariant } from '../../components/ui/index.js';
import { percentOneDecimal } from '../goals/goals-view.js';

/**
 * Czyste reguły ekranu planera budżetu
 * ([06 §3.14](../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth)).
 *
 * Ocena szkicu przychodzi gotowa z API (07 §13.4) — tutaj tylko podział na sekcje,
 * podpisy linii i to, co z ostrzeżenia da się zrobić jednym dotknięciem.
 */

/** Grupa w sekcji na ekranie (07 §13.10). */
export interface BudgetGroupView {
  /** Grupa; `null` — „Bez grupy" (tylko w sekcji, która ma grupy). */
  readonly group: BudgetGroupDto | null;
  /** Niewykluczone linie grupy w kolejności ekranu. */
  readonly lines: readonly BudgetLineDto[];
  readonly totalMinor: number;
}

/** Sekcja linii szkicu. */
export interface BudgetSectionView {
  readonly key: BudgetSection;
  readonly title: string;
  /** Strona bilansu dla nowej linii z „+ Dodaj". */
  readonly addFlow: BudgetLineFlow;
  /** Niewykluczone linie sekcji w kolejności ekranu. */
  readonly lines: BudgetLineDto[];
  readonly totalMinor: number;
  /** Grupy sekcji z liniami, na końcu „Bez grupy"; pusta lista — sekcja bez grup. */
  readonly groups: readonly BudgetGroupView[];
}

/** Kolejność i nazwy sekcji (06 §3.14). */
const SECTIONS: readonly {
  key: BudgetSection;
  title: string;
  addFlow: BudgetLineFlow;
}[] = [
  { key: 'income', title: 'Wpływy', addFlow: 'income' },
  { key: 'expense', title: 'Wydatki', addFlow: 'expense' },
  { key: 'pools', title: 'Oszczędności i inwestycje', addFlow: 'savings' },
];

/**
 * Suma kwot linii.
 *
 * @param lines - Linie.
 * @returns Suma w groszach.
 */
function sumOf(lines: readonly BudgetLineDto[]): number {
  return lines.reduce((sum, line) => sum + line.amountMinor, 0);
}

/**
 * Linie szkicu w sekcjach i grupach — bez pominiętych, które idą do osobnej, zwiniętej
 * listy. Kolejność ekranu liczy `sortBudgetLines` (07 §13.10) — ta sama co w API.
 *
 * @param lines - Linie szkicu.
 * @param groups - Grupy szkicu.
 * @returns Trzy sekcje z sumami (także puste — „+ Dodaj" ma być zawsze pod ręką).
 */
export function budgetSections(
  lines: readonly BudgetLineDto[],
  groups: readonly BudgetGroupDto[] = [],
): BudgetSectionView[] {
  const ordered = sortBudgetLines(groups, lines);
  return SECTIONS.map((section) => {
    const own = ordered.filter(
      (line) => !line.isExcluded && budgetSectionOf(line.flow) === section.key,
    );
    const sectionGroups = groups
      .filter((group) => group.section === section.key)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const known = new Set(sectionGroups.map((group) => group.id));
    const loose = own.filter((line) => line.groupId === null || !known.has(line.groupId));
    const views: BudgetGroupView[] =
      sectionGroups.length === 0
        ? []
        : [
            ...sectionGroups.map((group) => {
              const members = own.filter((line) => line.groupId === group.id);
              return { group, lines: members, totalMinor: sumOf(members) };
            }),
            { group: null, lines: loose, totalMinor: sumOf(loose) },
          ];
    return {
      key: section.key,
      title: section.title,
      addFlow: section.addFlow,
      lines: own,
      totalMinor: sumOf(own),
      groups: views,
    };
  });
}

/**
 * Linie pominięte w planie (I-24) — do zwiniętej listy z „Przywróć".
 *
 * @param lines - Linie szkicu.
 * @returns Pominięte linie.
 */
export function excludedLines(lines: readonly BudgetLineDto[]): BudgetLineDto[] {
  return lines.filter((line) => line.isExcluded);
}

/** Pochodzenie linii do ikony i tekstu dla czytnika ekranu. */
export type LineKind =
  'recurring' | 'planned' | 'set_aside' | 'goal' | 'liability' | 'average' | 'manual';

/** Tekst pochodzenia dla czytnika ekranu — kolor ani ikona nie są jedynym nośnikiem. */
export const LINE_KIND_LABEL: Record<LineKind, string> = {
  recurring: 'pozycja cykliczna',
  planned: 'planowany wydatek',
  set_aside: 'odkładanie na planowany wydatek',
  goal: 'cel',
  liability: 'rata zobowiązania',
  average: 'ze średniej',
  manual: 'własna',
};

/**
 * Pochodzenie linii; linia własna z kwotą ze średniej ma własną ikonę „≈".
 *
 * @param line - Linia.
 * @returns Rodzaj linii.
 */
export function lineKind(line: BudgetLineDto): LineKind {
  if (line.origin !== 'manual') return line.origin;
  return line.averageMonths === null ? 'manual' : 'average';
}

/**
 * Wariant `<Money>` dla strony bilansu — kolor niesie strumień pieniądza (15 §3).
 *
 * @param flow - Strona bilansu.
 * @returns Wariant kwoty.
 */
export function lineMoneyVariant(flow: BudgetLineFlow): MoneyVariant {
  return flow;
}

/** Notka o źródle linii pod jej nazwą (07 §13.5). */
export type SourceNote =
  | { readonly kind: 'changed'; readonly amountMinor: number }
  | { readonly kind: 'edited'; readonly amountMinor: number }
  | { readonly kind: 'not_in_month' }
  | { readonly kind: 'missing' };

/**
 * Notka o źródle: zmiana w źródle (z „Przyjmij"), edycja w szkicu (kwota źródła jako
 * podpis), źródło bez terminu w miesiącu albo usunięte.
 *
 * @param line - Linia.
 * @returns Notka albo `null` dla linii własnej, zgodnej ze źródłem i w szkicu tylko do odczytu.
 */
export function sourceNote(line: BudgetLineDto): SourceNote | null {
  switch (line.sourceState) {
    case 'source_changed':
      return line.sourceCurrentAmountMinor === null
        ? null
        : { kind: 'changed', amountMinor: line.sourceCurrentAmountMinor };
    case 'missing':
      return { kind: 'missing' };
    case 'not_in_month':
      return { kind: 'not_in_month' };
    case 'in_sync':
      return line.sourceAmountMinor !== null && line.sourceAmountMinor !== line.amountMinor
        ? { kind: 'edited', amountMinor: line.sourceAmountMinor }
        : null;
    case null:
      return null;
  }
}

/**
 * Tekst notki o źródle.
 *
 * @param note - Notka.
 * @param origin - Pochodzenie linii — „w regule" albo „w źródle".
 * @returns Zdanie do pokazania.
 */
export function sourceNoteText(note: SourceNote, origin: BudgetLineDto['origin']): string {
  const where = origin === 'recurring' ? 'W regule' : 'W źródle';
  switch (note.kind) {
    case 'changed':
      return `${where} teraz ${formatMinor(note.amountMinor)}`;
    case 'edited':
      return `${where.toLowerCase()} ${formatMinor(note.amountMinor)}`;
    case 'not_in_month':
      return 'Nie wypada w tym miesiącu';
    case 'missing':
      return 'Źródło usunięto';
  }
}

/**
 * Podpis linii: kategoria i — dla kwoty ze średniej — okno średniej.
 *
 * @param line - Linia.
 * @returns Podpis albo `null`.
 */
export function lineCaption(line: BudgetLineDto): string | null {
  const parts = [
    line.categoryName,
    line.averageMonths === null ? null : `średnia ${String(line.averageMonths)} mies.`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** Nazwy pul rozkładu w podsumowaniu. */
const POOL_TITLE: Record<BudgetDraftDto['summary']['allocation'][number]['kind'], string> = {
  savings: 'Oszczędności',
  investment: 'Inwestycje',
  debt: 'Spłata zobowiązań',
};

/**
 * Wiersz rozkładu w podsumowaniu: „Oszczędności 18,4% z 20,0%" i wypełnienie paska.
 *
 * @param line - Ocena linii rozkładu.
 * @returns Etykieta i wypełnienie w bps (plan względem celu).
 */
export function allocationRow(line: BudgetDraftDto['summary']['allocation'][number]): {
  label: string;
  fulfillmentBps: number;
} {
  return {
    label: `${POOL_TITLE[line.kind]} ${percentOneDecimal(line.plannedBps)} z ${percentOneDecimal(line.targetBps)}`,
    fulfillmentBps:
      line.targetMinor === 0 ? 10_000 : Math.round((line.plannedMinor / line.targetMinor) * 10_000),
  };
}

/**
 * Linia własna, która domyka niedobór z ostrzeżenia — „Dodaj brakujące X" (06 §3.14).
 *
 * Tylko niedobór puli oszczędności / inwestycji i celu: spłata długu to raty, a odkładanie
 * na planowany wydatek ma własną linię do poprawienia.
 *
 * @param warning - Ostrzeżenie z oceny.
 * @param summary - Ocena (rodzaj celu).
 * @returns Pola nowej linii albo `null`, gdy tu nie ma czego dopisać.
 */
export function missingLineFor(
  warning: BudgetDraftDto['summary']['warnings'][number],
  summary: BudgetDraftDto['summary'],
): CreateBudgetLineRequest | null {
  const amountMinor = warning.amountMinor ?? 0;
  if (amountMinor <= 0 || warning.target === null) return null;
  const { kind, id } = warning.target;
  if (warning.code === 'ALLOCATION_SHORT' && (kind === 'savings' || kind === 'investment')) {
    return {
      flow: kind,
      name: kind === 'savings' ? 'Uzupełnienie oszczędności' : 'Uzupełnienie inwestycji',
      amountMinor,
      notes: null,
    };
  }
  if (warning.code === 'GOAL_SHORT' && kind === 'goal' && id !== null) {
    const goal = summary.goals.find((item) => item.goalId === id);
    if (goal === undefined) return null;
    return { flow: goal.kind, name: `Wpłata: ${goal.name}`, amountMinor, goalId: id, notes: null };
  }
  return null;
}

/** Wiersz sekcji „Cele i odkładanie". */
export interface GoalRow {
  readonly key: string;
  readonly name: string;
  readonly plannedMinor: number;
  readonly requiredMinor: number;
  readonly met: boolean;
}

/**
 * Cele z wymaganiem i odkładanie na planowane wydatki — sekcja „Cele i odkładanie".
 *
 * @param summary - Ocena szkicu.
 * @returns Wiersze; pusta lista — sekcji nie ma.
 */
export function goalRows(summary: BudgetDraftDto['summary']): GoalRow[] {
  return [
    ...summary.goals
      .filter((goal) => goal.requiredMinor !== null)
      .map((goal) => ({
        key: `goal:${goal.goalId}`,
        name: goal.name,
        plannedMinor: goal.plannedMinor,
        requiredMinor: goal.requiredMinor ?? 0,
        met: goal.status === 'met',
      })),
    ...summary.setAside.map((item) => ({
      key: `set_aside:${item.plannedExpenseId}`,
      name: `Odkładanie: ${item.name}`,
      plannedMinor: item.plannedMinor,
      requiredMinor: item.requiredMinor,
      met: item.status === 'met',
    })),
  ];
}

/**
 * Średnia kategorii głównej, do której należy kategoria linii (07 §13.3 liczy średnią
 * po kategoriach głównych z podkategoriami).
 *
 * @param averages - Średnie z API.
 * @param tree - Drzewo kategorii wydatków.
 * @param categoryId - Kategoria linii.
 * @returns Średnia w groszach albo `null`, gdy kategoria nie miała wydatków w oknie.
 */
export function averageForCategory(
  averages: CategoryAveragesDto | undefined,
  tree: readonly CategoryTreeDto[],
  categoryId: string | null,
): number | null {
  if (averages === undefined || categoryId === null) return null;
  const mainId =
    tree.find(
      (parent) =>
        parent.id === categoryId || parent.children.some((child) => child.id === categoryId),
    )?.id ?? categoryId;
  return averages.items.find((item) => item.categoryId === mainId)?.averageMinor ?? null;
}

/** Wykonanie pod linią albo pod ostatnią linią grupy (07 §13.8, `F9-9`). */
export interface LineProgress {
  /** Podpis grupy kilku linii („Jedzenie razem"); `null` dla jednej linii. */
  readonly label: string | null;
  readonly plannedMinor: number;
  readonly actualMinor: number;
  /** Ile zostało do planu; `0` po przekroczeniu albo przy planie ≤ 0. */
  readonly remainingMinor: number;
  /** O ile wykonanie przekroczyło plan; `0` przy planie ≤ 0. */
  readonly overMinor: number;
  /** Wykonanie względem planu; `0` przy planie ≤ 0 (bez `NaN`). */
  readonly fulfillmentBps: number;
  /** Przekroczenie jest ostrzeżeniem tylko dla wydatków — więcej wpływów to nie problem. */
  readonly overIsWarning: boolean;
  readonly flow: BudgetLineFlow;
}

/** Czasownik wykonania dla strony bilansu. */
const PROGRESS_VERB: Record<BudgetLineFlow, string> = {
  income: 'wpłynęło',
  expense: 'wydano',
  savings: 'odłożono',
  investment: 'zainwestowano',
};

/**
 * Wykonanie wobec planu — bez `NaN` przy planie ≤ 0 (`toBps` daje wtedy 0).
 *
 * @param flow - Strona bilansu.
 * @param plannedMinor - Plan.
 * @param actualMinor - Wykonanie.
 * @param label - Podpis grupy kategorii albo `null`.
 * @returns Wykonanie do pokazania.
 */
function progress(
  flow: BudgetLineFlow,
  plannedMinor: number,
  actualMinor: number,
  label: string | null,
): LineProgress {
  return {
    label,
    plannedMinor,
    actualMinor,
    remainingMinor: plannedMinor > 0 ? Math.max(0, plannedMinor - actualMinor) : 0,
    overMinor: plannedMinor > 0 ? Math.max(0, actualMinor - plannedMinor) : 0,
    fulfillmentBps: toBps(actualMinor, plannedMinor),
    overIsWarning: flow === 'expense',
    flow,
  };
}

/**
 * Wykonanie przy liniach szkicu. Linia powiązana ma własne; grupa linii własnych jednej
 * kategorii — jedno, pokazane pod **ostatnią** linią grupy z podpisem „{nazwa} razem"
 * (księga nie wie, której linii dotyczy zakup — 07 §13.8).
 *
 * @param actuals - Wykonanie z API; `null` dla miesiąca przyszłego.
 * @param lines - Linie szkicu w kolejności wyświetlania.
 * @returns Mapa id linii → wykonanie do pokazania.
 */
export function progressByLine(
  actuals: BudgetActualsDto | null,
  lines: readonly BudgetLineDto[],
): Map<string, LineProgress> {
  const result = new Map<string, LineProgress>();
  if (actuals === null) return result;
  for (const line of lines) {
    const actual = actuals.lines[line.id];
    if (actual !== undefined)
      result.set(line.id, progress(line.flow, line.amountMinor, actual, null));
  }
  const order = new Map(lines.map((line, index) => [line.id, index]));
  for (const group of actuals.groups) {
    const members = group.lineIds
      .filter((id) => order.has(id))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const last = members.at(-1);
    const flow = lines.find((line) => line.id === last)?.flow;
    if (last === undefined || flow === undefined) continue;
    result.set(
      last,
      progress(
        flow,
        group.plannedMinor,
        group.actualMinor,
        members.length > 1 ? `${group.name} razem` : null,
      ),
    );
  }
  return result;
}

/**
 * Wykonanie grupy w nagłówku (07 §13.10): suma wykonań jej linii i wspólnych wykonań
 * kategorii leżących **w całości** w grupie.
 *
 * Gdy wspólne wykonanie kategorii dzieli grupę z inną grupą albo z „Bez grupy", nie da
 * się go rzetelnie rozdzielić (księga nie wie, której linii dotyczy zakup) — nagłówek
 * pokazuje wtedy sam plan. Tak samo przy grupie mieszającej oszczędności z inwestycjami
 * (inny czasownik) i grupie, której żadna linia nie ma wykonania.
 *
 * @param actuals - Wykonanie z API; `null` dla miesiąca przyszłego.
 * @param group - Grupa z liniami.
 * @returns Wykonanie grupy albo `null`.
 */
export function groupProgress(
  actuals: BudgetActualsDto | null,
  group: BudgetGroupView,
): LineProgress | null {
  if (actuals === null || group.group === null) return null;
  const flow = group.lines[0]?.flow;
  if (flow === undefined || group.lines.some((line) => line.flow !== flow)) return null;
  const members = new Set(group.lines.map((line) => line.id));
  let actualMinor = 0;
  let measured = false;
  for (const line of group.lines) {
    const actual = actuals.lines[line.id];
    if (actual === undefined) continue;
    actualMinor += actual;
    measured = true;
  }
  for (const shared of actuals.groups) {
    const inside = shared.lineIds.filter((id) => members.has(id));
    if (inside.length === 0) continue;
    if (inside.length !== shared.lineIds.length) return null;
    actualMinor += shared.actualMinor;
    measured = true;
  }
  return measured ? progress(flow, group.totalMinor, actualMinor, null) : null;
}

/**
 * Zdanie wykonania pod linią: „wydano 1 450,00 · zostało 450,00" albo
 * „wydano 2 020,00 · ponad plan 120,00".
 *
 * @param progress - Wykonanie linii.
 * @returns Części zdania: czasownik z kwotą i opcjonalna druga część.
 */
export function progressText(progress: LineProgress): {
  readonly verb: string;
  readonly rest: { readonly label: string; readonly amountMinor: number } | null;
} {
  const verb = PROGRESS_VERB[progress.flow];
  if (progress.overMinor > 0) {
    return { verb, rest: { label: 'ponad plan', amountMinor: progress.overMinor } };
  }
  if (progress.remainingMinor > 0) {
    return {
      verb,
      rest: {
        label: progress.flow === 'expense' ? 'zostało' : 'brakuje',
        amountMinor: progress.remainingMinor,
      },
    };
  }
  return { verb, rest: null };
}
