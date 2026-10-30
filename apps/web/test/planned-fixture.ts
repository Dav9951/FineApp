import type {
  MonthPlannedExpensesSectionDto,
  PlannedExpenseDto,
  UpcomingExpensesMeta,
} from '@fineapp/shared';

/**
 * Dane testowe planowanych wydatków — wspólne dla testów reguł i ekranów (`F6-6`…`F6-8`).
 *
 * Wartości z przykładu 04 §9a i makiety 06 §3.10: OC + AC 2 400 zł na 14 marca 2027,
 * odłożone 800 zł, rata 266,67 zł/mies.; dziś — wrzesień 2026.
 */

/** Identyfikator wydatku „OC + AC samochód". */
export const PLANNED_ID = '01JP0000000000000000000001';

/** Identyfikator konta odkładania. */
export const SET_ASIDE_ACCOUNT_ID = '01JA0000000000000000000002';

/**
 * Wydatek — domyślnie OC + AC z odkładaniem, 33% pokrycia, wrześniowa wpłata czeka.
 *
 * @param overrides - Nadpisane pola.
 * @returns Wydatek.
 */
export function plannedFixture(overrides: Partial<PlannedExpenseDto> = {}): PlannedExpenseDto {
  return {
    id: PLANNED_ID,
    name: 'OC + AC samochód',
    estimatedAmountMinor: 240_000,
    amountIsEstimate: true,
    currency: 'PLN',
    dueMonth: '2027-03',
    dueOn: '2027-03-14',
    monthsUntilDue: 6,
    categoryId: null,
    categoryName: null,
    accountId: null,
    liabilityId: null,
    priority: 'must',
    status: 'funding',
    setAside: {
      enabled: true,
      accountId: SET_ASIDE_ACCOUNT_ID,
      goalId: null,
      startMonth: '2026-09',
      accumulatedMinor: 80_000,
      remainingMinor: 160_000,
      coverageBps: 3333,
      monthlyRequiredMinor: 22_858,
      monthsLeft: 7,
      paidThisMonth: false,
      isOnTrack: true,
    },
    alreadySetAsideMinor: 80_000,
    repeatsYearly: true,
    previousInstanceId: null,
    transactionId: null,
    postedAmountMinor: null,
    postedAt: null,
    notes: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/**
 * Prognoza sześciu miesięcy z jednym wydatkiem — bez ostrzeżeń.
 *
 * @param overrides - Nadpisane pola.
 * @returns Metadane prognozy.
 */
export function upcomingMetaFixture(
  overrides: Partial<UpcomingExpensesMeta> = {},
): UpcomingExpensesMeta {
  return {
    horizonMonths: 6,
    totalUpcomingMinor: 240_000,
    totalSetAsideMinor: 80_000,
    monthlySetAsideRequiredMinor: 22_858,
    setAsidePaidThisMonthMinor: 0,
    byMonth: [
      { month: '2027-03', totalMinor: 240_000, coveredMinor: 80_000, shortfallMinor: 160_000 },
    ],
    liquidityWarnings: [],
    ...overrides,
  };
}

/**
 * Sekcja „Nadchodzące" podsumowania miesiąca — domyślnie pusta.
 *
 * @param overrides - Nadpisane pola.
 * @returns Sekcja.
 */
export function plannedSectionFixture(
  overrides: Partial<MonthPlannedExpensesSectionDto> = {},
): MonthPlannedExpensesSectionDto {
  return {
    dueThisMonthMinor: 0,
    upcoming6MonthsMinor: 0,
    monthlySetAsideRequiredMinor: 0,
    setAsidePaidThisMonthMinor: 0,
    warningCount: 0,
    warnings: [],
    items: [],
    readyToPay: [],
    ...overrides,
  };
}
