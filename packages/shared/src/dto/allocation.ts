import { z } from 'zod';

import { AllocationKindSchema, AllocationStatusSchema } from '../domain/enums.js';
import {
  AmountMinorSchema,
  BpsSchema,
  IdSchema,
  MonthKeySchema,
  NonNegativeAmountMinorSchema,
  TimestampSchema,
} from '../domain/primitives.js';
import { monthsDiff } from '../utils/month.js';

/**
 * Kontrakty rozkładu docelowego
 * ([05 §10](../../../../plans/05-dto-contracts.md#10-rozkład-docelowy--dtoallocationdtots),
 * `F5-3`, ADR-053). Porównanie plan/wykonanie liczy `shared/domain/allocation-status.ts`
 * (07 §2.4–§2.7).
 */

/** Udział jednej puli w planie: 0–100% wpływów. Suma może przekroczyć 100% (07 §2.7). */
const TargetShareSchema = BpsSchema.max(10_000, 'Udział nie może przekraczać 100% wpływów');

/** Założony rozkład procentowy obowiązujący od danego miesiąca (wymaganie #8). */
export const AllocationTargetDtoSchema = z.object({
  id: IdSchema,
  effectiveFromMonth: MonthKeySchema,
  savingsPercentBps: BpsSchema,
  investmentPercentBps: BpsSchema,
  debtPercentBps: BpsSchema,
  note: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
/** Rozkład docelowy. */
export type AllocationTargetDto = z.infer<typeof AllocationTargetDtoSchema>;

/** Ustawienie rozkładu od wskazanego miesiąca (`PUT /allocation/target`). */
export const UpsertAllocationTargetRequestSchema = z.object({
  effectiveFromMonth: MonthKeySchema,
  savingsPercentBps: TargetShareSchema,
  investmentPercentBps: TargetShareSchema,
  debtPercentBps: TargetShareSchema.default(0),
  note: z
    .string()
    .trim()
    .max(200, 'Notatka może mieć najwyżej 200 znaków')
    .nullish()
    .transform((value) => (value === '' ? null : value)),
});
/** Ustawienie rozkładu po walidacji. */
export type UpsertAllocationTargetRequest = z.infer<typeof UpsertAllocationTargetRequestSchema>;
/** Ustawienie rozkładu tak, jak wysyła je klient. */
export type UpsertAllocationTargetInput = z.input<typeof UpsertAllocationTargetRequestSchema>;

/** Ostrzeżenia zapisu rozkładu — zapis przechodzi, UI ostrzega (07 §2.7). */
export const AllocationWarningSchema = z.enum(['ALLOCATION_EXCEEDS_INCOME']);

/** Metadane zapisu rozkładu. */
export const AllocationTargetMetaSchema = z.object({
  warning: AllocationWarningSchema.nullable(),
});
/** Metadane zapisu rozkładu. */
export type AllocationTargetMeta = z.infer<typeof AllocationTargetMetaSchema>;

/** Parametr miesiąca; pominięty — bieżący miesiąc gospodarstwa. */
export const AllocationMonthQuerySchema = z.object({ month: MonthKeySchema.optional() });
/** Parametr miesiąca po walidacji. */
export type AllocationMonthQuery = z.infer<typeof AllocationMonthQuerySchema>;

/** Jedna linia porównania plan/wykonanie. */
export const AllocationLineDtoSchema = z.object({
  kind: AllocationKindSchema,
  targetPercentBps: BpsSchema,
  targetAmountMinor: NonNegativeAmountMinorSchema,
  /** Wykonanie NETTO: wpłaty minus wypłaty. Ujemne, gdy w miesiącu sięgnięto do puli. */
  actualAmountMinor: AmountMinorSchema,
  /** Udział wykonania we wpływach; ujemny przy przewadze wypłat. */
  actualPercentBps: z.number().int(),
  /** Różnica wykonania względem planu; ujemna = brakuje. */
  deltaAmountMinor: AmountMinorSchema,
  deltaPercentBps: z.number().int(),
  /** Stopień realizacji: 10000 = plan wykonany w 100%; wartość ujemna = ubytek w puli. */
  fulfillmentBps: z.number().int(),
  status: AllocationStatusSchema,
});
/** Linia porównania. */
export type AllocationLineDto = z.infer<typeof AllocationLineDtoSchema>;

/** Stan realizacji celów procentowych w miesiącu — zasila kafel na ekranie głównym. */
export const AllocationStatusDtoSchema = z.object({
  month: MonthKeySchema,
  /** Od kiedy obowiązuje porównywany rozkład; `null` — rozkładu nie ustawiono. */
  effectiveFromMonth: MonthKeySchema.nullable(),
  incomeBaseMinor: NonNegativeAmountMinorSchema,
  /** Miesiąc trwa albo nie ma wpływów — procenty nie są ostateczne (07 §2.7). */
  isPartialMonth: z.boolean(),
  daysElapsed: z.number().int().nonnegative(),
  daysInMonth: z.number().int().positive(),
  lines: z.array(AllocationLineDtoSchema),
  totals: z.object({
    targetPercentBps: BpsSchema,
    actualPercentBps: z.number().int(),
    targetAmountMinor: NonNegativeAmountMinorSchema,
    actualAmountMinor: AmountMinorSchema,
    /** Ile jeszcze trzeba przelać, żeby domknąć plan miesiąca (07 §2.6). */
    shortfallMinor: NonNegativeAmountMinorSchema,
  }),
});
/** Stan realizacji rozkładu. */
export type AllocationStatusDto = z.infer<typeof AllocationStatusDtoSchema>;

/** Najdłuższy zakres trendu — dwa lata. */
export const ALLOCATION_TREND_MAX_MONTHS = 24;

/** Parametry `GET /allocation/trend`; pominięte — sześć miesięcy do bieżącego. */
export const AllocationTrendQuerySchema = z
  .object({ from: MonthKeySchema.optional(), to: MonthKeySchema.optional() })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'Początek zakresu nie może być po jego końcu',
    path: ['from'],
  })
  .refine(
    (value) =>
      !value.from || !value.to || monthsDiff(value.from, value.to) < ALLOCATION_TREND_MAX_MONTHS,
    { message: 'Zakres może mieć najwyżej 24 miesiące', path: ['to'] },
  );
/** Parametry trendu po walidacji. */
export type AllocationTrendQuery = z.infer<typeof AllocationTrendQuerySchema>;
