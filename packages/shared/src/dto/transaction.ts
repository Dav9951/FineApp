import { z } from 'zod';

import {
  AllocationClassSchema,
  AllocationKindSchema,
  AllocationOverrideSchema,
  TransactionSourceSchema,
  TransactionStatusSchema,
  TransactionTypeSchema,
} from '../domain/enums.js';
import {
  AmountMinorSchema,
  CurrencySchema,
  DateOnlySchema,
  HexColorSchema,
  IdSchema,
  MonthKeySchema,
  NonNegativeAmountMinorSchema,
  PositiveAmountMinorSchema,
  TimestampSchema,
} from '../domain/primitives.js';
import { transactionShapeIssues } from '../domain/transaction.js';
import { CursorPaginationSchema, PaginationMetaSchema } from './envelope.js';

/**
 * Kontrakty transakcji
 * ([05 §7](../../../../plans/05-dto-contracts.md#7-transakcje--dtotransactiondtots)).
 */

/** Wpływ transakcji na jedną pulę celów procentowych. */
export const AllocationEffectDtoSchema = z.object({
  kind: AllocationKindSchema,
  /** Dodatnia = wpłata do puli, ujemna = wypłata z niej (ADR-011). */
  amountMinor: AmountMinorSchema,
});

/** Pojedynczy ruch pieniądza w księdze. */
export const TransactionDtoSchema = z.object({
  id: IdSchema,
  type: TransactionTypeSchema,
  status: TransactionStatusSchema,
  bookedOn: DateOnlySchema,
  /** Miesiąc budżetowy wyliczony z `bookedOn` przy zapisie (I-1). */
  monthKey: MonthKeySchema,
  /** Zawsze dodatnia; kierunek wynika z `type`. */
  amountMinor: PositiveAmountMinorSchema,
  currency: CurrencySchema,
  /** `expense`: konto źródłowe · `income`: docelowe · `transfer`: źródłowe. */
  accountId: IdSchema.nullable(),
  /** Wyłącznie przy przelewie: konto docelowe. */
  counterAccountId: IdSchema.nullable(),
  categoryId: IdSchema.nullable(),
  incomeSourceId: IdSchema.nullable(),
  liabilityId: IdSchema.nullable(),
  goalId: IdSchema.nullable(),
  /** Migawka klasy konta źródłowego; `null` poza przelewami. */
  sourceAllocationClass: AllocationClassSchema.nullable(),
  /** Migawka klasy konta docelowego; `null` poza przelewami. */
  targetAllocationClass: AllocationClassSchema.nullable(),
  allocationOverride: AllocationOverrideSchema.nullable(),
  /**
   * Wyliczony wpływ na pule celów procentowych — ujęcie netto (ADR-011).
   *
   * Lista, bo jeden przelew potrafi dotknąć dwóch pul naraz (oszczędności → inwestycje).
   * Rata zobowiązania daje `debt_repayment` (07 §2.2a). Pusta = operacja neutralna.
   */
  allocationEffects: z.array(AllocationEffectDtoSchema),
  description: z.string().nullable(),
  merchant: z.string().nullable(),
  notes: z.string().nullable(),
  source: TransactionSourceSchema,
  sourceDocumentId: IdSchema.nullable(),
  recurringOccurrenceId: IdSchema.nullable(),
  /** Planowany wydatek, którego to wpłata na odkładanie albo zapłata (`F6-3`). */
  plannedExpenseId: IdSchema.nullable(),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  /** Znacznik miękkiego usunięcia; `null` = transakcja w księdze. */
  deletedAt: TimestampSchema.nullable(),
});
/** Transakcja. */
export type TransactionDto = z.infer<typeof TransactionDtoSchema>;

/**
 * Transakcja wzbogacona o dane powiązanych bytów.
 *
 * Zwracana przez listy i szczegóły, żeby front nie musiał łączyć danych po stronie
 * klienta ani wykonywać dodatkowych żądań.
 */
