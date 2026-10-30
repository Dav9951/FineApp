import { z } from 'zod';

import {
  AllocationOverrideSchema,
  FrequencySchema,
  OccurrenceStatusSchema,
  TransactionTypeSchema,
  type TransactionType,
} from '../domain/enums.js';
import {
  CurrencySchema,
  DateOnlySchema,
  IdSchema,
  MonthKeySchema,
  NonNegativeAmountMinorSchema,
  PositiveAmountMinorSchema,
  TimestampSchema,
} from '../domain/primitives.js';
import {
  defaultAnchorDate,
  normalizeSchedule,
  recurringRuleShapeIssues,
  weekdayOf,
} from '../domain/recurring.js';
import {
  AllocationEffectDtoSchema,
  TransactionDtoSchema,
  TransactionMutationMetaSchema,
  type TransactionDto,
} from './transaction.js';

/**
 * Kontrakty reguł cyklicznych
 * ([05 §11](../../../../plans/05-dto-contracts.md#11-pozycje-cykliczne--dtorecurringdtots)).
 *
 * Wystąpienia (`RecurringOccurrenceDto`) od `F4-2`, księgowanie, pomijanie i cofanie
 * od `F4-3`.
 */

/** Reguła cykliczna — definicja powtarzalnej transakcji (wymagania #3 i #9). */
export const RecurringRuleDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  flow: TransactionTypeSchema,
  amountMinor: PositiveAmountMinorSchema,
  amountIsEstimate: z.boolean(),
  currency: CurrencySchema,
  accountId: IdSchema.nullable(),
  counterAccountId: IdSchema.nullable(),
  categoryId: IdSchema.nullable(),
  incomeSourceId: IdSchema.nullable(),
  goalId: IdSchema.nullable(),
  liabilityId: IdSchema.nullable(),
  /** Nadpisanie alokacji dziedziczone przez tworzone transakcje; `null` = wylicz z klas kont. */
  allocationOverride: AllocationOverrideSchema.nullable(),
  frequency: FrequencySchema,
  /** Co ile miesięcy — wyłącznie `every_n_months`; dla pozostałych `1`. */
  intervalCount: z.number().int().min(1),
  dayOfMonth: z.number().int().min(1).max(31).nullable(),
  /** 0 = niedziela … 6 = sobota. */
  weekday: z.number().int().min(0).max(6).nullable(),
  monthOfYear: z.number().int().min(1).max(12).nullable(),
  /** Pierwszy termin `biweekly`; dla pozostałych bez znaczenia. */
  anchorDate: DateOnlySchema,
  startMonth: MonthKeySchema,
  endMonth: MonthKeySchema.nullable(),
  autoPost: z.boolean(),
  isFixedExpense: z.boolean(),
  /** `false` — wstrzymana: nowe wystąpienia nie powstają (07 §6.4). */
  isActive: z.boolean(),
  notes: z.string().nullable(),
  /** Najbliższy termin od dziś (włącznie); `null`, gdy reguła wstrzymana albo zakończona. */
  nextDueOn: DateOnlySchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
/** Reguła cykliczna. */
export type RecurringRuleDto = z.infer<typeof RecurringRuleDtoSchema>;

/** Reguła z podglądem najbliższych terminów — `GET /recurring/rules/:id`. */
export const RecurringRuleDetailDtoSchema = RecurringRuleDtoSchema.extend({
  /** Do sześciu najbliższych terminów wyliczonych z terminarza (bez zapisu w bazie). */
  upcomingDueDates: z.array(DateOnlySchema),
});
/** Reguła z najbliższymi terminami. */
export type RecurringRuleDetailDto = z.infer<typeof RecurringRuleDetailDtoSchema>;

/** Opcjonalny tekst: przycięty, pusty zapisywany jako brak. */
const optionalNotes = z
  .string()
  .trim()
  .max(1000, 'Notatka może mieć najwyżej 1000 znaków')
  .nullish()
  .transform((value) => (value === '' ? null : value));

/**
 * Pola reguły **bez** walidacji krzyżowej — ciało `POST /recurring/rules`.
 *
 * Jak przy transakcjach (ADR-035): kształt (I-2, I-3, I-7a) i terminarz sprawdza serwis
 * i odpowiada `422`; `PATCH` i tak musi sprawdzać regułę po scaleniu z bieżącym stanem.
 * Formularz używa {@link CreateRecurringRuleRequestSchema}.
 */
