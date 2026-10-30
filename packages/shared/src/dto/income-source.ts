import { z } from 'zod';

import { IncomeSourceKindSchema } from '../domain/enums.js';
import { IdSchema } from '../domain/primitives.js';

/**
 * Kontrakty źródeł przychodu
 * ([05 §6a](../../../../plans/05-dto-contracts.md#6a-źródła-przychodu--dtoincome-sourcets)).
 */

/** Źródło przychodu — wymaganie #10. */
export const IncomeSourceDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  kind: IncomeSourceKindSchema,
  /** Czyje to źródło (np. czyja pensja); `null` = wspólne. */
  ownerUserId: IdSchema.nullable(),
  /** Czy przychód z tego źródła wchodzi do podstawy celów procentowych (07 §2.3). */
  countsTowardAllocation: z.boolean(),
  isArchived: z.boolean(),
  sortOrder: z.number().int(),
});
/** Źródło przychodu. */
export type IncomeSourceDto = z.infer<typeof IncomeSourceDtoSchema>;

/** Nazwa źródła — przycięta, niepusta. */
const IncomeSourceNameSchema = z
  .string()
  .trim()
  .min(1, 'Nazwa jest wymagana')
  .max(60, 'Nazwa może mieć najwyżej 60 znaków');

/** Dane nowego źródła przychodu. */
export const CreateIncomeSourceRequestSchema = z.object({
  name: IncomeSourceNameSchema,
  kind: IncomeSourceKindSchema,
  ownerUserId: IdSchema.nullish(),
  /** Pominięte — wynika z `kind` (`defaultCountsTowardAllocation`). */
  countsTowardAllocation: z.boolean().optional(),
});
/** Dane nowego źródła po walidacji. */
export type CreateIncomeSourceRequest = z.infer<typeof CreateIncomeSourceRequestSchema>;

/**
 * Zmiana źródła — każde pole opcjonalne; `ownerUserId: null` = źródło wspólne.
 *
 * Zmiana `kind` **nie** przelicza `countsTowardAllocation`: to pole użytkownik widzi
 * i ustawia jawnie (04 §12), więc cicha zmiana przy okazji byłaby zaskoczeniem.
 */
export const UpdateIncomeSourceRequestSchema = z.object({
  name: IncomeSourceNameSchema.optional(),
  kind: IncomeSourceKindSchema.optional(),
  ownerUserId: IdSchema.nullish(),
  countsTowardAllocation: z.boolean().optional(),
});
/** Zmiana źródła po walidacji. */
export type UpdateIncomeSourceRequest = z.infer<typeof UpdateIncomeSourceRequestSchema>;

/** `?includeArchived=true|false` — bez `z.coerce.boolean()` (ADR-031). */
export const ListIncomeSourcesQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
/** Parametry listy źródeł po walidacji. */
export type ListIncomeSourcesQuery = z.infer<typeof ListIncomeSourcesQuerySchema>;
