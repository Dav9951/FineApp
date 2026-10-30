import { z } from 'zod';

import {
  ContributionModeSchema,
  GoalKindSchema,
  GoalStatusSchema,
  ProgressSourceSchema,
} from '../domain/enums.js';
import { goalIssues } from '../domain/goal.js';
import {
  AmountMinorSchema,
  BpsSchema,
  DateOnlySchema,
  HexColorSchema,
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
 * Kontrakty celów
 * ([05 §9](../../../../plans/05-dto-contracts.md#9-cele--dtogoaldtots), `F5-1`, `F5-2`,
 * ADR-052). Postęp, plan i prognozę liczy `shared/domain/goal.ts` (07 §3, §4).
 */

/** Przeznaczenia celu — lista zamknięta, jak `CHECK` w tabeli `goals` (03 §3.9). */
export const GoalPurposeSchema = z.enum([
  'down_payment',
  'emergency_fund',
  'vacation',
  'car',
  'renovation',
  'retirement',
  'education',
  'custom',
]);
/** Przeznaczenie celu. */
export type GoalPurpose = z.infer<typeof GoalPurposeSchema>;

/** Plan wpłat na cel wraz z przeliczeniem na procent wpływów miesiąca. */
export const GoalContributionDtoSchema = z.object({
  mode: ContributionModeSchema,
  /** Kwota planowana na miesiąc — dla trybu procentowego wyliczona z wpływów. */
  plannedAmountMinor: NonNegativeAmountMinorSchema.nullable(),
  /** Udział planowanej kwoty we wpływach miesiąca — druga strona przelicznika. */
  plannedPercentBps: BpsSchema.nullable(),
  /** Wpłaty netto w miesiącu; ujemne, gdy z celu wypłacono więcej, niż wpłacono. */
  contributedThisMonthMinor: AmountMinorSchema,
  /** Wpłacono co najmniej plan; `false` bez planu (tryb `none`). */
  isPlanMetThisMonth: z.boolean(),
});
/** Plan wpłat na cel w miesiącu. */
export type GoalContributionDto = z.infer<typeof GoalContributionDtoSchema>;

/** Prognoza dojścia do celu przy bieżącym tempie wpłat (07 §4.2). */
export const GoalProjectionDtoSchema = z.object({
  /** Tempo, na którym stoi prognoza: średnia z historii albo plan (07 §4.2). */
  paceMonthlyMinor: AmountMinorSchema.nullable(),
  monthsToTargetAtCurrentPace: z.number().int().nonnegative().nullable(),
  projectedCompletionMonth: MonthKeySchema.nullable(),
  /** Ile trzeba wpłacać miesięcznie, żeby zdążyć na `targetDate`. */
  requiredMonthlyToHitTargetDateMinor: NonNegativeAmountMinorSchema.nullable(),
  isOnTrack: z.boolean().nullable(),
});
/** Prognoza celu. */
export type GoalProjectionDto = z.infer<typeof GoalProjectionDtoSchema>;

/** Cel z wyliczonym postępem, planem miesiąca i prognozą. */
export const GoalDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  kind: GoalKindSchema,
  purpose: GoalPurposeSchema.nullable(),
  targetAmountMinor: PositiveAmountMinorSchema.nullable(),
  targetDate: DateOnlySchema.nullable(),
  startingAmountMinor: NonNegativeAmountMinorSchema,
  linkedAccountId: IdSchema.nullable(),
  progressSource: ProgressSourceSchema,
  /** Zapisana strona przelicznika — druga jest w `contribution` (07 §3). */
  contributionAmountMinor: PositiveAmountMinorSchema.nullable(),
  contributionPercentBps: BpsSchema.nullable(),
  currentAmountMinor: NonNegativeAmountMinorSchema,
  /** Postęp względem `targetAmountMinor`; `null` dla celów bez kwoty docelowej. */
  progressBps: BpsSchema.nullable(),
  remainingMinor: NonNegativeAmountMinorSchema.nullable(),
  contribution: GoalContributionDtoSchema,
  projection: GoalProjectionDtoSchema,
  priority: z.number().int(),
  color: HexColorSchema.nullable(),
  icon: z.string().nullable(),
  status: GoalStatusSchema,
  achievedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
/** Cel z postępem. */
export type GoalDto = z.infer<typeof GoalDtoSchema>;

/** Wpłaty netto na cel w jednym miesiącu — historia tempa (07 §4.2). */
export const GoalMonthlyContributionDtoSchema = z.object({
  month: MonthKeySchema,
  amountMinor: AmountMinorSchema,
});
/** Wpłaty na cel w miesiącu. */
export type GoalMonthlyContributionDto = z.infer<typeof GoalMonthlyContributionDtoSchema>;

/** Szczegóły celu — z historią wpłat. */
export const GoalDetailDtoSchema = GoalDtoSchema.extend({
  /** Przelewy oznaczone celem, od najnowszego; do 24 ostatnich. */
  contributions: z.array(TransactionListItemDtoSchema),
  /** Wpłaty netto z ostatnich sześciu miesięcy (z bieżącym), rosnąco — podstawa tempa. */
  history: z.array(GoalMonthlyContributionDtoSchema),
});
/** Cel z historią wpłat. */
export type GoalDetailDto = z.infer<typeof GoalDetailDtoSchema>;

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

/**
 * Pola celu **bez** walidacji krzyżowej — ciało `POST /goals` (jak przy transakcjach,
 * ADR-035: reguły między polami → `422` z serwisu, `goalIssues`).
 */
export const GoalFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Nazwa jest wymagana')
    .max(60, 'Nazwa może mieć najwyżej 60 znaków'),
  kind: GoalKindSchema,
  purpose: GoalPurposeSchema.nullish(),
  targetAmountMinor: PositiveAmountMinorSchema.nullish(),
  targetDate: DateOnlySchema.nullish(),
  /** Kwota zgromadzona **przed** wdrożeniem aplikacji. */
  startingAmountMinor: NonNegativeAmountMinorSchema.default(0),
  linkedAccountId: IdSchema.nullish(),
  progressSource: ProgressSourceSchema.default('contributions'),
  contributionMode: ContributionModeSchema.default('fixed'),
  contributionAmountMinor: PositiveAmountMinorSchema.nullish(),
  contributionPercentBps: BpsSchema.nullish(),
  color: HexColorSchema.nullish(),
  icon: optionalText(40),
});
/** Nowy cel po walidacji pól. */
export type CreateGoalRequest = z.infer<typeof GoalFieldsSchema>;
/** Nowy cel tak, jak wysyła go klient. */
export type CreateGoalInput = z.input<typeof GoalFieldsSchema>;