export const RecurringRuleFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Nazwa jest wymagana')
    .max(60, 'Nazwa może mieć najwyżej 60 znaków'),
  flow: TransactionTypeSchema,
  amountMinor: PositiveAmountMinorSchema,
  /** Rachunek zmienny — przy księgowaniu formularz wymusi potwierdzenie kwoty (07 §6.5). */
  amountIsEstimate: z.boolean().default(false),
  accountId: IdSchema,
  counterAccountId: IdSchema.nullish(),
  categoryId: IdSchema.nullish(),
  incomeSourceId: IdSchema.nullish(),
  goalId: IdSchema.nullish(),
  liabilityId: IdSchema.nullish(),
  allocationOverride: AllocationOverrideSchema.nullish(),
  frequency: FrequencySchema,
  intervalCount: z.number().int().min(1).max(24).default(1),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
  weekday: z.number().int().min(0).max(6).nullish(),
  monthOfYear: z.number().int().min(1).max(12).nullish(),
  /** Pominięte → pierwszy wybrany dzień tygodnia miesiąca startu (`defaultAnchorDate`). */
  anchorDate: DateOnlySchema.optional(),
  startMonth: MonthKeySchema,
  endMonth: MonthKeySchema.nullish(),
  autoPost: z.boolean().default(false),
  isFixedExpense: z.boolean().default(false),
  notes: optionalNotes,
});
/** Nowa reguła po walidacji pól. */
export type CreateRecurringRuleRequest = z.infer<typeof RecurringRuleFieldsSchema>;
/** Nowa reguła tak, jak wysyła ją klient. */
export type CreateRecurringRuleInput = z.input<typeof RecurringRuleFieldsSchema>;

/** Reguła w pełnym kształcie: każde pole obecne, brak wartości jako `null`. */
export type NormalizedRecurringRule = {
  [K in keyof CreateRecurringRuleRequest]-?: Exclude<CreateRecurringRuleRequest[K], undefined>;
};

/**
 * Reguła w pełnym kształcie z pól żądania: puste pola jako `null`, domyślna kotwica,
 * terminarz sprowadzony do pól częstotliwości. Wspólne dla formularza i serwisu.
 *
 * @param value - Pola nowej reguły.
 * @returns Reguła gotowa do sprawdzenia i zapisu.
 */
export function recurringRuleFromRequest(
  value: CreateRecurringRuleRequest,
): NormalizedRecurringRule {
  const weekday = value.weekday ?? null;
  return normalizeSchedule({
    ...value,
    counterAccountId: value.counterAccountId ?? null,
    categoryId: value.categoryId ?? null,
    incomeSourceId: value.incomeSourceId ?? null,
    goalId: value.goalId ?? null,
    liabilityId: value.liabilityId ?? null,
    allocationOverride: value.allocationOverride ?? null,
    dayOfMonth: value.dayOfMonth ?? null,
    weekday,
    monthOfYear: value.monthOfYear ?? null,
    anchorDate:
      value.anchorDate ??
      defaultAnchorDate({ frequency: value.frequency, weekday, startMonth: value.startMonth }),
    endMonth: value.endMonth ?? null,
    notes: value.notes ?? null,
  });
}

/**
 * Nowa reguła z walidacją krzyżową — schemat formularza. Te same reguły co w serwisie.
 */
export const CreateRecurringRuleRequestSchema = RecurringRuleFieldsSchema.superRefine(
  (value, ctx) => {
    for (const issue of recurringRuleShapeIssues(recurringRuleFromRequest(value))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
    }
  },
);

/**
 * Zmiana reguły — każde pole opcjonalne, `null` czyści pole opcjonalne.
 *
 * `flow` jest niezmienny: reguła wydatku zamieniona w przelew miałaby w historii
 * wystąpienia innego typu niż ona sama. Kształt po scaleniu sprawdza serwis.
 */
export const UpdateRecurringRuleRequestSchema = RecurringRuleFieldsSchema.omit({ flow: true })
  .partial()
  .extend({
    // `.partial()` zostawiłby wartości domyślne — pominięte pole zmieniałoby regułę.
    amountIsEstimate: z.boolean().optional(),
    intervalCount: z.number().int().min(1).max(24).optional(),
    autoPost: z.boolean().optional(),
    isFixedExpense: z.boolean().optional(),
  });
/** Zmiana reguły po walidacji. */
export type UpdateRecurringRuleRequest = z.infer<typeof UpdateRecurringRuleRequestSchema>;

/** Filtr tak/nie w adresie: tylko dwa literały (`z.coerce.boolean()` zamienia „false" na `true`). */
const OptionalFlagSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

