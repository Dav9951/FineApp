import { z } from 'zod';

import { LiabilityKindSchema } from '../domain/enums.js';
import {
  BpsSchema,
  CurrencySchema,
  DateOnlySchema,
  IdSchema,
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
 * Kontrakty zobowiązań
 * ([05 §8](../../../../plans/05-dto-contracts.md#8-zobowiązania--dtoliabilitydtots), `F4-4`,
 * ADR-047). Stan liczy `liabilityState` z `shared/domain/liability.ts` (07 §5.1).
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

/** Zobowiązanie wraz z wyliczonym stanem bieżącym. */
export const LiabilityDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  kind: LiabilityKindSchema,
  creditor: z.string().nullable(),
  currency: CurrencySchema,
  /** Punkt odniesienia: pozostało do spłaty na dzień `balanceAsOf`. */
  openingBalanceMinor: NonNegativeAmountMinorSchema,
  balanceAsOf: DateOnlySchema,
  /** Wyliczane: `openingBalanceMinor` minus raty zaksięgowane po `balanceAsOf`, nie mniej niż 0. */
  remainingMinor: NonNegativeAmountMinorSchema,
  paidSoFarMinor: NonNegativeAmountMinorSchema,
  monthlyPaymentMinor: PositiveAmountMinorSchema,
  installmentsTotal: z.number().int().nullable(),
  /** Okres spłaty podany na dzień `balanceAsOf` — informacyjnie, do formularza. */
  installmentsRemainingAtAsOf: z.number().int().nullable(),
  /** Wyliczane: `ceil(remainingMinor / monthlyPaymentMinor)`. */
  installmentsRemaining: z.number().int().min(0),
  /** Najbliższa rata do zapłaty; `null` — spłacone albo nieznany dzień płatności. */
  nextDueOn: DateOnlySchema.nullable(),
  projectedFinalPaymentOn: DateOnlySchema.nullable(),
  interestRateBps: BpsSchema.nullable(),
  paymentDay: z.number().int().min(1).max(31).nullable(),
  firstPaymentOn: DateOnlySchema.nullable(),
  paymentAccountId: IdSchema.nullable(),
  categoryId: IdSchema.nullable(),
  recurringRuleId: IdSchema.nullable(),
  /** Udział spłaconej części: 0 = nic, 10000 = spłacone w całości. */
  progressBps: BpsSchema,
  paidThisMonth: z.boolean(),
  /** Data ostatniej zaksięgowanej raty — „Zapłacono we wrześniu (10 wrz)" (06 §3.8). */
  lastPaymentOn: DateOnlySchema.nullable(),
  isActive: z.boolean(),
  notes: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
/** Zobowiązanie ze stanem. */
export type LiabilityDto = z.infer<typeof LiabilityDtoSchema>;

/** Szczegóły zobowiązania — z historią płatności. */
export const LiabilityDetailDtoSchema = LiabilityDtoSchema.extend({
  /** Raty zaksięgowane na zobowiązanie, od najnowszej; do 24 ostatnich. */
  payments: z.array(TransactionListItemDtoSchema),
});
/** Zobowiązanie z historią płatności. */
export type LiabilityDetailDto = z.infer<typeof LiabilityDetailDtoSchema>;

/**
 * Pola zobowiązania **bez** walidacji krzyżowej — ciało `POST /liabilities`
 * (jak przy transakcjach i regułach, ADR-035: reguły między polami → `422` z serwisu).
 */
export const LiabilityFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Nazwa jest wymagana')
    .max(60, 'Nazwa może mieć najwyżej 60 znaków'),
  kind: LiabilityKindSchema,
  creditor: optionalText(60),
  /** Pozostała kwota do spłaty na dzień `balanceAsOf` (wymaganie #2). */
  openingBalanceMinor: PositiveAmountMinorSchema,
  balanceAsOf: DateOnlySchema,
  monthlyPaymentMinor: PositiveAmountMinorSchema,
  installmentsTotal: z.number().int().positive().nullish(),
  installmentsRemainingAtAsOf: z.number().int().positive().nullish(),
  interestRateBps: BpsSchema.nullish(),
  paymentDay: z.number().int().min(1).max(31).nullish(),
  /**
   * Najbliższa rata wskazana wprost — spłata zaczyna się później albo rata z tego miesiąca
   * jest już zapłacona. Pominięta: pierwszy dzień płatności po `balanceAsOf` (ADR-068).
   */
  firstPaymentOn: DateOnlySchema.nullish(),
  paymentAccountId: IdSchema.nullish(),
  categoryId: IdSchema.nullish(),
  /** Gdy `true`, od razu powstaje reguła cykliczna na ratę (06 §3.8). */
  createRecurringRule: z.boolean().default(false),
  notes: optionalText(1000),
});
/** Nowe zobowiązanie po walidacji pól. */
export type CreateLiabilityRequest = z.infer<typeof LiabilityFieldsSchema>;
/** Nowe zobowiązanie tak, jak wysyła je klient. */
export type CreateLiabilityInput = z.input<typeof LiabilityFieldsSchema>;