/** Nowy cel z walidacją krzyżową (I-14) — schemat formularza. */
export const CreateGoalRequestSchema = GoalFieldsSchema.superRefine((value, ctx) => {
  for (const issue of goalIssues(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
  }
});

/** Stany, które da się ustawić edycją; `achieved` — przez `/complete` albo sam serwis. */
export const EditableGoalStatusSchema = z.enum(['active', 'paused', 'archived']);

/**
 * Zmiana celu — każde pole opcjonalne, `null` czyści pole opcjonalne. Bez domyślnych
 * wartości z pól tworzenia: pominięte pole zostaje, jakie było.
 */
export const UpdateGoalRequestSchema = z
  .object({
    name: GoalFieldsSchema.shape.name,
    kind: GoalKindSchema,
    purpose: GoalPurposeSchema.nullable(),
    targetAmountMinor: PositiveAmountMinorSchema.nullable(),
    targetDate: DateOnlySchema.nullable(),
    startingAmountMinor: NonNegativeAmountMinorSchema,
    linkedAccountId: IdSchema.nullable(),
    progressSource: ProgressSourceSchema,
    contributionMode: ContributionModeSchema,
    contributionAmountMinor: PositiveAmountMinorSchema.nullable(),
    contributionPercentBps: BpsSchema.nullable(),
    color: HexColorSchema.nullable(),
    icon: optionalText(40),
    status: EditableGoalStatusSchema,
  })
  .partial();
/** Zmiana celu po walidacji. */
export type UpdateGoalRequest = z.infer<typeof UpdateGoalRequestSchema>;

/** Filtr tak/nie w adresie: tylko dwa literały. */
const OptionalFlagSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

/** Parametry `GET /goals` (04 §10). */
export const ListGoalsQuerySchema = z.object({
  /** Miesiąc planu wpłat; pominięty — bieżący. */
  month: MonthKeySchema.optional(),
  kind: GoalKindSchema.optional(),
  /** Czy pokazać zarchiwizowane; domyślnie nie. */
  includeArchived: OptionalFlagSchema,
});
/** Parametry listy celów po walidacji. */
export type ListGoalsQuery = z.infer<typeof ListGoalsQuerySchema>;

/** Metadane listy celów — podstawa przelicznika i suma planu miesiąca (06 §3.5). */
export const GoalsListMetaSchema = z.object({
  month: MonthKeySchema,
  /** Podstawa, względem której przeliczono plany procentowe. */
  incomeBaseMinor: NonNegativeAmountMinorSchema,
  /** Miesiąc trwa — plan procentowy „na podstawie dotychczasowych wpływów" (07 §3). */
  isPartialMonth: z.boolean(),
  /** „Zaplanowano": suma planów celów aktywnych. */
  plannedTotalMinor: NonNegativeAmountMinorSchema,
  /** „Wpłacono": suma wpłat netto na cele aktywne. */
  contributedTotalMinor: AmountMinorSchema,
});
/** Metadane listy celów. */
export type GoalsListMeta = z.infer<typeof GoalsListMetaSchema>;

/**
 * Wpłata na cel — skrót tworzący przelew z `goalId` (04 §10).
 *
 * Konto docelowe domyślnie powiązane z celem. Idempotencję zapewnia `Idempotency-Key`.
 */
export const GoalContributionRequestSchema = z.object({
  amountMinor: PositiveAmountMinorSchema,
  fromAccountId: IdSchema,
  /** Pominięte — konto powiązane z celem. */
  toAccountId: IdSchema.nullish(),
  /** Pominięte — dziś. */
  bookedOn: DateOnlySchema.optional(),
  notes: optionalText(1000),
});
/** Wpłata na cel po walidacji. */
export type GoalContributionRequest = z.infer<typeof GoalContributionRequestSchema>;

/** Wynik wpłaty: cel po wpłacie i utworzony przelew. */
export const GoalContributionResultDtoSchema = z.object({
  goal: GoalDtoSchema,
  transaction: TransactionDtoSchema,
});
/** Wynik wpłaty na cel. */
export type GoalContributionResultDto = z.infer<typeof GoalContributionResultDtoSchema>;

/** Metadane wpłaty — miesiące do unieważnienia, jak przy zapisie transakcji. */
export const GoalMutationMetaSchema = TransactionMutationMetaSchema;

/** Nowa kolejność celów: identyfikatory od najważniejszego (`PATCH /goals/order`). */
export const ReorderGoalsRequestSchema = z.object({
  ids: z.array(IdSchema).min(1).max(200),
});
/** Nowa kolejność celów. */
export type ReorderGoalsRequest = z.infer<typeof ReorderGoalsRequestSchema>;

/**
 * Żądanie przelicznika % ↔ kwota (wymaganie #6, 07 §3).
 *
 * Dokładnie jedno z pól `amountMinor` / `percentBps` musi być podane — drugie zostanie
 * wyliczone względem podstawy wpływów wskazanego miesiąca.
 */
export const ConvertContributionRequestSchema = z
  .object({
    month: MonthKeySchema,
    amountMinor: PositiveAmountMinorSchema.optional(),
    percentBps: BpsSchema.optional(),
  })
  .refine((value) => (value.amountMinor == null) !== (value.percentBps == null), {
    message: 'Podaj dokładnie jedno: kwotę albo procent',
  });
/** Żądanie przelicznika po walidacji. */
export type ConvertContributionRequest = z.infer<typeof ConvertContributionRequestSchema>;

/** Wynik przelicznika — obie strony i podstawa. */
export const ConvertContributionResponseSchema = z.object({
  month: MonthKeySchema,
  /** Suma przychodów miesiąca ze źródeł oznaczonych `countsTowardAllocation`. */
  incomeBaseMinor: NonNegativeAmountMinorSchema,
  amountMinor: NonNegativeAmountMinorSchema,
  percentBps: BpsSchema,
  /** `true`, gdy miesiąc jeszcze trwa — podstawa może wzrosnąć. */
  isPartialMonth: z.boolean(),
  /** Wynik liczony z dotychczasowych wpływów — UI dopisuje zastrzeżenie. */
  basedOnIncomeSoFar: z.boolean(),
});
/** Wynik przelicznika. */
export type ConvertContributionResponse = z.infer<typeof ConvertContributionResponseSchema>;