export const TransactionListItemDtoSchema = TransactionDtoSchema.extend({
  accountName: z.string().nullable(),
  counterAccountName: z.string().nullable(),
  categoryName: z.string().nullable(),
  categoryIcon: z.string().nullable(),
  categoryColor: HexColorSchema.nullable(),
  incomeSourceName: z.string().nullable(),
  goalName: z.string().nullable(),
  liabilityName: z.string().nullable(),
  createdByName: z.string(),
});
/** Transakcja z nazwami powiązanych bytów. */
export type TransactionListItemDto = z.infer<typeof TransactionListItemDtoSchema>;

/**
 * Opcjonalny tekst transakcji: przycięty, a pusty zapisywany jako brak.
 *
 * @param max - Najwyższa dopuszczalna długość.
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
 * Pola transakcji **bez** walidacji krzyżowej.
 *
 * To ciało `POST /transactions`: niezmienniki kształtu (I-2, I-3, I-7a) sprawdza serwis
 * funkcją `transactionShapeIssues` i odpowiada `422 DOMAIN_RULE_VIOLATION` — „przelew
 * wymaga konta docelowego" to reguła domenowa, nie zły typ danych (04 §2, ADR-016).
 * Formularz używa {@link CreateTransactionRequestSchema}, który stosuje te same reguły
 * przez `superRefine` (ADR-035).
 */
export const TransactionFieldsSchema = z.object({
  type: TransactionTypeSchema,
  bookedOn: DateOnlySchema,
  amountMinor: PositiveAmountMinorSchema,
  accountId: IdSchema,
  counterAccountId: IdSchema.nullish(),
  categoryId: IdSchema.nullish(),
  incomeSourceId: IdSchema.nullish(),
  liabilityId: IdSchema.nullish(),
  goalId: IdSchema.nullish(),
  /** Nadpisanie wyliczonej alokacji. Pominięte → wyliczane z klas kont (07 §2.2). */
  allocationOverride: AllocationOverrideSchema.nullish(),
  description: optionalText(200),
  merchant: optionalText(120),
  notes: optionalText(1000),
});

/**
 * Nowa transakcja z walidacją krzyżową — schemat formularza.
 *
 * Te same reguły co w serwisie (`transactionShapeIssues`), więc formularz podświetla
 * pole, zanim cokolwiek wyśle.
 */
