import {
  IdSchema,
  NonNegativeAmountMinorSchema,
  parseAmountToMinor,
  TransactionTypeSchema,
  type MonthKey,
  type TransactionType,
} from '@fineapp/shared';

/**
 * Filtry ekranu historii ([06 §3.2](../../../../../plans/06-ui-views.md#32-historia-transakcji--mmonthtransactions)).
 *
 * **Filtry żyją w adresie**, nie w stanie komponentu: dają się zapisać w zakładce
 * i wysłać drugiej osobie, a „wstecz" cofa ostatnią zmianę filtra. Nazwy parametrów
 * są te same co w `GET /transactions` (04 §7) — jedno mapowanie mniej do rozjechania.
 *
 * Adres pochodzi od użytkownika, więc każda wartość jest sprawdzana tymi samymi
 * schematami co w API. Śmieć w adresie znika po cichu, zamiast kończyć się błędem
 * `400` na całym ekranie.
 */

/** Filtry historii odczytane z adresu. */
export interface HistoryFilters {
  /** Szybki filtr typu; brak = wszystkie. */
  readonly type?: TransactionType;
  /** Szukany tekst: opis, sprzedawca, notatka. */
  readonly q?: string;
  readonly accountIds: readonly string[];
  readonly categoryIds: readonly string[];
  /** Tylko transakcje bez kategorii — wejście z licznika na dashboardzie (`Z-18`). */
  readonly uncategorized?: true;
  readonly incomeSourceIds: readonly string[];
  /** Najniższa kwota w groszach, włącznie. */
  readonly minAmountMinor?: number;
  /** Najwyższa kwota w groszach, włącznie. */
  readonly maxAmountMinor?: number;
  /** Pokazuje też transakcje z kosza — jedyna droga do przywrócenia po zniknięciu toastu. */
  readonly includeDeleted?: true;
}

/** Filtry puste — lista całego miesiąca. */
export const NO_FILTERS: HistoryFilters = {
  accountIds: [],
  categoryIds: [],
  incomeSourceIds: [],
};

/** Najwięcej wartości jednego filtra — ten sam limit co w API. */
const MAX_VALUES = 50;

/** Najdłuższy szukany tekst — ten sam limit co w API. */
const MAX_QUERY_LENGTH = 100;

/**
 * Zbiera poprawne, niepowtarzające się identyfikatory parametru.
 *
 * @param params - Parametry adresu.
 * @param key - Nazwa parametru.
 * @returns Identyfikatory w kolejności z adresu.
 */
function idsOf(params: URLSearchParams, key: string): string[] {
  const valid = params.getAll(key).filter((value) => IdSchema.safeParse(value).success);
  return [...new Set(valid)].slice(0, MAX_VALUES);
}

/**
 * Czyta kwotę w groszach z parametru.
 *
 * @param params - Parametry adresu.
 * @param key - Nazwa parametru.
 * @returns Kwota albo `undefined`, gdy brak lub niepoprawna.
 */
function amountOf(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || !/^\d+$/u.test(raw)) return undefined;
  const parsed = NonNegativeAmountMinorSchema.safeParse(Number(raw));
  return parsed.success ? parsed.data : undefined;
}

/**
 * Odczytuje filtry z parametrów adresu.
 *
 * Zakres kwot odwrócony (`min > max`) jest zamieniany miejscami: API odpowiedziałoby
 * na niego `400`, a intencja — „między tymi dwiema kwotami" — jest jednoznaczna.
 *
 * @param params - Parametry adresu.
 * @returns Filtry; niepoprawne wartości pominięte.
 */
export function parseHistoryFilters(params: URLSearchParams): HistoryFilters {
  const type = TransactionTypeSchema.safeParse(params.get('type'));
  const q = (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  // „Bez kategorii" wyklucza wybór kategorii (API odpowiada wtedy `400`) — wygrywa jawny wybór.
  const categoryIds = idsOf(params, 'categoryId');
  const uncategorized = params.get('uncategorized') === 'true' && categoryIds.length === 0;
  let min = amountOf(params, 'minAmountMinor');
  let max = amountOf(params, 'maxAmountMinor');
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];

  return {
    ...(type.success ? { type: type.data } : {}),
    ...(q === '' ? {} : { q }),
    accountIds: idsOf(params, 'accountId'),
    categoryIds,
    ...(uncategorized ? { uncategorized: true as const } : {}),
    incomeSourceIds: idsOf(params, 'incomeSourceId'),
    ...(min === undefined ? {} : { minAmountMinor: min }),
    ...(max === undefined ? {} : { maxAmountMinor: max }),
    ...(params.get('includeDeleted') === 'true' ? { includeDeleted: true as const } : {}),
  };
}

/**
 * Zapisuje filtry jako parametry adresu — odwrotność {@link parseHistoryFilters}.
 *
 * @param filters - Filtry.
 * @returns Parametry adresu; puste filtry nie zostawiają śladu.
 */