/** Parametry `GET /recurring/rules` (04 §9). */
export const ListRecurringRulesQuerySchema = z.object({
  flow: TransactionTypeSchema.optional(),
  isFixedExpense: OptionalFlagSchema,
  isActive: OptionalFlagSchema,
});
/** Parametry listy reguł po walidacji. */
export type ListRecurringRulesQuery = z.infer<typeof ListRecurringRulesQuerySchema>;

/**
 * Wystąpienie reguły — konkretny termin w miesiącu (07 §6.2).
 *
 * Nazwa, rodzaj, kategoria i plakietki pochodzą z **bieżącej** reguły; z wystąpienia
 * są termin, status i migawka kwoty (07 §6.3).
 */
export const RecurringOccurrenceDtoSchema = z.object({
  /**
   * `null` — podgląd miesiąca przyszłego: termin wyliczony z reguły, jeszcze niezapisany
   * (07 §6.2, ADR-045). Takiego wystąpienia nie da się zaksięgować ani pominąć.
   */
  id: IdSchema.nullable(),
  ruleId: IdSchema,
  ruleName: z.string(),
  flow: TransactionTypeSchema,
  dueOn: DateOnlySchema,
  monthKey: MonthKeySchema,
  /** Migawka kwoty reguły z chwili wygenerowania (07 §6.3). */
  plannedAmountMinor: PositiveAmountMinorSchema,
  status: OccurrenceStatusSchema,
  postedAmountMinor: PositiveAmountMinorSchema.nullable(),
  transactionId: IdSchema.nullable(),
  categoryId: IdSchema.nullable(),
  categoryName: z.string().nullable(),
  /**
   * Przewidywany wpływ na pule po zaksięgowaniu — z klas **bieżących** kont reguły
   * (zaksięgowane: z kwotą zaksięgowaną). Wiążące są efekty samej transakcji.
   */
  allocationEffects: z.array(AllocationEffectDtoSchema),
  isFixedExpense: z.boolean(),
  /** `true`, gdy termin minął, a wystąpienie wciąż czeka na potwierdzenie (07 §6.6). */
  isOverdue: z.boolean(),
  /** Rachunek zmienny — księgowanie wymusi potwierdzenie kwoty (07 §6.5). */
  amountIsEstimate: z.boolean(),
});
/** Wystąpienie reguły cyklicznej. */
export type RecurringOccurrenceDto = z.infer<typeof RecurringOccurrenceDtoSchema>;

/** Suma planu i wykonania jednego rodzaju przepływu. */
export const OccurrenceFlowTotalsDtoSchema = z.object({
  /** Kwoty planowane wystąpień poza pominiętymi. */
  plannedMinor: NonNegativeAmountMinorSchema,
  /** Kwoty faktycznie zaksięgowane. */
  postedMinor: NonNegativeAmountMinorSchema,
});
/** Suma planu i wykonania jednego rodzaju przepływu. */
export type OccurrenceFlowTotalsDto = z.infer<typeof OccurrenceFlowTotalsDtoSchema>;

/**
 * Metadane listy wystąpień miesiąca (04 §9).
 *
 * Sumy łączne dodają kwoty bez znaku ze wszystkich rodzajów — to „ile pozycji cyklicznych
 * przechodzi przez miesiąc"; podział na wydatki, wpływy i przelewy daje `byFlow`.
 */
export const RecurringOccurrencesMetaSchema = z.object({
  month: MonthKeySchema,
  /** `true` dla miesiąca przyszłego — lista jest wyliczona z reguł, nic nie jest zapisane. */
  isPreview: z.boolean(),
  plannedTotalMinor: NonNegativeAmountMinorSchema,
  postedTotalMinor: NonNegativeAmountMinorSchema,
  /** Kwoty planowane wystąpień, które wciąż czekają (`planned`). */
  remainingTotalMinor: NonNegativeAmountMinorSchema,
  byFlow: z.object({
    expense: OccurrenceFlowTotalsDtoSchema,
    income: OccurrenceFlowTotalsDtoSchema,
    transfer: OccurrenceFlowTotalsDtoSchema,
  }),
});
/** Metadane listy wystąpień. */
export type RecurringOccurrencesMeta = z.infer<typeof RecurringOccurrencesMetaSchema>;

/** Parametry `GET /recurring/occurrences`. */
export const ListOccurrencesQuerySchema = z.object({ month: MonthKeySchema });
/** Parametry listy wystąpień po walidacji. */
export type ListOccurrencesQuery = z.infer<typeof ListOccurrencesQuerySchema>;