export const CreateTransactionRequestSchema = TransactionFieldsSchema.superRefine((value, ctx) => {
  for (const issue of transactionShapeIssues(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
  }
});
/** Nowa transakcja po walidacji. */
export type CreateTransactionRequest = z.infer<typeof TransactionFieldsSchema>;
/** Nowa transakcja tak, jak wysyła ją klient. */
export type CreateTransactionInput = z.input<typeof TransactionFieldsSchema>;

/**
 * Zmiana transakcji — każde pole opcjonalne, `null` czyści pole opcjonalne.
 *
 * Typ jest niezmienny — inaczej trzeba ją usunąć i dodać na nowo. Kształt po scaleniu
 * z bieżącym stanem sprawdza serwis; sam `PATCH` nie wie, jaki typ ma transakcja.
 */
export const UpdateTransactionRequestSchema = TransactionFieldsSchema.partial().omit({
  type: true,
});
/** Zmiana transakcji po walidacji. */
export type UpdateTransactionRequest = z.infer<typeof UpdateTransactionRequestSchema>;

/**
 * Metadane odpowiedzi zapisu: miesiące, których cache front ma unieważnić.
 *
 * Przy księgowaniu wstecz albo przeniesieniu daty to nie jest miesiąc bieżący — bez
 * tej listy ekran sierpnia pokazywałby stare sumy po zapisie z wrześniowego ekranu.
 */
export const TransactionMutationMetaSchema = z.object({
  affectedMonths: z.array(MonthKeySchema),
});
/** Metadane odpowiedzi zapisu transakcji. */
export type TransactionMutationMeta = z.infer<typeof TransactionMutationMetaSchema>;

/** Najwięcej transakcji w jednym `POST /transactions/bulk`. */
export const BULK_TRANSACTIONS_MAX = 100;

/**
 * Wiele transakcji naraz — `POST /transactions/bulk` (`F7-6`, ADR-035).
 *
 * Wszystkie albo żadna: jedna błędna pozycja odrzuca całe żądanie, a `details`
 * wskazuje ją ścieżką `transactions.<indeks>.<pole>`.
 */
export const BulkCreateTransactionsRequestSchema = z.object({
  transactions: z
    .array(TransactionFieldsSchema)
    .min(1, 'Podaj przynajmniej jedną transakcję')
    .max(BULK_TRANSACTIONS_MAX, `Najwyżej ${String(BULK_TRANSACTIONS_MAX)} transakcji naraz`),
});
/** Wiele transakcji naraz po walidacji. */
export type BulkCreateTransactionsRequest = z.infer<typeof BulkCreateTransactionsRequestSchema>;

/** Najwięcej wartości jednego filtra wielokrotnego. */
const MAX_FILTER_VALUES = 50;

/**
 * Filtr wielokrotny: `?type=expense&type=income` albo pojedyncza wartość.
 *
 * Fastify zamienia powtórzony parametr na tablicę, a pojedynczy zostawia napisem —
 * po walidacji zawsze jest tablica, więc serwis nie rozgałęzia się na oba kształty.
 *
 * @param item - Schemat pojedynczej wartości.
 * @returns Schemat filtra dający tablicę.
 */
function oneOrMany<T extends z.ZodTypeAny>(item: T) {
  return z.union([
    z.array(item).min(1).max(MAX_FILTER_VALUES, 'Za dużo wartości filtra'),
    item.transform((value: z.output<T>) => [value]),
  ]);
}

/** Kwota w filtrze: parametr zapytania przychodzi jako tekst. */
const AmountFilterSchema = z.coerce.number().pipe(NonNegativeAmountMinorSchema);

/** Dozwolone sortowania listy transakcji. */
export const TransactionSortSchema = z.enum([
  'bookedOn:desc',
  'bookedOn:asc',
  'amount:desc',
  'amount:asc',
  'createdAt:desc',
]);
/** Sortowanie listy transakcji. */
export type TransactionSort = z.infer<typeof TransactionSortSchema>;

/**
 * Filtry listy transakcji (04 §7).
 *
 * Różnice względem pierwotnego zapisu w 05 §7 (ADR-035): `includeDeleted` przyjmuje
 * wyłącznie `true`/`false` (`z.coerce.boolean()` zamienia napis `"false"` na `true`),
 * kwoty są zamieniane z tekstu, a wszystkie filtry identyfikatorów są wielokrotne,
 * jak w 04 §7.
 */
export const TransactionQuerySchema = CursorPaginationSchema.extend({
  month: MonthKeySchema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  type: oneOrMany(TransactionTypeSchema).optional(),
  accountId: oneOrMany(IdSchema).optional(),
  categoryId: oneOrMany(IdSchema).optional(),
  goalId: oneOrMany(IdSchema).optional(),
  liabilityId: oneOrMany(IdSchema).optional(),
  /** Wpłaty i zapłata planowanego wydatku (`F6-3`). */
  plannedExpenseId: oneOrMany(IdSchema).optional(),
  incomeSourceId: oneOrMany(IdSchema).optional(),
  /** Pula, której dotyczy efekt alokacji transakcji (ten sam wynik co `allocationEffects`). */
  allocationKind: oneOrMany(AllocationKindSchema).optional(),
  source: oneOrMany(TransactionSourceSchema).optional(),
  /** Szuka w opisie, sprzedawcy i notatkach — bez względu na wielkość liter i ogonki. */
  q: z.string().trim().max(100).optional(),
  minAmountMinor: AmountFilterSchema.optional(),
  maxAmountMinor: AmountFilterSchema.optional(),
  /**
   * Tylko transakcje bez kategorii — licznik „do uzupełnienia" z dashboardu (07 §9.2,
   * `Z-18`). Wyklucza `categoryId`.
   */
  uncategorized: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Dołącza transakcje z kosza (miękko usunięte). */
  includeDeleted: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  sort: TransactionSortSchema.default('bookedOn:desc'),
}).superRefine((value, ctx) => {
  if (value.month !== undefined && (value.from !== undefined || value.to !== undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['month'],
      message: 'Podaj miesiąc albo zakres dat, nie oba naraz',
    });
  }
  if (value.uncategorized && value.categoryId !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['uncategorized'],
      message: 'Filtr „bez kategorii" wyklucza wybór kategorii',
    });
  }
  if (value.from !== undefined && value.to !== undefined && value.from > value.to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: 'Koniec zakresu nie może być wcześniejszy niż początek',
    });
  }
  if (
    value.minAmountMinor !== undefined &&
    value.maxAmountMinor !== undefined &&
    value.minAmountMinor > value.maxAmountMinor
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxAmountMinor'],
      message: 'Kwota maksymalna nie może być mniejsza niż minimalna',
    });
  }
});
/** Filtry listy transakcji po walidacji. */
export type TransactionQuery = z.infer<typeof TransactionQuerySchema>;

