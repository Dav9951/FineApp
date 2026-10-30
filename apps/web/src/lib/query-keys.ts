import type { MonthKey } from '@fineapp/shared';

/**
 * Klucze pamięci podręcznej TanStack Query — **jedyne** źródło tych wartości.
 *
 * Klucz wpisany ręcznie w jednym miejscu i literówka w drugim dają cache, który się nie
 * unieważnia: widok pokazuje stare dane i nic tego nie zgłasza
 * ([02 §10](../../../../plans/02-architecture.md#10-frontend--wzorce)).
 *
 * Każda mutacja ma w JSDoc listę kluczy, które unieważnia — np. dodanie transakcji
 * dotyka `qk.month(m)`, `qk.accounts()` i `qk.goals()`.
 *
 * Konwencja: klucz zaczyna się od nazwy obszaru, więc `queryClient.invalidateQueries({
 * queryKey: qk.months() })` unieważnia wszystkie miesiące naraz.
 */
export const qk = {
  /** Dane zalogowanego użytkownika i gospodarstwa. */
  me: () => ['me'] as const,

  /** Korzeń wszystkich zapytań miesięcznych. */
  months: () => ['months'] as const,
  /** Podsumowanie miesiąca. */
  month: (month: MonthKey) => ['months', month] as const,
  /** Rozbicie miesiąca po kategoriach. */
  monthCategories: (month: MonthKey) => ['months', month, 'categories'] as const,
  /** Lista miesięcy, dla których istnieją dane. */
  monthsAvailable: () => ['months', 'available'] as const,

  /** Korzeń zapytań o transakcje. */
  transactions: () => ['transactions'] as const,
  /** Lista transakcji z filtrami; filtry są częścią klucza. */
  transactionList: (filters: Readonly<Record<string, unknown>>) =>
    ['transactions', 'list', filters] as const,
  /** Pojedyncza transakcja. */
  transaction: (id: string) => ['transactions', id] as const,

  /** Korzeń zapytań o konta — unieważnia listy, salda i szczegóły naraz. */
  accounts: () => ['accounts'] as const,
  /** Lista kont; z archiwum albo bez. */
  accountList: (includeArchived: boolean) => ['accounts', 'list', { includeArchived }] as const,
  /** Salda kont i majątek netto. */
  accountBalances: () => ['accounts', 'balances'] as const,
  /** Szczegóły konta z saldem. */
  account: (id: string) => ['accounts', 'detail', id] as const,

  /** Korzeń zapytań o kategorie. */
  categories: () => ['categories'] as const,
  /** Drzewo aktywnych kategorii jednego rodzaju. */
  categoryTree: (kind: string) => ['categories', 'tree', { kind }] as const,
  /** Drzewo kategorii jednego rodzaju razem z archiwum — ekran ustawień. */
  categoryTreeWithArchive: (kind: string) =>
    ['categories', 'tree', { kind, includeArchived: true }] as const,
  /** Korzeń statystyk użycia kategorii — unieważniany przez każdy zapis transakcji. */
  categoryUsageAll: () => ['categories', 'usage'] as const,
  /** Użycie kategorii: liczba transakcji i suma w miesiącu (ADR-038). */
  categoryUsage: (month: MonthKey) => ['categories', 'usage', month] as const,
  /** Źródła przychodu — aktywne; zarazem korzeń wszystkich zapytań o źródła. */
  incomeSources: () => ['income-sources'] as const,
  /** Źródła razem z archiwum — ekran ustawień (`F8-1`). */
  incomeSourcesWithArchive: () => ['income-sources', 'with-archive'] as const,

  /** Korzeń celów — listy i szczegóły naraz. */
  goals: () => ['goals'] as const,
  /** Lista celów z planem wpłat miesiąca. */
  goalList: (month: MonthKey) => ['goals', 'list', month] as const,
  /** Pojedynczy cel. */
  goal: (id: string) => ['goals', id] as const,

  /** Korzeń rozkładu docelowego — status, trend i wersje naraz. */
  allocationAll: () => ['allocation'] as const,
  /** Porównanie plan/wykonanie w miesiącu. */
  allocation: (month: MonthKey) => ['allocation', month] as const,
  /** Realizacja rozkładu miesiąc po miesiącu, do wskazanego miesiąca. */
  allocationTrend: (to: MonthKey) => ['allocation', 'trend', to] as const,

  /** Zobowiązania. */
  liabilities: () => ['liabilities'] as const,
  /** Pojedyncze zobowiązanie z historią rat. */
  liability: (id: string) => ['liabilities', id] as const,
  /** Prognozowany harmonogram spłaty zobowiązania. */
  liabilitySchedule: (id: string) => ['liabilities', id, 'schedule'] as const,

  /** Korzeń pozycji cyklicznych — reguły i wystąpienia naraz. */
  recurring: () => ['recurring'] as const,
  /** Lista reguł cyklicznych. */
  recurringRules: () => ['recurring', 'rules'] as const,
  /** Reguła z najbliższymi terminami. */
  recurringRule: (id: string) => ['recurring', 'rules', id] as const,
  /** Wystąpienia cykliczne w miesiącu. */
  recurringOccurrences: (month: MonthKey) => ['recurring', 'occurrences', month] as const,

  /** Korzeń planowanych wydatków — lista, prognoza i szczegóły naraz. */
  plannedExpenses: () => ['planned-expenses'] as const,
  /** Aktywne planowane wydatki. */
  plannedExpenseList: () => ['planned-expenses', 'list'] as const,
  /** Prognoza obciążeń i ostrzeżenia w horyzoncie. */
  plannedUpcoming: (months: number) => ['planned-expenses', 'upcoming', months] as const,
  /** Pojedynczy planowany wydatek. */
  plannedExpense: (id: string) => ['planned-expenses', 'detail', id] as const,

  /** Korzeń planera budżetu — lista, szkice i średnie naraz. */
  budget: () => ['budget'] as const,
  /** Lista szkiców z bilansem i podpowiedzią miesiąca. */
  budgetList: () => ['budget', 'list'] as const,
  /** Szkic miesiąca (`null`, gdy go nie ma). */
  budgetDraft: (month: MonthKey) => ['budget', 'draft', month] as const,
  /** Średnie kategorii w oknie 3/6/12 miesięcy. */
  budgetAverages: (months: number) => ['budget', 'averages', months] as const,

  /** Dokumenty wrzucone do OCR. */
  documents: () => ['documents'] as const,
  /** Pojedynczy dokument wraz z pozycjami. */
  document: (id: string) => ['documents', id] as const,
  /** Lista „Ostatnie" na ekranie skanu. */
  documentList: () => ['documents', 'list'] as const,

  /** Ustawienia gospodarstwa. */
  settings: () => ['settings'] as const,
  /** Zużycie OCR w bieżącym miesiącu i flaga włączenia (`F7-7`). */
  aiUsage: () => ['settings', 'ai-usage'] as const,
  /** Aktywne urządzenia zalogowanej osoby. */
  sessions: () => ['sessions'] as const,
} as const;
