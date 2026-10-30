import { z } from 'zod';

import { PlannedExpensePrioritySchema, PlannedExpenseStatusSchema } from '../domain/enums.js';
import { plannedExpenseIssues } from '../domain/planned-expense.js';
import {
  BpsSchema,
  CurrencySchema,
  DateOnlySchema,
  IdSchema,
  MonthKeySchema,
  NonNegativeAmountMinorSchema,
  PositiveAmountMinorSchema,
  TimestampSchema,
} from '../domain/primitives.js';
import {
  TransactionDtoSchema,
  TransactionListItemDtoSchema,
  TransactionMutationMetaSchema,
} from './transaction.js';

/**
 * Kontrakty planowanych wydatków
 * ([05 §11a](../../../../plans/05-dto-contracts.md#11a-planowane-wydatki--dtoplanned-expensedtots),
 * `F6-1`…`F6-5`, ADR-055). Wyliczenia: `shared/domain/planned-expense.ts` (07 §6.5).
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

/** Stan odkładania na planowany wydatek (sinking fund). */
export const SetAsideDtoSchema = z.object({
  enabled: z.boolean(),
  accountId: IdSchema.nullable(),
  goalId: IdSchema.nullable(),
  startMonth: MonthKeySchema,
  /** Kwota zebrana: wpłaty oznaczone tym wydatkiem + kwota zebrana poza aplikacją. */
  accumulatedMinor: NonNegativeAmountMinorSchema,
  remainingMinor: NonNegativeAmountMinorSchema,
  /** Pokrycie szacunku: 10000 = odłożone w całości. */
  coverageBps: BpsSchema,
  /** Ile odkładać miesięcznie, żeby zdążyć — wyliczane przy każdym odczycie. */
  monthlyRequiredMinor: NonNegativeAmountMinorSchema,
  /** Pełne miesiące do terminu z bieżącym — „przez 9 mies." w formularzu. */
  monthsLeft: z.number().int().positive(),
  paidThisMonth: z.boolean(),
  isOnTrack: z.boolean(),
});
/** Stan odkładania. */
export type SetAsideDto = z.infer<typeof SetAsideDtoSchema>;

/** Większy wydatek zaplanowany na przyszłość (wymaganie #13). */
export const PlannedExpenseDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  estimatedAmountMinor: PositiveAmountMinorSchema,
  amountIsEstimate: z.boolean(),
  currency: CurrencySchema,
  dueMonth: MonthKeySchema,
  dueOn: DateOnlySchema.nullable(),
  /** Pełne miesiące do terminu; 0 = wypada w tym miesiącu, ujemne = zaległy. */
  monthsUntilDue: z.number().int(),
  categoryId: IdSchema.nullable(),
  categoryName: z.string().nullable(),
  accountId: IdSchema.nullable(),
  liabilityId: IdSchema.nullable(),
  priority: PlannedExpensePrioritySchema,
  status: PlannedExpenseStatusSchema,
  setAside: SetAsideDtoSchema,
  alreadySetAsideMinor: NonNegativeAmountMinorSchema,
  repeatsYearly: z.boolean(),
  previousInstanceId: IdSchema.nullable(),
  transactionId: IdSchema.nullable(),
  postedAmountMinor: PositiveAmountMinorSchema.nullable(),
  postedAt: TimestampSchema.nullable(),
  notes: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
/** Planowany wydatek. */
export type PlannedExpenseDto = z.infer<typeof PlannedExpenseDtoSchema>;

/** Szczegóły — z historią odkładania. */
export const PlannedExpenseDetailDtoSchema = PlannedExpenseDtoSchema.extend({
  /** Przelewy oznaczone wydatkiem, od najnowszego; do 24. */
  setAsideHistory: z.array(TransactionListItemDtoSchema),
});
/** Planowany wydatek z historią odkładania. */
export type PlannedExpenseDetailDto = z.infer<typeof PlannedExpenseDetailDtoSchema>;

/**
 * Pola wydatku **bez** walidacji krzyżowej — ciało `POST /planned-expenses` (ADR-035:
 * reguły między polami → `422` z serwisu).
 */