/**
 * Sumy jednego dnia listy — nagłówek grupy dnia na ekranie historii (06 §3.2).
 *
 * Liczone po stronie serwera dla **całego** zestawu filtrów, nie dla wczytanej strony:
 * przy paginacji dzień rozcięty granicą strony pokazywałby sumę z połowy transakcji
 * i zmieniałby ją po doczytaniu reszty (ADR-038).
 */
export const TransactionDayTotalSchema = z.object({
  bookedOn: DateOnlySchema,
  /** Suma wydatków dnia; dodatnia. */
  expenseMinor: NonNegativeAmountMinorSchema,
  /** Suma przychodów dnia; dodatnia. */
  incomeMinor: NonNegativeAmountMinorSchema,
});
/** Sumy jednego dnia listy. */
export type TransactionDayTotal = z.infer<typeof TransactionDayTotalSchema>;

/**
 * Podsumowanie listy transakcji dla bieżących filtrów (ADR-038).
 *
 * `count` obejmuje każdą pasującą transakcję, a sumy wyłącznie zaksięgowane
 * (`posted`) i nieusunięte — tak samo jak salda (07 §7). Transakcja z kosza
 * pokazana przez `includeDeleted` nie może zmieniać sum, bo w księdze jej nie ma.
 * Przelewy mają osobną sumę: nie są ani wydatkiem, ani wpływem gospodarstwa (ADR-003).
 */
export const TransactionListSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  expenseMinor: NonNegativeAmountMinorSchema,
  incomeMinor: NonNegativeAmountMinorSchema,
  transferMinor: NonNegativeAmountMinorSchema,
  /** Dni, w których jest co najmniej jedna pasująca transakcja; od najnowszego. */
  days: z.array(TransactionDayTotalSchema),
});
/** Podsumowanie listy transakcji. */
export type TransactionListSummary = z.infer<typeof TransactionListSummarySchema>;

/**
 * Metadane odpowiedzi `GET /transactions`: paginacja i — **wyłącznie na pierwszej
 * stronie** (bez `cursor`) — podsumowanie. Kolejne strony go nie liczą: nie zmieniło
 * się, a zapytanie agregujące przy każdym doczytaniu byłoby pracą na próżno.
 */
export const TransactionListMetaSchema = PaginationMetaSchema.extend({
  summary: TransactionListSummarySchema.optional(),
});
/** Metadane listy transakcji. */
export type TransactionListMeta = z.infer<typeof TransactionListMetaSchema>;