/** Ciało `POST /recurring/generate` — wymuszenie generacji. */
export const GenerateOccurrencesRequestSchema = z.object({ month: MonthKeySchema });
/** Ciało wymuszenia generacji. */
export type GenerateOccurrencesRequest = z.infer<typeof GenerateOccurrencesRequestSchema>;

/** Wynik `POST /recurring/generate`. */
export const GenerateOccurrencesResultDtoSchema = z.object({
  month: MonthKeySchema,
  /**
   * Ile wystąpień powstało w całym oknie generowania (od pierwszego otwartego miesiąca
   * do bieżącego, ADR-045) — `0`, gdy wszystkie już istniały.
   */
  createdCount: z.number().int().min(0),
});
/** Wynik wymuszenia generacji. */
export type GenerateOccurrencesResultDto = z.infer<typeof GenerateOccurrencesResultDtoSchema>;

/** Parametr ścieżki z identyfikatorem wystąpienia. */
export const OccurrenceParamsSchema = z.object({ id: IdSchema });

/**
 * Zaksięgowanie wystąpienia — `POST /recurring/occurrences/:id/post` (07 §6.5).
 *
 * Puste ciało księguje kwotę planowaną w dniu terminu, z konta reguły. Rachunek
 * szacunkowy (`amountIsEstimate`) formularz i tak wysyła z potwierdzoną kwotą.
 */
export const PostOccurrenceRequestSchema = z.object({
  amountMinor: PositiveAmountMinorSchema.optional(),
  bookedOn: DateOnlySchema.optional(),
  /** Inne konto niż w regule — np. czynsz zapłacony wyjątkowo z karty. */
  accountId: IdSchema.optional(),
  notes: optionalNotes,
});
/** Zaksięgowanie wystąpienia po walidacji. */
export type PostOccurrenceRequest = z.infer<typeof PostOccurrenceRequestSchema>;

/** Wynik zaksięgowania: wystąpienie po zmianie i utworzona transakcja. */
export const PostOccurrenceResultDtoSchema = z.object({
  occurrence: RecurringOccurrenceDtoSchema,
  transaction: TransactionDtoSchema,
});
/** Wynik zaksięgowania. */
export type PostOccurrenceResultDto = z.infer<typeof PostOccurrenceResultDtoSchema>;

/** Metadane zmiany wystąpienia — miesiące do unieważnienia w cache frontu. */
export const OccurrenceMutationMetaSchema = TransactionMutationMetaSchema;
/** Metadane zmiany wystąpienia. */
export type OccurrenceMutationMeta = z.infer<typeof OccurrenceMutationMetaSchema>;

/** Pominięcie wystąpienia — `POST /recurring/occurrences/:id/skip`. */
export const SkipOccurrenceRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(200, 'Powód może mieć najwyżej 200 znaków')
    .nullish()
    .transform((value) => (value === '' ? null : value)),
});
/** Pominięcie wystąpienia po walidacji. */
export type SkipOccurrenceRequest = z.infer<typeof SkipOccurrenceRequestSchema>;

/**
 * „Zapisz jako wydatek stały" — `POST /transactions/:id/save-as-recurring` (wymaganie #3,
 * 06 §3.3, `F4-8`, ADR-051).
 *
 * Kwota, konta, kategoria, źródło, cel i zobowiązanie pochodzą z transakcji — ciało niesie
 * tylko to, czego transakcja nie wie: terminarz. Pominięte pola terminarza wynikają z daty
 * transakcji („co miesiąc, tego samego dnia, od jej miesiąca"), nazwa — z opisu.
 */
export const SaveAsRecurringRequestSchema = RecurringRuleFieldsSchema.pick({
  amountIsEstimate: true,
  intervalCount: true,
  dayOfMonth: true,
  weekday: true,
  monthOfYear: true,
  anchorDate: true,
  endMonth: true,
  autoPost: true,
  notes: true,
}).extend({
  /** Pominięta — z opisu, zobowiązania, sprzedawcy albo kategorii transakcji. */
  name: RecurringRuleFieldsSchema.shape.name.optional(),
  frequency: FrequencySchema.default('monthly'),
  /** Pominięty — miesiąc transakcji: ona sama jest pierwszą płatnością. */
  startMonth: MonthKeySchema.optional(),
  /** Pominięte — `true` dla wydatku. */
  isFixedExpense: z.boolean().optional(),
});
/** Ciało „Zapisz jako wydatek stały" po walidacji. */
export type SaveAsRecurringRequest = z.infer<typeof SaveAsRecurringRequestSchema>;
/** Ciało „Zapisz jako wydatek stały" tak, jak wysyła je klient. */
export type SaveAsRecurringInput = z.input<typeof SaveAsRecurringRequestSchema>;