export const PlannedExpenseFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Nazwa jest wymagana')
    .max(60, 'Nazwa może mieć najwyżej 60 znaków'),
  estimatedAmountMinor: PositiveAmountMinorSchema,
  amountIsEstimate: z.boolean().default(true),
  dueMonth: MonthKeySchema,
  dueOn: DateOnlySchema.nullish(),
  categoryId: IdSchema.nullish(),
  accountId: IdSchema.nullish(),
  liabilityId: IdSchema.nullish(),
  priority: PlannedExpensePrioritySchema.default('should'),
  setAsideEnabled: z.boolean().default(false),
  setAsideAccountId: IdSchema.nullish(),
  setAsideGoalId: IdSchema.nullish(),
  /** Pominięty — bieżący miesiąc. */
  setAsideStartMonth: MonthKeySchema.nullish(),
  alreadySetAsideMinor: NonNegativeAmountMinorSchema.default(0),
  repeatsYearly: z.boolean().default(false),
  notes: optionalText(1000),
});
/** Nowy wydatek po walidacji pól. */
export type CreatePlannedExpenseRequest = z.infer<typeof PlannedExpenseFieldsSchema>;
/** Nowy wydatek tak, jak wysyła go klient. */
export type CreatePlannedExpenseInput = z.input<typeof PlannedExpenseFieldsSchema>;

/** Nowy wydatek z walidacją krzyżową (I-16, I-17, I-19) — schemat formularza. */
export const CreatePlannedExpenseRequestSchema = PlannedExpenseFieldsSchema.superRefine(
  (value, ctx) => {
    for (const issue of plannedExpenseIssues(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
    }
  },
);

/**
 * Zmiana wydatku — każde pole opcjonalne, `null` czyści pole opcjonalne; bez wartości
 * domyślnych, żeby pominięte pole zostało, jakie było.
 */
export const UpdatePlannedExpenseRequestSchema = z
  .object({
    name: PlannedExpenseFieldsSchema.shape.name,
    estimatedAmountMinor: PositiveAmountMinorSchema,
    amountIsEstimate: z.boolean(),
    dueMonth: MonthKeySchema,
    dueOn: DateOnlySchema.nullable(),
    categoryId: IdSchema.nullable(),
    accountId: IdSchema.nullable(),
    liabilityId: IdSchema.nullable(),
    priority: PlannedExpensePrioritySchema,
    setAsideEnabled: z.boolean(),
    setAsideAccountId: IdSchema.nullable(),
    setAsideGoalId: IdSchema.nullable(),
    setAsideStartMonth: MonthKeySchema,
    alreadySetAsideMinor: NonNegativeAmountMinorSchema,
    repeatsYearly: z.boolean(),
    notes: optionalText(1000),
  })
  .partial();
/** Zmiana wydatku po walidacji. */
export type UpdatePlannedExpenseRequest = z.infer<typeof UpdatePlannedExpenseRequestSchema>;

/** Filtr wielokrotny statusu: `?status=funding&status=ready` albo jedna wartość. */
const StatusFilterSchema = z.union([
  z.array(PlannedExpenseStatusSchema).min(1).max(6),
  PlannedExpenseStatusSchema.transform((value) => [value]),
]);

/** Parametry `GET /planned-expenses` (04 §9a). */
export const ListPlannedExpensesQuerySchema = z.object({
  /** Pominięty — aktywne (`planned`, `funding`, `ready`, `deferred`). */
  status: StatusFilterSchema.optional(),
  from: MonthKeySchema.optional(),
  to: MonthKeySchema.optional(),
  priority: PlannedExpensePrioritySchema.optional(),
});
/** Parametry listy po walidacji. */
export type ListPlannedExpensesQuery = z.infer<typeof ListPlannedExpensesQuerySchema>;

/** Parametry `GET /planned-expenses/upcoming`. */
export const UpcomingPlannedExpensesQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
});
/** Parametry nadchodzących po walidacji. */
export type UpcomingPlannedExpensesQuery = z.infer<typeof UpcomingPlannedExpensesQuerySchema>;

/** Wpłata na odkładanie (`POST /:id/set-aside`). */
export const SetAsideContributionRequestSchema = z.object({
  /** Pominięte → rata wyliczona (`monthlyRequiredMinor`). */
  amountMinor: PositiveAmountMinorSchema.optional(),
  bookedOn: DateOnlySchema.optional(),
  /** Pominięte — konto płatności wydatku. */
  fromAccountId: IdSchema.optional(),
});
/** Wpłata na odkładanie po walidacji. */
export type SetAsideContributionRequest = z.infer<typeof SetAsideContributionRequestSchema>;

/** Zaksięgowanie wydatku (`POST /:id/post`) — pominięte pola z wydatku, data — dziś. */
export const PostPlannedExpenseRequestSchema = z.object({
  /** Rzeczywista kwota — zwykle różni się od szacunku. */
  amountMinor: PositiveAmountMinorSchema.optional(),
  bookedOn: DateOnlySchema.optional(),
  accountId: IdSchema.optional(),
  categoryId: IdSchema.nullish(),
  notes: optionalText(1000),
});
/** Zaksięgowanie wydatku po walidacji. */
export type PostPlannedExpenseRequest = z.infer<typeof PostPlannedExpenseRequestSchema>;