export function historyFiltersToParams(filters: HistoryFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.type) params.set('type', filters.type);
  if (filters.q) params.set('q', filters.q);
  for (const id of filters.accountIds) params.append('accountId', id);
  for (const id of filters.categoryIds) params.append('categoryId', id);
  if (filters.uncategorized) params.set('uncategorized', 'true');
  for (const id of filters.incomeSourceIds) params.append('incomeSourceId', id);
  if (filters.minAmountMinor !== undefined) {
    params.set('minAmountMinor', String(filters.minAmountMinor));
  }
  if (filters.maxAmountMinor !== undefined) {
    params.set('maxAmountMinor', String(filters.maxAmountMinor));
  }
  if (filters.includeDeleted) params.set('includeDeleted', 'true');
  return params;
}

/** Parametry `GET /transactions` dla historii jednego miesiąca. */
export type HistoryQuery = Readonly<Record<string, string | number | readonly string[]>>;

/**
 * Składa parametry zapytania o listę z miesiąca i filtrów.
 *
 * Wynik jest też **kluczem pamięci podręcznej** (`qk.transactionList`), więc pola bez
 * wartości są pomijane, a nie ustawiane na `undefined`: dwa klucze różniące się tylko
 * pustym polem dałyby dwa osobne wpisy tej samej listy.
 *
 * @param month - Oglądany miesiąc.
 * @param filters - Filtry z adresu.
 * @returns Parametry zapytania.
 */
export function historyQuery(month: MonthKey, filters: HistoryFilters): HistoryQuery {
  const query: Record<string, string | number | readonly string[]> = { month };
  if (filters.type) query.type = filters.type;
  if (filters.q) query.q = filters.q;
  if (filters.accountIds.length > 0) query.accountId = filters.accountIds;
  if (filters.categoryIds.length > 0) query.categoryId = filters.categoryIds;
  if (filters.uncategorized) query.uncategorized = 'true';
  if (filters.incomeSourceIds.length > 0) query.incomeSourceId = filters.incomeSourceIds;
  if (filters.minAmountMinor !== undefined) query.minAmountMinor = filters.minAmountMinor;
  if (filters.maxAmountMinor !== undefined) query.maxAmountMinor = filters.maxAmountMinor;
  if (filters.includeDeleted) query.includeDeleted = 'true';
  return query;
}

/**
 * Liczy filtry ustawione w panelu — do plakietki na przycisku „Filtry".
 *
 * Szybki filtr typu i wyszukiwarka są widoczne na ekranie, więc się nie liczą.
 * Zakres kwot to jeden filtr, nawet gdy ma oba krańce.
 *
 * @param filters - Filtry.
 * @returns Liczba aktywnych filtrów panelu.
 */
export function panelFilterCount(filters: HistoryFilters): number {
  const amount = filters.minAmountMinor !== undefined || filters.maxAmountMinor !== undefined;
  return (
    (filters.accountIds.length > 0 ? 1 : 0) +
    (filters.categoryIds.length > 0 || filters.uncategorized ? 1 : 0) +
    (filters.incomeSourceIds.length > 0 ? 1 : 0) +
    (amount ? 1 : 0) +
    (filters.includeDeleted ? 1 : 0)
  );
}

/**
 * Czy jakikolwiek filtr zawęża listę — od tego zależy tekst stanu pustego.
 *
 * @param filters - Filtry.
 * @returns `true`, gdy lista jest zawężona.
 */
export function hasAnyFilter(filters: HistoryFilters): boolean {
  return filters.type !== undefined || filters.q !== undefined || panelFilterCount(filters) > 0;
}

/** Wynik odczytu krańca zakresu kwot z pola panelu. */
export type AmountBound = { readonly ok: true; readonly minor?: number } | { readonly ok: false };

/**
 * Odczytuje kraniec zakresu kwot wpisany w panelu filtrów.
 *
 * Puste pole to brak krańca, nie zero — „od 0 zł" i „bez dolnej granicy" dają ten sam
 * wynik, ale „do 0 zł" i „bez górnej" już nie.
 *
 * @param text - Tekst pola, np. `"1 250,5"`.
 * @returns Kwota w groszach, brak krańca albo błąd.
 */
export function parseAmountBound(text: string): AmountBound {
  if (text.trim() === '') return { ok: true };
  const minor = parseAmountToMinor(text);
  if (minor === null || minor < 0) return { ok: false };
  return { ok: true, minor };
}

/** Kategoria w drzewie wyboru — tylko to, czego potrzebuje przełączanie. */
export interface CategoryNode {
  readonly id: string;
  readonly children: readonly { readonly id: string }[];
}

/**
 * Przełącza kategorię w wyborze wielokrotnym.
 *
 * Kategoria główna przełącza **razem z podkategoriami**: API filtruje po dokładnym
 * `categoryId`, a „Jedzenie" bez „Kawy" i „Restauracji" pokazałoby tylko transakcje
 * przypisane wprost do rodzica — zwykle garść, co wyglądałoby na błąd.
 *
 * @param selected - Wybrane identyfikatory.
 * @param node - Przełączana kategoria; dla podkategorii bez dzieci.
 * @returns Nowy wybór.
 */
export function toggleCategory(selected: readonly string[], node: CategoryNode): readonly string[] {
  const ids = [node.id, ...node.children.map((child) => child.id)];
  const next = new Set(selected);
  if (next.has(node.id)) for (const id of ids) next.delete(id);
  else for (const id of ids) next.add(id);
  return [...next];
}
