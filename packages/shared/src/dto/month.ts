import { z } from 'zod';

import {
  AmountMinorSchema,
  BpsSchema,
  DateOnlySchema,
  HexColorSchema,
  IdSchema,
  MonthKeySchema,
  NonNegativeAmountMinorSchema,
  SignedBpsSchema,
} from '../domain/primitives.js';
import { AccountBalanceDtoSchema } from './account.js';
import { AllocationStatusDtoSchema } from './allocation.js';
import { MonthBudgetSectionDtoSchema } from './budget.js';
import { GoalDtoSchema } from './goal.js';
import { MonthPlannedExpensesSectionDtoSchema } from './planned-expense.js';
import { LiabilityDtoSchema } from './liability.js';
import { RecurringOccurrenceDtoSchema } from './recurring.js';
import { TransactionListItemDtoSchema } from './transaction.js';

/**
 * Kontrakty ekranu miesiąca
 * ([05 §13](../../../../plans/05-dto-contracts.md#13-miesiąc--dtomonthdtots)).
 *
 * Podsumowanie rośnie **sekcja po sekcji** razem z modułami, które je zasilają
 * ([ADR-039](../../../../plans/14-decisions-log.md#adr-039)): Faza 3 dostarcza konta,
 * sumy, kategorie, ostatnie transakcje i porównanie; rozkład i cele dochodzą w Fazie 5,
 * zobowiązania i pozycje cykliczne w Fazie 4, planowane wydatki w Fazie 6.
 */

/** Parametr ścieżki `/months/:monthKey/...`. */
export const MonthParamsSchema = z.object({ monthKey: MonthKeySchema });
/** Parametr ścieżki po walidacji. */
export type MonthParams = z.infer<typeof MonthParamsSchema>;

/** Sumy miesiąca w rozbiciu na strumienie pieniądza (07 §2, §12). */
export const MonthTotalsDtoSchema = z.object({
  incomeMinor: NonNegativeAmountMinorSchema,
  /** Przychody wliczane do podstawy celów procentowych (bez np. zwrotu podatku, 07 §2.3). */
  incomeBaseMinor: NonNegativeAmountMinorSchema,
  expenseMinor: NonNegativeAmountMinorSchema,
  /** Odkładanie NETTO: wpłaty minus wypłaty. Ujemne, gdy sięgnięto do oszczędności. */
  savingsMinor: AmountMinorSchema,
  /** Inwestowanie netto, analogicznie. */
  investmentMinor: AmountMinorSchema,
  /** Wydatki powiązane ze zobowiązaniem (07 §2.2a) — **część** `expenseMinor`, nie dodatek. */
  debtRepaymentMinor: NonNegativeAmountMinorSchema,
  /** `income − expense − savings − investment`; ujemne = miesiąc na minusie. */
  netMinor: AmountMinorSchema,
  /** Wolne środki do rozdysponowania: `max(0, net)` — nigdy ujemne (ADR-039). */
  unallocatedMinor: NonNegativeAmountMinorSchema,
});
/** Sumy miesiąca. */
export type MonthTotalsDto = z.infer<typeof MonthTotalsDtoSchema>;

/**
 * Udział kategorii w wydatkach miesiąca.
 *
 * Kwoty podkategorii są doliczone do kategorii głównej. `categoryId: null` to
 * „Bez kategorii" (07 §9.2) — wydatki zapisane bez kategorii też są wydatkami.
 */
export const CategorySpendingDtoSchema = z.object({
  categoryId: IdSchema.nullable(),
  name: z.string(),
  color: HexColorSchema.nullable(),
  icon: z.string().nullable(),
  amountMinor: NonNegativeAmountMinorSchema,
  /** Udział w wydatkach miesiąca; `0`, gdy wydatków nie ma. */
  shareBps: BpsSchema,
  transactionCount: z.number().int().nonnegative(),
  /** Kwota tej kategorii miesiąc wcześniej; `null`, gdy poprzedni miesiąc nie ma wydatków. */
  previousMonthAmountMinor: NonNegativeAmountMinorSchema.nullable(),
});
/** Udział kategorii w wydatkach. */
export type CategorySpendingDto = z.infer<typeof CategorySpendingDtoSchema>;