/** Problem walidacji krzyżowej zobowiązania. */
export interface LiabilityIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Reguły między polami zobowiązania — wspólne dla formularza i serwisu.
 *
 * Reguła cykliczna na ratę potrzebuje konta, z którego płacić, i dnia płatności —
 * bez nich nie da się jej ani zapisać, ani zaksięgować.
 *
 * @param value - Pola zobowiązania (przy edycji — po scaleniu).
 * @param value.createRecurringRule - Czy tworzyć regułę na ratę.
 * @param value.paymentAccountId - Konto płatności.
 * @param value.paymentDay - Dzień płatności.
 * @param value.firstPaymentOn - Pierwsza rata.
 * @param value.balanceAsOf - Dzień punktu odniesienia.
 * @returns Lista problemów; pusta, gdy wszystko się zgadza.
 */
export function liabilityIssues(value: {
  readonly createRecurringRule?: boolean;
  readonly paymentAccountId?: string | null;
  readonly paymentDay?: number | null;
  readonly firstPaymentOn?: string | null;
  readonly balanceAsOf: string;
}): LiabilityIssue[] {
  const issues: LiabilityIssue[] = [];
  if (value.createRecurringRule === true) {
    if (!value.paymentAccountId) {
      issues.push({ path: 'paymentAccountId', message: 'Wybierz konto, z którego płacisz ratę' });
    }
    if (value.paymentDay == null) {
      issues.push({ path: 'paymentDay', message: 'Podaj dzień płatności raty' });
    }
  }
  if (value.firstPaymentOn != null && value.firstPaymentOn < value.balanceAsOf) {
    issues.push({
      path: 'firstPaymentOn',
      message: 'Pierwsza rata nie może być wcześniejsza niż dzień, na który podano kwotę',
    });
  }
  return issues;
}

/** Nowe zobowiązanie z walidacją krzyżową — schemat formularza. */
export const CreateLiabilityRequestSchema = LiabilityFieldsSchema.superRefine((value, ctx) => {
  for (const issue of liabilityIssues(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
  }
});

/**
 * Zmiana zobowiązania — każde pole opcjonalne, `null` czyści pole opcjonalne.
 *
 * Bez `createRecurringRule` (regułę zakłada się przy tworzeniu albo na ekranie pozycji
 * cyklicznych). `isActive: false` zamyka spłacone zobowiązanie.
 */
export const UpdateLiabilityRequestSchema = LiabilityFieldsSchema.omit({
  createRecurringRule: true,
})
  .partial()
  .extend({ isActive: z.boolean().optional() });
/** Zmiana zobowiązania po walidacji. */
export type UpdateLiabilityRequest = z.infer<typeof UpdateLiabilityRequestSchema>;

/** Filtr tak/nie w adresie: tylko dwa literały. */
const OptionalFlagSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

/** Parametry `GET /liabilities`. */
export const ListLiabilitiesQuerySchema = z.object({ isActive: OptionalFlagSchema });
/** Parametry listy zobowiązań po walidacji. */
export type ListLiabilitiesQuery = z.infer<typeof ListLiabilitiesQuerySchema>;

/** Korekta stanu zobowiązania do wartości z wyciągu bankowego (07 §5.2). */
export const RebaseLiabilityRequestSchema = z.object({
  remainingMinor: NonNegativeAmountMinorSchema,
  asOf: DateOnlySchema,
  note: optionalText(200),
});
/** Korekta stanu po walidacji. */
export type RebaseLiabilityRequest = z.infer<typeof RebaseLiabilityRequestSchema>;

/**
 * Zaksięgowanie raty — `POST /liabilities/:id/payments`. Puste ciało: rata z warunków
 * zobowiązania, dziś, z konta płatności.
 */
export const LiabilityPaymentRequestSchema = z.object({
  amountMinor: PositiveAmountMinorSchema.optional(),
  bookedOn: DateOnlySchema.optional(),
  accountId: IdSchema.optional(),
  notes: optionalText(1000),
});
/** Zaksięgowanie raty po walidacji. */
export type LiabilityPaymentRequest = z.infer<typeof LiabilityPaymentRequestSchema>;

/** Wynik zaksięgowania raty: zobowiązanie po zmianie i utworzona transakcja. */
export const LiabilityPaymentResultDtoSchema = z.object({
  liability: LiabilityDtoSchema,
  transaction: TransactionDtoSchema,
});
/** Wynik zaksięgowania raty. */
export type LiabilityPaymentResultDto = z.infer<typeof LiabilityPaymentResultDtoSchema>;

/** Metadane zaksięgowania raty — miesiące do unieważnienia w cache frontu. */
export const LiabilityMutationMetaSchema = TransactionMutationMetaSchema;

/** Jedna rata prognozowanego harmonogramu — `GET /liabilities/:id/schedule`. */
export const ScheduledInstallmentDtoSchema = z.object({
  number: z.number().int().min(1),
  dueOn: DateOnlySchema,
  amountMinor: PositiveAmountMinorSchema,
  remainingAfterMinor: NonNegativeAmountMinorSchema,
});
/** Rata harmonogramu. */
export type ScheduledInstallmentDto = z.infer<typeof ScheduledInstallmentDtoSchema>;