/** Przesunięcie terminu (`POST /:id/defer`). */
export const DeferPlannedExpenseRequestSchema = z.object({
  dueMonth: MonthKeySchema,
  dueOn: DateOnlySchema.nullish(),
});
/** Przesunięcie terminu po walidacji. */
export type DeferPlannedExpenseRequest = z.infer<typeof DeferPlannedExpenseRequestSchema>;

/** Wynik wpłaty na odkładanie. */
export const SetAsideResultDtoSchema = z.object({
  plannedExpense: PlannedExpenseDtoSchema,
  transaction: TransactionDtoSchema,
});
/** Wynik wpłaty na odkładanie. */
export type SetAsideResultDto = z.infer<typeof SetAsideResultDtoSchema>;

/** Wynik zaksięgowania wydatku — z instancją na kolejny rok, gdy powstała. */
export const PostPlannedExpenseResultDtoSchema = z.object({
  plannedExpense: PlannedExpenseDtoSchema,
  transaction: TransactionDtoSchema,
  nextInstance: PlannedExpenseDtoSchema.nullable(),
});
/** Wynik zaksięgowania wydatku. */
export type PostPlannedExpenseResultDto = z.infer<typeof PostPlannedExpenseResultDtoSchema>;

/** Metadane zapisów z transakcją — miesiące do unieważnienia. */
export const PlannedExpenseMutationMetaSchema = TransactionMutationMetaSchema;

/** Ostrzeżenie o płynności (07 §6.5). */
export const LiquidityWarningDtoSchema = z.object({
  month: MonthKeySchema,
  code: z.enum(['INSUFFICIENT_PROJECTED_BALANCE', 'UNFUNDED_MUST_EXPENSE', 'SET_ASIDE_BEHIND']),
  plannedExpenseId: IdSchema.nullable(),
  message: z.string(),
  gapMinor: NonNegativeAmountMinorSchema,
});
/** Ostrzeżenie o płynności. */
export type LiquidityWarningDto = z.infer<typeof LiquidityWarningDtoSchema>;

/** Obciążenie jednego miesiąca horyzontu. */
export const UpcomingMonthDtoSchema = z.object({
  month: MonthKeySchema,
  totalMinor: NonNegativeAmountMinorSchema,
  coveredMinor: NonNegativeAmountMinorSchema,
  shortfallMinor: NonNegativeAmountMinorSchema,
});

/** Prognoza obciążeń w horyzoncie — ekran i kafel „Nadchodzące". */
export const UpcomingExpensesMetaSchema = z.object({
  horizonMonths: z.number().int().positive(),
  totalUpcomingMinor: NonNegativeAmountMinorSchema,
  totalSetAsideMinor: NonNegativeAmountMinorSchema,
  /** Suma rat odkładania **wszystkich** aktywnych wydatków z odkładaniem, także za horyzontem. */
  monthlySetAsideRequiredMinor: NonNegativeAmountMinorSchema,
  /** Wpłaty na odkładanie w bieżącym miesiącu. */
  setAsidePaidThisMonthMinor: NonNegativeAmountMinorSchema,
  byMonth: z.array(UpcomingMonthDtoSchema),
  liquidityWarnings: z.array(LiquidityWarningDtoSchema),
});
/** Prognoza obciążeń. */
export type UpcomingExpensesMeta = z.infer<typeof UpcomingExpensesMetaSchema>;

/** Sekcja „Nadchodzące" podsumowania miesiąca (`F6-8`). */
export const MonthPlannedExpensesSectionDtoSchema = z.object({
  dueThisMonthMinor: NonNegativeAmountMinorSchema,
  upcoming6MonthsMinor: NonNegativeAmountMinorSchema,
  monthlySetAsideRequiredMinor: NonNegativeAmountMinorSchema,
  setAsidePaidThisMonthMinor: NonNegativeAmountMinorSchema,
  warningCount: z.number().int().nonnegative(),
  warnings: z.array(LiquidityWarningDtoSchema),
  /** Najbliższe wydatki (do trzech) — skrót na kafel. */
  items: z.array(PlannedExpenseDtoSchema),
  /** Wydatki `ready` do zapłaty — wiersze „Do zrobienia" z przyciskiem „Zapłacone". */
  readyToPay: z.array(PlannedExpenseDtoSchema),
});
/** Sekcja „Nadchodzące". */
export type MonthPlannedExpensesSectionDto = z.infer<typeof MonthPlannedExpensesSectionDtoSchema>;