/** Pola transakcji, z których powstaje reguła. */
export type RecurringSourceTransaction = Pick<
  TransactionDto,
  | 'type'
  | 'amountMinor'
  | 'bookedOn'
  | 'monthKey'
  | 'accountId'
  | 'counterAccountId'
  | 'categoryId'
  | 'incomeSourceId'
  | 'goalId'
  | 'liabilityId'
  | 'allocationOverride'
  | 'description'
  | 'merchant'
> & {
  readonly categoryName?: string | null;
  readonly incomeSourceName?: string | null;
  readonly liabilityName?: string | null;
};

/** Nazwa reguły, gdy transakcja nie ma ani opisu, ani nazwanych powiązań. */
const FALLBACK_RULE_NAME: Readonly<Record<TransactionType, string>> = {
  expense: 'Wydatek stały',
  income: 'Stały przychód',
  transfer: 'Stały przelew',
};

/**
 * Nazwa reguły z transakcji: pierwsza niepusta z opisu, zobowiązania, sprzedawcy, kategorii
 * i źródła — w tej kolejności, bo opis wpisał człowiek, a rata najlepiej nazywa się
 * zobowiązaniem („Kredyt hipoteczny", nie „Raty"). Przycięta do 60 znaków (limit reguły).
 *
 * @param tx - Transakcja źródłowa.
 * @returns Nazwa reguły.
 */
export function recurringNameFromTransaction(tx: RecurringSourceTransaction): string {
  const candidates = [
    tx.description,
    tx.liabilityName,
    tx.merchant,
    tx.categoryName,
    tx.incomeSourceName,
  ];
  const found = candidates.map((value) => value?.trim() ?? '').find((value) => value !== '');
  return (found ?? FALLBACK_RULE_NAME[tx.type]).slice(0, 60).trim();
}

/**
 * Reguła z transakcji i terminarza — wspólne dla serwera i podglądu w formularzu.
 *
 * Domyślny terminarz bierze się z daty transakcji: dzień miesiąca (`monthly`, `quarterly`,
 * `every_n_months`, `yearly`), dzień tygodnia (`weekly`, `biweekly`) i miesiąc roku
 * (`yearly`). `biweekly` kotwiczy się w samej transakcji, gdy dzień tygodnia się zgadza —
 * kolejna płatność wypada 14 dni po niej, a nie od pierwszego takiego dnia miesiąca.
 *
 * @param tx - Transakcja źródłowa.
 * @param input - Terminarz z żądania.
 * @returns Pola nowej reguły — do sprawdzenia tymi samymi regułami co `POST /recurring/rules`.
 */
export function recurringRuleFromTransaction(
  tx: RecurringSourceTransaction,
  input: SaveAsRecurringRequest,
): CreateRecurringRuleRequest {
  const weekday = input.weekday ?? weekdayOf(tx.bookedOn);
  const biweeklyAnchor =
    input.frequency === 'biweekly' && weekday === weekdayOf(tx.bookedOn) ? tx.bookedOn : undefined;
  return {
    name: input.name ?? recurringNameFromTransaction(tx),
    flow: tx.type,
    amountMinor: tx.amountMinor,
    amountIsEstimate: input.amountIsEstimate,
    // Transakcja bez konta to dziś tylko zaplanowana (Faza 6); serwis i tak ją odrzuci.
    accountId: tx.accountId ?? '',
    counterAccountId: tx.counterAccountId,
    categoryId: tx.categoryId,
    incomeSourceId: tx.incomeSourceId,
    goalId: tx.goalId,
    liabilityId: tx.liabilityId,
    allocationOverride: tx.allocationOverride,
    frequency: input.frequency,
    intervalCount: input.intervalCount,
    dayOfMonth: input.dayOfMonth ?? Number(tx.bookedOn.slice(8, 10)),
    weekday,
    monthOfYear: input.monthOfYear ?? Number(tx.bookedOn.slice(5, 7)),
    anchorDate: input.anchorDate ?? biweeklyAnchor,
    startMonth: input.startMonth ?? tx.monthKey,
    endMonth: input.endMonth ?? null,
    autoPost: input.autoPost,
    isFixedExpense: input.isFixedExpense ?? tx.type === 'expense',
    notes: input.notes ?? null,
  };
}