/** Kategoria główna z podkategoriami — ekran rozbicia `/m/:month/categories`. */
export const CategorySpendingTreeDtoSchema = CategorySpendingDtoSchema.extend({
  /**
   * Podkategorie z wydatkami w którymkolwiek z dwóch miesięcy. Wydatki zapisane
   * wprost na kategorii głównej nie mają tu wiersza — to różnica kwoty rodzica i sumy dzieci.
   */
  children: z.array(CategorySpendingDtoSchema),
});
/** Kategoria główna z podkategoriami. */
export type CategorySpendingTreeDto = z.infer<typeof CategorySpendingTreeDtoSchema>;

/** Porównanie z poprzednim miesiącem. */
export const MonthComparisonDtoSchema = z.object({
  previousMonth: MonthKeySchema,
  /** Czy poprzedni miesiąc ma jakąkolwiek transakcję — bez niej różnice nic nie mówią. */
  hasPreviousData: z.boolean(),
  incomeDeltaMinor: AmountMinorSchema,
  /**
   * Zmiana względem poprzedniego miesiąca; `0`, gdy tam było zero (07 §3, `toBps`).
   * Wzrost obcięty do `MAX_DELTA_BPS` (+1000%) — 07 §12.3, ADR-084.
   */
  incomeDeltaBps: SignedBpsSchema,
  expenseDeltaMinor: AmountMinorSchema,
  expenseDeltaBps: SignedBpsSchema,
});
/** Porównanie z poprzednim miesiącem. */
export type MonthComparisonDto = z.infer<typeof MonthComparisonDtoSchema>;

/**
 * Pozycje cykliczne miesiąca — sekcja „Do zrobienia" (`F4-7`, 07 §6.6, ADR-050).
 */
export const MonthRecurringSectionDtoSchema = z.object({
  /** Plan miesiąca: kwoty planowane wystąpień poza pominiętymi (jak w 04 §9). */
  plannedTotalMinor: NonNegativeAmountMinorSchema,
  /** Kwoty faktycznie zaksięgowane w miesiącu. */
  postedTotalMinor: NonNegativeAmountMinorSchema,
  /** Ile pozycji czeka — długość `items`. */
  pendingCount: z.number().int().nonnegative(),
  /** Ile z nich jest po terminie. */
  overdueCount: z.number().int().nonnegative(),
  /**
   * Do zrobienia, rosnąco po terminie: czekające wystąpienia miesiąca, a w miesiącu
   * bieżącym także **zaległe z wcześniejszych miesięcy okna** — każde z własnym
   * `monthKey`, żeby ekran podpisał, którego miesiąca dotyczy. W miesiącu przyszłym —
   * podgląd z `id: null`, bez księgowania.
   */
  items: z.array(RecurringOccurrenceDtoSchema),
});
/** Pozycje cykliczne miesiąca. */
export type MonthRecurringSectionDto = z.infer<typeof MonthRecurringSectionDtoSchema>;

/** Zobowiązania na dashboardzie (`F4-7`, ADR-050). */
export const MonthLiabilitiesSectionDtoSchema = z.object({
  /** Suma pozostałych kwot aktywnych zobowiązań — stan na dziś. */
  totalRemainingMinor: NonNegativeAmountMinorSchema,
  /** Suma rat aktywnych, jeszcze niespłaconych. */
  monthlyPaymentTotalMinor: NonNegativeAmountMinorSchema,
  /** Raty zaksięgowane w oglądanym miesiącu. */
  paidThisMonthMinor: NonNegativeAmountMinorSchema,
  /** Aktywne, niespłacone zobowiązania bez raty w oglądanym miesiącu. */
  unpaidCount: z.number().int().nonnegative(),
  /** Aktywne zobowiązania ze stanem na dziś. */
  items: z.array(LiabilityDtoSchema),
});
/** Zobowiązania na dashboardzie. */
export type MonthLiabilitiesSectionDto = z.infer<typeof MonthLiabilitiesSectionDtoSchema>;

