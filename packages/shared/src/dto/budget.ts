import { z } from 'zod';

import { BUDGET_GROUP_NAME_MAX } from '../domain/budget-layout.js';
import { budgetLineIssues } from '../domain/budget.js';
import {
  BudgetLineFlowSchema,
  BudgetLineOriginSchema,
  BudgetSectionSchema,
  FrequencySchema,
  GoalKindSchema,
  PlannedExpensePrioritySchema,
} from '../domain/enums.js';
import {
  AmountMinorSchema,
  BpsSchema,
  DateOnlySchema,
  IdSchema,
  MonthKeySchema,
  NonNegativeAmountMinorSchema,
  SignedBpsSchema,
  TimestampSchema,
} from '../domain/primitives.js';

/**
 * Kontrakty planera budżetu
 * ([05 §13b](../../../../plans/05-dto-contracts.md#13b-planer-budżetu--dtobudgetts),
 * `F9-2`, ADR-075…079). Wyliczenia: `shared/domain/budget.ts` (07 §13).
 */

/**
 * Opcjonalny tekst: przycięty, pusty zapisywany jako brak.
 *
 * @param max - Najwięcej znaków.
 * @returns Schemat pola.
 */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Tekst może mieć najwyżej ${String(max)} znaków`)
    .nullish()
    .transform((value) => (value === '' ? null : value));
}

/** Nazwa linii — jak nazwa reguły i planowanego wydatku. */
const LineNameSchema = z
  .string()
  .trim()
  .min(1, 'Nazwa jest wymagana')
  .max(60, 'Nazwa może mieć najwyżej 60 znaków');

/** Stan źródła linii powiązanej (07 §13.5). */
export const BudgetSourceStateSchema = z.enum([
  'in_sync',
  'source_changed',
  'not_in_month',
  'missing',
]);

/** Okno średniej kategorii w miesiącach (07 §13.3, ADR-078). */
export const AverageMonthsSchema = z.union([z.literal(3), z.literal(6), z.literal(12)]);
/** Okno średniej kategorii. Dozwolone wartości ustala schemat powyżej. */
export type AverageMonths = z.infer<typeof AverageMonthsSchema>;

/** Cel zamiany linii własnej (07 §13.6). */
export const BudgetPromoteTargetSchema = z.enum(['recurring', 'planned']);

/** Linia szkicu budżetu. */
export const BudgetLineDtoSchema = z.object({
  id: IdSchema,
  flow: BudgetLineFlowSchema,
  name: z.string(),
  /** Ujemna wyłącznie dla savings/investment — wypłata z odłożonego (I-21). */
  amountMinor: AmountMinorSchema,
  categoryId: IdSchema.nullable(),
  categoryName: z.string().nullable(),
  incomeSourceId: IdSchema.nullable(),
  goalId: IdSchema.nullable(),
  liabilityId: IdSchema.nullable(),
  dueOn: DateOnlySchema.nullable(),
  origin: BudgetLineOriginSchema,
  recurringRuleId: IdSchema.nullable(),
  plannedExpenseId: IdSchema.nullable(),
  /** Kwota źródła z chwili wypełnienia albo ostatniego „Przyjmij". */
  sourceAmountMinor: AmountMinorSchema.nullable(),
  /** Stan źródła (07 §13.5); `null` dla linii własnych i w szkicu tylko do odczytu. */
  sourceState: BudgetSourceStateSchema.nullable(),
  /** Bieżąca kwota źródła — tylko przy `source_changed`. */
  sourceCurrentAmountMinor: AmountMinorSchema.nullable(),
  averageMonths: AverageMonthsSchema.nullable(),
  isExcluded: z.boolean(),
  /** Co można z linią zrobić — front nie powtarza reguł z 07 §13.6–13.7. */
  canPromote: z.array(BudgetPromoteTargetSchema),
  canApplyToSource: z.boolean(),
  /** Grupa w sekcji (07 §13.10); `null` — „Bez grupy". */
  groupId: IdSchema.nullable(),
  sortOrder: z.number().int(),
  notes: z.string().nullable(),
});
/** Linia szkicu budżetu. */
export type BudgetLineDto = z.infer<typeof BudgetLineDtoSchema>;

/** Grupa linii w sekcji szkicu (03 §3.21, ADR-081) — tylko układ, bez wpływu na sumy. */
export const BudgetGroupDtoSchema = z.object({
  id: IdSchema,
  section: BudgetSectionSchema,
  name: z.string(),
  sortOrder: z.number().int(),
});
/** Grupa linii w sekcji szkicu. */
export type BudgetGroupDto = z.infer<typeof BudgetGroupDtoSchema>;

/** Ocena linii rozkładu docelowego w planie (07 §13.4). */
export const BudgetAllocationLineSchema = z.object({
  kind: z.enum(['savings', 'investment', 'debt']),
  targetBps: BpsSchema,
  targetMinor: NonNegativeAmountMinorSchema,
  /** Netto — może być ujemne (ADR-011). */
  plannedMinor: AmountMinorSchema,
  plannedBps: SignedBpsSchema,
  status: z.enum(['met', 'short']),
  shortfallMinor: NonNegativeAmountMinorSchema,
});

/** Ocena celu w planie (07 §13.4). */
export const BudgetGoalCheckSchema = z.object({
  goalId: IdSchema,
  name: z.string(),
  kind: GoalKindSchema,
  plannedMinor: AmountMinorSchema,
  requiredMinor: NonNegativeAmountMinorSchema.nullable(),
  /** Skąd wymaganie: termin celu (prognoza) albo plan wpłat. */
  requirementBasis: z.enum(['target_date', 'contribution_plan']).nullable(),
  status: z.enum(['met', 'short', 'no_requirement']),
  shortfallMinor: NonNegativeAmountMinorSchema,
});

/** Ocena odkładania na planowany wydatek (07 §13.4). */
export const BudgetSetAsideCheckSchema = z.object({
  plannedExpenseId: IdSchema,
  name: z.string(),
  dueMonth: MonthKeySchema,
  requiredMinor: NonNegativeAmountMinorSchema,
  plannedMinor: AmountMinorSchema,
  status: z.enum(['met', 'short']),
});

/** Ostrzeżenie szkicu — informuje, nie blokuje (07 §13.4). */
export const BudgetWarningSchema = z.object({
  code: z.enum([
    'NEGATIVE_LEFTOVER',
    'NO_INCOME',
    'ALLOCATION_SHORT',
    'GOAL_SHORT',
    'SET_ASIDE_SHORT',
    'ORPHAN_LINES',
  ]),
  /** Po polsku, gotowe do pokazania. */
  message: z.string(),
  amountMinor: AmountMinorSchema.nullable(),
  /** Do przycisku „Dodaj brakujące" — pula, cel albo wydatek, którego dotyczy. */
  target: z
    .object({
      kind: z.enum(['savings', 'investment', 'debt', 'goal', 'planned_expense']),
      id: IdSchema.nullable(),
    })
    .nullable(),
});

/** Bilans i ocena szkicu (07 §13.4). */
export const BudgetSummarySchema = z.object({
  incomeMinor: NonNegativeAmountMinorSchema,
  incomeBaseMinor: NonNegativeAmountMinorSchema,
  hasIncomeBase: z.boolean(),
  expenseMinor: NonNegativeAmountMinorSchema,
  savingsMinor: AmountMinorSchema,
  investmentMinor: AmountMinorSchema,
  debtRepaymentMinor: NonNegativeAmountMinorSchema,
  /** income − expense − savings − investment; ujemne = plan na minusie. */
  leftoverMinor: AmountMinorSchema,
  allocation: z.array(BudgetAllocationLineSchema),
  goals: z.array(BudgetGoalCheckSchema),
  setAside: z.array(BudgetSetAsideCheckSchema),
  warnings: z.array(BudgetWarningSchema),
});
/** Bilans i ocena szkicu. */
export type BudgetSummaryDto = z.infer<typeof BudgetSummarySchema>;

/** Wykonanie planu (07 §13.8) — tylko dla M ≤ bieżący miesiąc (`F9-9`); przyszły — `null`. */
export const BudgetActualsSchema = z.object({
  /** Wykonanie linii powiązanych; klucz = id linii. */
  lines: z.record(IdSchema, AmountMinorSchema),
  /** Wykonanie grup linii własnych: kategorie główne i źródła przychodu. */
  groups: z.array(
    z.object({
      kind: z.enum(['category', 'income_source']),
      id: IdSchema,
      name: z.string(),
      lineIds: z.array(IdSchema),
      plannedMinor: AmountMinorSchema,
      actualMinor: AmountMinorSchema,
    }),
  ),
  totals: z.object({
    incomeMinor: NonNegativeAmountMinorSchema,
    expenseMinor: NonNegativeAmountMinorSchema,
    savingsMinor: AmountMinorSchema,
    investmentMinor: AmountMinorSchema,
    netMinor: AmountMinorSchema,
  }),
  unplannedMinor: NonNegativeAmountMinorSchema,
});
/** Wykonanie planu. */
export type BudgetActualsDto = z.infer<typeof BudgetActualsSchema>;

/** Szkic budżetu miesiąca z liniami i oceną. */
export const BudgetDraftDtoSchema = z.object({
  id: IdSchema,
  month: MonthKeySchema,
  /** M ≥ bieżący (07 §13.1). */
  isEditable: z.boolean(),
  notes: z.string().nullable(),
  lastFilledAt: TimestampSchema.nullable(),
  /** W kolejności ekranu (07 §13.10); także wykluczone — UI zwija je osobno. */
  lines: z.array(BudgetLineDtoSchema),
  /** Grupy wszystkich sekcji, po sekcji i kolejności. */
  groups: z.array(BudgetGroupDtoSchema),
  summary: BudgetSummarySchema,
  actuals: BudgetActualsSchema.nullable(),
});
/** Szkic budżetu miesiąca. */
export type BudgetDraftDto = z.infer<typeof BudgetDraftDtoSchema>;

/** Pozycja listy szkiców. */
export const BudgetDraftListItemSchema = z.object({
  month: MonthKeySchema,
  incomeMinor: NonNegativeAmountMinorSchema,
  expenseMinor: NonNegativeAmountMinorSchema,
  leftoverMinor: AmountMinorSchema,
  lineCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
});

/** Lista szkiców — `GET /budget-drafts`. */
export const BudgetDraftListDtoSchema = z.object({
  items: z.array(BudgetDraftListItemSchema),
  /** Najbliższy miesiąc bez szkicu z zakresu; w ostatnim tygodniu miesiąca — następny. */
  suggestedMonth: MonthKeySchema.nullable(),
  range: z.object({ from: MonthKeySchema, to: MonthKeySchema }),
});
/** Lista szkiców. */
export type BudgetDraftListDto = z.infer<typeof BudgetDraftListDtoSchema>;

/** Założenie szkicu — `POST /budget-drafts/:month`. */
export const CreateBudgetDraftRequestSchema = z.object({
  fillFromSources: z.boolean().default(true),
  copyManualFrom: MonthKeySchema.nullish(),
  averageLines: z
    .array(z.object({ categoryId: IdSchema, months: AverageMonthsSchema.default(3) }))
    .max(50, 'Najwyżej 50 kategorii naraz')
    .default([]),
  notes: optionalText(1000),
});
/** Założenie szkicu po walidacji. */
export type CreateBudgetDraftRequest = z.infer<typeof CreateBudgetDraftRequestSchema>;

/** Zmiana notatki szkicu — `PATCH /budget-drafts/:month`. */
export const UpdateBudgetDraftRequestSchema = z.object({ notes: optionalText(1000) });

/** Pola linii wspólne dla dodania i zmiany. */
const BudgetLineFieldsSchema = z.object({
  flow: BudgetLineFlowSchema,
  name: LineNameSchema,
  amountMinor: AmountMinorSchema,
  categoryId: IdSchema.nullish(),
  incomeSourceId: IdSchema.nullish(),
  goalId: IdSchema.nullish(),
  dueOn: DateOnlySchema.nullish(),
  averageMonths: AverageMonthsSchema.nullish(),
  notes: optionalText(1000),
  /** Grupa sekcji linii (I-25); `null` — „Bez grupy". */
  groupId: IdSchema.nullish(),
});

/**
 * Nowa linia własna. Kształt (I-21, I-23 bez rodzaju kategorii) sprawdzany tu;
 * datę w miesiącu i rodzaj kategorii sprawdza serwis — zna miesiąc i kategorie.
 */
export const CreateBudgetLineRequestSchema = BudgetLineFieldsSchema.superRefine((value, ctx) => {
  const issues = budgetLineIssues(
    {
      flow: value.flow,
      amountMinor: value.amountMinor,
      categoryId: value.categoryId ?? null,
      incomeSourceId: value.incomeSourceId ?? null,
      goalId: value.goalId ?? null,
      dueOn: value.dueOn ?? null,
    },
    null,
  );
  for (const issue of issues) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
  }
});
/** Nowa linia po walidacji. */
export type CreateBudgetLineRequest = z.infer<typeof CreateBudgetLineRequestSchema>;

/**
 * Zmiana linii — każde pole opcjonalne. `flow` niezmienny: wydatek przerobiony na
 * oszczędności to inna linia. Kształt po scaleniu sprawdza serwis.
 */
export const UpdateBudgetLineRequestSchema = BudgetLineFieldsSchema.omit({ flow: true })
  .partial()
  .extend({
    isExcluded: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  });
/** Zmiana linii po walidacji. */
export type UpdateBudgetLineRequest = z.infer<typeof UpdateBudgetLineRequestSchema>;

/**
 * Zamiana linii w byt (07 §13.6). Pola reguły i planowanego wydatku jak w ich własnych
 * formularzach (§11, §11a), bez nazwy, kwoty i kategorii — te idą z linii.
 * `startMonth` reguły to zawsze miesiąc szkicu.
 */
export const PromoteBudgetLineRequestSchema = z.discriminatedUnion('target', [
  z.object({
    target: z.literal('recurring'),
    frequency: FrequencySchema.default('monthly'),
    intervalCount: z.number().int().min(1).max(24).default(1),
    dayOfMonth: z.number().int().min(1).max(31).nullish(),
    weekday: z.number().int().min(0).max(6).nullish(),
    monthOfYear: z.number().int().min(1).max(12).nullish(),
    endMonth: MonthKeySchema.nullish(),
    accountId: IdSchema,
    /** Wymagane dla linii savings/investment (przelew). */
    counterAccountId: IdSchema.nullish(),
    autoPost: z.boolean().default(false),
    amountIsEstimate: z.boolean().default(false),
    isFixedExpense: z.boolean().default(true),
  }),
  z.object({
    target: z.literal('planned'),
    /** Domyślnie miesiąc szkicu. */
    dueMonth: MonthKeySchema.optional(),
    dueOn: DateOnlySchema.nullish(),
    priority: PlannedExpensePrioritySchema.default('should'),
    amountIsEstimate: z.boolean().default(true),
    accountId: IdSchema.nullish(),
    setAsideEnabled: z.boolean().default(false),
    setAsideAccountId: IdSchema.nullish(),
    setAsideGoalId: IdSchema.nullish(),
    alreadySetAsideMinor: NonNegativeAmountMinorSchema.default(0),
    repeatsYearly: z.boolean().default(false),
  }),
]);
/** Zamiana linii po walidacji. */
export type PromoteBudgetLineRequest = z.infer<typeof PromoteBudgetLineRequestSchema>;

/** Wynik zamiany linii. */
export const PromoteBudgetLineResultSchema = z.object({
  draft: BudgetDraftDtoSchema,
  created: z.object({
    kind: z.enum(['recurring_rule', 'planned_expense']),
    id: IdSchema,
  }),
  /** Miesiąc, do którego przeniosła się linia (planowany wydatek z innym terminem). */
  lineMovedTo: MonthKeySchema.nullable(),
});
/** Wynik zamiany linii. */
export type PromoteBudgetLineResult = z.infer<typeof PromoteBudgetLineResultSchema>;

/** Wynik „Zastosuj w źródle" (07 §13.7). */
export const ApplyToSourceResultSchema = z.object({
  draft: BudgetDraftDtoSchema,
  effect: z.object({
    kind: z.enum(['rule_updated', 'rule_split', 'planned_updated', 'goal_updated']),
    previousAmountMinor: AmountMinorSchema,
    newAmountMinor: AmountMinorSchema,
    fromMonth: MonthKeySchema,
    newRuleId: IdSchema.nullable(),
  }),
});
/** Wynik „Zastosuj w źródle". */
export type ApplyToSourceResult = z.infer<typeof ApplyToSourceResultSchema>;

/** Nazwa grupy (I-25). */
const GroupNameSchema = z
  .string()
  .trim()
  .min(1, 'Nazwa jest wymagana')
  .max(BUDGET_GROUP_NAME_MAX, `Nazwa może mieć najwyżej ${String(BUDGET_GROUP_NAME_MAX)} znaków`);

/** Lista identyfikatorów linii w układzie — bez powtórzeń sprawdza serwis. */
const LineIdsSchema = z.array(IdSchema).max(200, 'Najwyżej 200 pozycji');

/** Nowa grupa — `POST /budget-drafts/:month/groups` (04 §14a). */
export const CreateBudgetGroupRequestSchema = z.object({
  section: BudgetSectionSchema,
  name: GroupNameSchema,
  /** Linie przenoszone do nowej grupy, w tej kolejności (np. „Cofnij" usunięcia grupy). */
  lineIds: LineIdsSchema.default([]),
  /** Miejsce wśród grup sekcji, od 0; domyślnie na końcu. */
  position: z.number().int().min(0).optional(),
});
/** Nowa grupa po walidacji. */
export type CreateBudgetGroupRequest = z.infer<typeof CreateBudgetGroupRequestSchema>;

/** Zmiana nazwy grupy — `PATCH /budget-drafts/:month/groups/:groupId`. */
export const UpdateBudgetGroupRequestSchema = z.object({ name: GroupNameSchema });
/** Zmiana nazwy grupy po walidacji. */
export type UpdateBudgetGroupRequest = z.infer<typeof UpdateBudgetGroupRequestSchema>;

/** Szybki start — `POST /budget-drafts/:month/groups/by-origin` (07 §13.10). */
export const GroupBudgetByOriginRequestSchema = z.object({ section: BudgetSectionSchema });
/** Szybki start po walidacji. */
export type GroupBudgetByOriginRequest = z.infer<typeof GroupBudgetByOriginRequestSchema>;

/**
 * Pełny układ jednej sekcji — `PATCH /budget-drafts/:month/layout` (07 §13.10).
 * Każda grupa sekcji i każda niewykluczona linia sekcji dokładnie raz.
 */
export const UpdateBudgetLayoutRequestSchema = z.object({
  section: BudgetSectionSchema,
  groups: z.array(z.object({ id: IdSchema, lineIds: LineIdsSchema })).max(50, 'Najwyżej 50 grup'),
  ungroupedLineIds: LineIdsSchema,
});
/** Układ sekcji po walidacji. */
export type UpdateBudgetLayoutRequest = z.infer<typeof UpdateBudgetLayoutRequestSchema>;

/** Parametry ścieżki grupy. */
export const BudgetGroupParamsSchema = z.object({ monthKey: MonthKeySchema, groupId: IdSchema });

/** Parametry ścieżki linii. */
export const BudgetLineParamsSchema = z.object({ monthKey: MonthKeySchema, lineId: IdSchema });

/** Zapytanie o średnie — `GET /budget-drafts/averages?months=`. */
export const CategoryAveragesQuerySchema = z.object({
  months: z.coerce.number().pipe(AverageMonthsSchema).default(3),
});

/** Średnie miesięczne kategorii wydatków (07 §13.3). */
export const CategoryAveragesDtoSchema = z.object({
  months: AverageMonthsSchema,
  window: z.object({ from: MonthKeySchema, to: MonthKeySchema }),
  monthsWithData: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      categoryId: IdSchema,
      name: z.string(),
      icon: z.string().nullable(),
      /** Zaokrąglone w górę do pełnego złotego. */
      averageMinor: NonNegativeAmountMinorSchema,
      byMonth: z.array(
        z.object({ month: MonthKeySchema, amountMinor: NonNegativeAmountMinorSchema }),
      ),
    }),
  ),
});
/** Średnie kategorii. */
export type CategoryAveragesDto = z.infer<typeof CategoryAveragesDtoSchema>;

/**
 * Sekcja `budget` podsumowania miesiąca — `GET /months/:key/summary` (04 §14, `F9-8`).
 *
 * Zasila odnośnik do planu oglądanego miesiąca (baner podglądu przyszłości) i podpowiedź
 * „Zaplanuj …" na dashboardzie. Liczy ją `budgetService` (ADR-079); ekran niczego
 * tu nie wylicza — także tego, czy już czas podpowiadać.
 */
export const MonthBudgetSectionDtoSchema = z.object({
  month: MonthKeySchema,
  /** Czy oglądany miesiąc ma szkic. */
  hasDraft: z.boolean(),
  /** Czy dla oglądanego miesiąca da się założyć szkic (zakres 07 §13.1). */
  canCreate: z.boolean(),
  /** „Zostaje" ze szkicu oglądanego miesiąca; `null` bez szkicu. */
  leftoverMinor: AmountMinorSchema.nullable(),
  nextMonth: MonthKeySchema,
  nextMonthHasDraft: z.boolean(),
  /**
   * Pokazać „Zaplanuj {nextMonth}": oglądany miesiąc jest bieżący, trwa jego ostatni
   * tydzień (`BUDGET_SUGGEST_NEXT_DAYS`), a następny nie ma szkicu (06 §3.14).
   */
  suggestNextMonth: z.boolean(),
});
/** Sekcja `budget` podsumowania miesiąca. */
export type MonthBudgetSectionDto = z.infer<typeof MonthBudgetSectionDtoSchema>;
