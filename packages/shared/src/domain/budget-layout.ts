import type { BudgetLineFlow, BudgetLineOrigin, BudgetSection } from './enums.js';

/**
 * Układ szkicu budżetu: grupy linii i kolejność
 * ([07 §13.10](../../../../plans/07-domain-rules.md#1310-układ-szkicu-grupy-i-kolejność),
 * ADR-081).
 *
 * Układ jest **czysto prezentacyjny** — nic stąd nie wchodzi do bilansu, oceny ani
 * wykonania (07 §13.4, §13.8). Funkcje są wspólne dla API (zapis, kopiowanie układu
 * przy zakładaniu szkicu) i frontu (kolejność na ekranie, podgląd szybkiego startu).
 */

/** Kolejność sekcji na ekranie (06 §3.14). */
export const BUDGET_SECTIONS: readonly BudgetSection[] = ['income', 'expense', 'pools'];

/** Najdłuższa nazwa grupy (I-25). */
export const BUDGET_GROUP_NAME_MAX = 40;

/**
 * Sekcja linii: oszczędności i inwestycje dzielą jedną sekcję `pools`.
 *
 * @param flow - Strona bilansu linii.
 * @returns Sekcja szkicu.
 */
export function budgetSectionOf(flow: BudgetLineFlow): BudgetSection {
  return flow === 'savings' || flow === 'investment' ? 'pools' : flow;
}

/**
 * Nazwa w postaci do porównań: przycięta, małymi literami po polsku.
 *
 * Unikalność grupy w sekcji i dopasowanie linii między miesiącami nie mogą zależeć od
 * wielkości liter — „Raty" i „raty" to dla człowieka ta sama grupa.
 *
 * @param name - Nazwa grupy albo linii.
 * @returns Nazwa znormalizowana.
 */
export function normalizeBudgetName(name: string): string {
  return name.trim().toLocaleLowerCase('pl');
}

/** Grupa w układzie — pola potrzebne do kolejności i kopiowania. */
export interface BudgetLayoutGroup {
  readonly id: string;
  readonly section: BudgetSection;
  readonly name: string;
  readonly sortOrder: number;
}

/** Linia w układzie — pola potrzebne do kolejności i dopasowania między miesiącami. */
export interface BudgetLayoutLine {
  readonly id: string;
  readonly flow: BudgetLineFlow;
  readonly name: string;
  readonly origin: BudgetLineOrigin;
  readonly categoryId: string | null;
  readonly recurringRuleId: string | null;
  readonly plannedExpenseId: string | null;
  readonly goalId: string | null;
  readonly liabilityId: string | null;
  readonly groupId: string | null;
  readonly sortOrder: number;
}

/**
 * Porównanie kolejności — `sortOrder`, a przy remisie identyfikator (ULID rośnie
 * w czasie, więc remis rozstrzyga kolejność dopisania, jak w repozytorium).
 *
 * @param a - Pierwszy element.
 * @param a.sortOrder - Pozycja.
 * @param a.id - Identyfikator.
 * @param b - Drugi element.
 * @param b.sortOrder - Pozycja.
 * @param b.id - Identyfikator.
 * @returns Wynik porównania dla `Array.prototype.sort`.
 */