/**
 * Ładunek ekranu miesiąca — jedno żądanie rysuje cały dashboard (04 §14).
 *
 * Sekcje Faz 4–6 dochodzą razem ze swoimi modułami (ADR-039): `recurring`
 * i `liabilities` od `F4-7`; `allocation`, `goals` i `plannedExpenses` — Fazy 5 i 6.
 */
export const MonthSummaryDtoSchema = z.object({
  month: MonthKeySchema,
  range: z.object({ from: DateOnlySchema, to: DateOnlySchema }),
  isCurrent: z.boolean(),
  /** Miesiąc trwa — sumy mogą jeszcze urosnąć. */
  isPartial: z.boolean(),
  /** Miesiąc się nie zaczął — ekran pokazuje podgląd, księgować nie wolno (06 §3.1). */
  isFuture: z.boolean(),
  /** Dni, które minęły, łącznie z dzisiejszym; pełny miesiąc dla przeszłych, `0` dla przyszłych. */
  daysElapsed: z.number().int().nonnegative(),
  daysInMonth: z.number().int().positive(),
  /** Najwcześniejsza data, na którą wolno zaksięgować transakcję (wymaganie #12). */
  canPostBackTo: DateOnlySchema,
  /** Najpóźniejsza taka data — koniec bieżącego miesiąca (07 §1.3). */
  canPostUntil: DateOnlySchema,
  totals: MonthTotalsDtoSchema,
  /** Salda na koniec miesiąca, jak `GET /accounts/balances?month=`. */
  accounts: z.array(AccountBalanceDtoSchema),
  netWorthMinor: AmountMinorSchema,
  /** Do pięciu kategorii głównych o największych wydatkach. */
  topCategories: z.array(CategorySpendingDtoSchema),
  /** Zaksięgowane wydatki bez kategorii — licznik „do uzupełnienia" (07 §9.2). */
  uncategorizedCount: z.number().int().nonnegative(),
  /** Dziesięć ostatnich transakcji miesiąca (bez kosza). */
  recentTransactions: z.array(TransactionListItemDtoSchema),
  comparison: MonthComparisonDtoSchema,
  /** Pozycje cykliczne i „Do zrobienia" (`F4-7`). */
  recurring: MonthRecurringSectionDtoSchema,
  /** Zobowiązania (`F4-7`). */
  liabilities: MonthLiabilitiesSectionDtoSchema,
  /** Kafel „Cele procentowe" — jak `GET /allocation/status?month=` (`F5-8`). */
  allocation: AllocationStatusDtoSchema,
  /** Aktywne cele z planem oglądanego miesiąca — jak `GET /goals?month=` (`F5-8`). */
  goals: z.array(GoalDtoSchema),
  /** „Nadchodzące" — planowane wydatki, odkładanie i ostrzeżenia (`F6-8`). */
  plannedExpenses: MonthPlannedExpensesSectionDtoSchema,
  /** Plan budżetu oglądanego i następnego miesiąca (`F9-8`). */
  budget: MonthBudgetSectionDtoSchema,
});
/** Podsumowanie miesiąca. */
export type MonthSummaryDto = z.infer<typeof MonthSummaryDtoSchema>;

/** Miesiące do nawigatora (`GET /months/available`). */
export const MonthsAvailableDtoSchema = z.object({
  /** Bieżący miesiąc w strefie gospodarstwa. */
  currentMonth: MonthKeySchema,
  /** Miesiące z co najmniej jedną transakcją w księdze, rosnąco. */
  months: z.array(MonthKeySchema),
});
/** Miesiące do nawigatora. */
export type MonthsAvailableDto = z.infer<typeof MonthsAvailableDtoSchema>;

/** Rozbicie wydatków miesiąca po kategoriach (`GET /months/:monthKey/categories`). */
export const MonthCategoriesDtoSchema = z.object({
  month: MonthKeySchema,
  previousMonth: MonthKeySchema,
  expenseMinor: NonNegativeAmountMinorSchema,
  /** Kategorie główne malejąco po kwocie; „Bez kategorii" na swoim miejscu w kolejności. */
  items: z.array(CategorySpendingTreeDtoSchema),
});
/** Rozbicie wydatków po kategoriach. */
export type MonthCategoriesDto = z.infer<typeof MonthCategoriesDtoSchema>;