function byOrder(
  a: { readonly sortOrder: number; readonly id: string },
  b: { readonly sortOrder: number; readonly id: string },
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Linie w kolejności ekranu (07 §13.10): sekcje po kolei, w każdej grupy według ich
 * kolejności, w grupie linie według `sortOrder`, na końcu sekcji linie bez grupy.
 *
 * Linia ze wskaźnikiem na grupę spoza swojej sekcji albo nieznaną (nie powinno się
 * zdarzyć — I-25) trafia do „Bez grupy", żeby nie zniknęła z ekranu.
 *
 * @param groups - Grupy szkicu.
 * @param lines - Linie szkicu w dowolnej kolejności.
 * @returns Nowa tablica linii w kolejności ekranu.
 */
export function sortBudgetLines<T extends BudgetLayoutLine>(
  groups: readonly BudgetLayoutGroup[],
  lines: readonly T[],
): T[] {
  const result: T[] = [];
  for (const section of BUDGET_SECTIONS) {
    const own = lines.filter((line) => budgetSectionOf(line.flow) === section).sort(byOrder);
    const sectionGroups = groups.filter((group) => group.section === section).sort(byOrder);
    const known = new Set(sectionGroups.map((group) => group.id));
    for (const group of sectionGroups) {
      result.push(...own.filter((line) => line.groupId === group.id));
    }
    result.push(...own.filter((line) => line.groupId === null || !known.has(line.groupId)));
  }
  return result;
}

/**
 * Klucze dopasowania linii między szkicami (07 §13.10).
 *
 * `source` — tożsamość źródła (reguła, planowany wydatek, cel, zobowiązanie); linia
 * własna — strona bilansu, kategoria i nazwa. `fallback` — strona bilansu i nazwa;
 * łapie regułę podzieloną przez „Zastosuj w regule" (nowy identyfikator od miesiąca
 * podziału) i źródło założone od nowa pod tą samą nazwą.
 *
 * @param line - Linia.
 * @returns Dwa klucze; `source` pusty dla linii osieroconej.
 */
export function budgetLayoutKeys(line: BudgetLayoutLine): {
  readonly source: string | null;
  readonly fallback: string;
} {
  const name = normalizeBudgetName(line.name);
  const fallback = `${line.flow}:${name}`;
  switch (line.origin) {
    case 'recurring':
      return {
        source: line.recurringRuleId === null ? null : `rule:${line.recurringRuleId}`,
        fallback,
      };
    case 'planned':
    case 'set_aside':
      return {
        source: line.plannedExpenseId === null ? null : `${line.origin}:${line.plannedExpenseId}`,
        fallback,
      };
    case 'goal':
      return { source: line.goalId === null ? null : `goal:${line.goalId}`, fallback };
    case 'liability':
      return {
        source: line.liabilityId === null ? null : `liability:${line.liabilityId}`,
        fallback,
      };
    case 'manual':
      return { source: `manual:${line.flow}:${line.categoryId ?? ''}:${name}`, fallback };
  }
}

/** Grupa do skopiowania do nowego szkicu. */
export interface InheritedBudgetGroup {
  /** Grupa w szkicu źródłowym — do przepięcia linii na nowe identyfikatory. */
  readonly sourceGroupId: string;
  readonly section: BudgetSection;
  readonly name: string;
  readonly sortOrder: number;
}

/** Miejsce linii nowego szkicu po skopiowaniu układu. */
export interface InheritedBudgetPlacement {
  /** Grupa w szkicu źródłowym albo `null` — „Bez grupy". */
  readonly sourceGroupId: string | null;
  readonly sortOrder: number;
}

/** Wynik kopiowania układu. */
export interface InheritedBudgetLayout {
  readonly groups: readonly InheritedBudgetGroup[];
  /** Po jednym na linię nowego szkicu, w kolejności wejścia. */
  readonly placements: readonly InheritedBudgetPlacement[];
}

/**
 * Układ nowego szkicu z układu szkicu źródłowego (07 §13.10).
 *
 * Grupy kopiowane wszystkie (także puste). Każda linia nowego szkicu szuka odpowiednika
 * w źródle — najpierw po kluczu źródła, potem po stronie bilansu i nazwie; każdy
 * odpowiednik bierze najwyżej jedną linię. Linia dopasowana dostaje grupę odpowiednika
 * i jego miejsce w kolejności ekranu źródła; bez pary — „Bez grupy", za dopasowanymi,
 * w kolejności wejścia. `sortOrder` jest numerem kolejnym w całym szkicu — porównywany
 * i tak tylko w obrębie sekcji.
 *
 * @param previous - Szkic źródłowy: grupy i linie (także wykluczone — linia pominięta
 *   w listopadzie wraca w grudniu do swojej grupy).
 * @param previous.groups - Grupy szkicu źródłowego.
 * @param previous.lines - Linie szkicu źródłowego.
 * @param next - Linie nowego szkicu w kolejności wypełnienia.
 * @returns Grupy do założenia i miejsce każdej linii.
 */
export function inheritBudgetLayout(
  previous: {
    readonly groups: readonly BudgetLayoutGroup[];
    readonly lines: readonly BudgetLayoutLine[];
  },
  next: readonly BudgetLayoutLine[],
): InheritedBudgetLayout {
  const groups = BUDGET_SECTIONS.flatMap((section) =>
    previous.groups.filter((group) => group.section === section).sort(byOrder),
  ).map((group, index) => ({
    sourceGroupId: group.id,
    section: group.section,
    name: group.name,
    sortOrder: index,
  }));
  const groupIds = new Set(groups.map((group) => group.sourceGroupId));

  const ordered = sortBudgetLines(previous.groups, previous.lines).map((line, index) => ({
    line,
    index,
    keys: budgetLayoutKeys(line),
  }));
  const used = new Set<number>();
  type Candidate = (typeof ordered)[number];
  const take = (accept: (candidate: Candidate) => boolean): Candidate | null => {
    const found = ordered.find((candidate) => !used.has(candidate.index) && accept(candidate));
    if (found === undefined) return null;
    used.add(found.index);
    return found;
  };
  // Najpierw wszystkie dopasowania po źródle, potem po nazwie — inaczej linia bez pary
  // po źródle mogłaby zabrać odpowiednika linii, która stoi dalej i ma go po źródle.
  const keys = next.map(budgetLayoutKeys);
  const matches = keys.map((key) =>
    key.source === null ? null : take((candidate) => candidate.keys.source === key.source),
  );
  const resolved = keys.map(
    (key, index) => matches[index] ?? take((candidate) => candidate.keys.fallback === key.fallback),
  );

  let unmatched = 0;
  const placements = next.map((line, index): InheritedBudgetPlacement => {
    const match = resolved[index] ?? null;
    if (match === null) return { sourceGroupId: null, sortOrder: ordered.length + unmatched++ };
    const { groupId, flow } = match.line;
    const sourceGroupId =
      groupId !== null &&
      groupIds.has(groupId) &&
      budgetSectionOf(flow) === budgetSectionOf(line.flow)
        ? groupId
        : null;
    return { sourceGroupId, sortOrder: match.index };
  });
  return { groups, placements };
}

/** Nazwy grup szybkiego startu (07 §13.10). */
export const BUDGET_ORIGIN_GROUPS = [
  { name: 'Stałe', origins: ['recurring', 'liability'] },
  { name: 'Planowane', origins: ['planned', 'set_aside'] },
  { name: 'Zmienne', origins: ['manual', 'goal'] },
] as const satisfies readonly { name: string; origins: readonly BudgetLineOrigin[] }[];

/** Grupa szybkiego startu z liniami. */
export interface BudgetOriginGroup {
  readonly name: string;
  readonly lineIds: readonly string[];
}

/**
 * Szybki start: podział linii jednej sekcji na *Stałe / Planowane / Zmienne* według
 * pochodzenia (07 §13.10). Puste grupy pomijane, kolejność linii zachowana.
 *
 * @param lines - Niewykluczone linie sekcji w kolejności ekranu.
 * @returns Niepuste grupy w stałej kolejności.
 */
export function groupsByOrigin(
  lines: readonly { readonly id: string; readonly origin: BudgetLineOrigin }[],
): BudgetOriginGroup[] {
  return BUDGET_ORIGIN_GROUPS.map((group) => ({
    name: group.name,
    lineIds: lines
      .filter((line) => (group.origins as readonly BudgetLineOrigin[]).includes(line.origin))
      .map((line) => line.id),
  })).filter((group) => group.lineIds.length > 0);
}
