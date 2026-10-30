# 05 — Kontrakty DTO

Wszystkie kontrakty żyją w `packages/shared/src/dto/` jako schematy **Zod**. Jeden schemat
pełni cztery role naraz: walidacja na backendzie, typ TypeScript na obu końcach, walidacja
formularza na froncie, dokumentacja kontraktu.

```
packages/shared/src/
├─ domain/          # enumy i typy bazowe (bez zależności)
├─ dto/             # schematy request/response per obszar
├─ utils/           # money.ts, month.ts — izomorficzne helpery
├─ constants/       # kategorie domyślne, limity
└─ index.ts         # barrel
```

**Reguła nazewnicza:** `XxxSchema` (schemat) → `Xxx` (typ). Przykład: `AccountDtoSchema` → `AccountDto`.

---

## 1. Prymitywy domenowe — `domain/primitives.ts`

```ts
import { z } from 'zod';

/** Identyfikator zasobu — 26-znakowy ULID (Crockford base32, sortowalny czasowo). */
export const IdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Nieprawidłowy identyfikator');
export type Id = z.infer<typeof IdSchema>;

/**
 * Kwota w groszach.
 *
 * Zawsze liczba całkowita. Wartość ujemna jest dopuszczalna tylko tam, gdzie
 * jawnie opisuje różnicę (`deltaAmountMinor`) — nigdy jako kwota transakcji.
 */
export const AmountMinorSchema = z
  .number()
  .int('Kwota musi być liczbą całkowitą groszy')
  .max(1_000_000_000_00, 'Kwota poza dopuszczalnym zakresem');

/** Kwota dodatnia (transakcje, wpłaty, raty). */
export const PositiveAmountMinorSchema = AmountMinorSchema.positive('Kwota musi być większa od zera');

/** Udział w punktach bazowych: 1% = 100 bps, 100% = 10 000 bps. */
export const BpsSchema = z.number().int().min(0).max(100_000);

/**
 * Data biznesowa w formacie `YYYY-MM-DD`.
 *
 * Sprawdzenie jest **kalendarzowe** (`isValidDateOnly` z `utils/month.ts`), nie przez
 * `Date.parse`: `Date.parse('2026-02-31T00:00:00Z')` NIE zwraca `NaN`, tylko przewija
 * datę na 3 marca — nieistniejąca data przeszłaby walidację (ADR-017).
 */
export const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Oczekiwano formatu RRRR-MM-DD')
  .refine(isValidDateOnly, 'Nieistniejąca data');

/** Klucz miesiąca w formacie `YYYY-MM`. */
export const MonthKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Oczekiwano formatu RRRR-MM');
export type MonthKey = z.infer<typeof MonthKeySchema>;

/** Znacznik czasu — epoch w milisekundach UTC. */
export const TimestampSchema = z.number().int().nonnegative();

/** Kod waluty ISO 4217. W v1 zawsze `PLN`. */
export const CurrencySchema = z.string().length(3).default('PLN');

/** Kolor w zapisie HEX, np. `#22c55e`. */
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
```

## 2. Enumy — `domain/enums.ts`

```ts
export const AccountTypeSchema = z.enum(['checking', 'cash', 'savings', 'investment', 'other']);
export const AllocationClassSchema = z.enum(['spending', 'savings', 'investment']);
export const TransactionTypeSchema = z.enum(['expense', 'income', 'transfer']);
export const TransactionStatusSchema = z.enum(['posted', 'pending', 'void']);
export const TransactionSourceSchema = z.enum([
  'manual', 'ocr', 'recurring', 'planned', 'import',
]);
/** Pula celów procentowych, której dotyczy efekt alokacji. */
export const AllocationKindSchema = z.enum(['savings', 'investment', 'debt_repayment']);
/** Nadpisanie wyliczonej alokacji przez użytkownika. `none` = nie licz tej operacji. */
export const AllocationOverrideSchema = z.enum(['none', 'savings', 'investment']);
export const CategoryKindSchema = z.enum(['expense', 'income', 'transfer']);
export const GoalKindSchema = z.enum(['savings', 'investment']);
export const GoalStatusSchema = z.enum(['active', 'paused', 'achieved', 'archived']);
export const ContributionModeSchema = z.enum(['fixed', 'percent_of_income', 'none']);
export const ProgressSourceSchema = z.enum(['contributions', 'account_balance']);
export const LiabilityKindSchema = z.enum([
  'mortgage', 'cash_loan', 'car_loan', 'installment', 'credit_card', 'bnpl', 'private', 'other',
]);
export const FrequencySchema = z.enum([
  'monthly', 'weekly', 'biweekly', 'quarterly', 'yearly', 'every_n_months',
]);
export const OccurrenceStatusSchema = z.enum(['planned', 'posted', 'skipped']);
export const PlannedExpenseStatusSchema = z.enum([
  'planned', 'funding', 'ready', 'posted', 'deferred', 'cancelled',
]);
export const PlannedExpensePrioritySchema = z.enum(['must', 'should', 'nice']);
export const DocumentKindSchema = z.enum(['receipt', 'bank_statement', 'invoice', 'other']);
export const DocumentStatusSchema = z.enum([
  'uploaded', 'processing', 'parsed', 'failed', 'committed', 'discarded',
]);
export const ReviewStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'merged']);
export const IncomeSourceKindSchema = z.enum([
  'salary', 'business', 'freelance', 'benefit', 'rental',
  'investment', 'refund', 'gift', 'sale', 'other',
]);
export const AllocationStatusSchema = z.enum(['on_track', 'behind', 'ahead', 'met']);
// Planer budżetu (Faza 9, od `F9-1` — idą do CHECK w `budget_draft_lines`)
export const BudgetLineFlowSchema = z.enum(['income', 'expense', 'savings', 'investment']);
export const BudgetLineOriginSchema = z.enum([
  'manual', 'recurring', 'planned', 'set_aside', 'goal', 'liability',
]);
// Sekcja szkicu — CHECK w `budget_draft_groups` (`F9-11`, ADR-081)
export const BudgetSectionSchema = z.enum(['income', 'expense', 'pools']);
```

Enumy są **jedynym** źródłem tych wartości — te same stringi trafiają do `CHECK` w DDL
(generowanym z Drizzle) i do `<Select>` na froncie.

## 3. Koperta odpowiedzi — `dto/envelope.ts`

```ts
/**
 * Opakowuje schemat danych w standardową kopertę odpowiedzi.
 *
 * @param dataSchema - Schemat ładunku.
 * @param metaSchema - Opcjonalny schemat metadanych.
 * @returns Schemat pełnej odpowiedzi API.
 */
export function apiResponse<TData extends z.ZodTypeAny, TMeta extends z.ZodTypeAny>(
  dataSchema: TData,
  metaSchema?: TMeta,
) {
  return metaSchema
    ? z.object({ data: dataSchema, meta: metaSchema })
    : z.object({ data: dataSchema });
}

/** Pojedynczy problem walidacyjny wskazujący pole formularza. */
export const ApiErrorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
});

/** Kontrakt odpowiedzi błędu — identyczny dla wszystkich endpointów. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
      'RATE_LIMITED', 'DOMAIN_RULE_VIOLATION', 'FILE_TOO_LARGE',
      'UNSUPPORTED_MEDIA_TYPE', 'EXTERNAL_SERVICE_ERROR', 'AI_BUDGET_EXCEEDED',
      'INTERNAL_ERROR',
    ]),
    message: z.string(),
    details: z.array(ApiErrorDetailSchema).optional(),
    /** Wyłącznie przy `RATE_LIMITED`; obok `details`, nie w środku. */
    retryAfterSeconds: z.number().int().nonnegative().optional(),
    requestId: z.string(),
  }),
});

/**
 * Wartość nagłówka `Idempotency-Key` (04 §1, ADR-037): 8–128 znaków `A–Z a–z 0–9 _ -`,
 * np. UUID. Nagłówek jest opcjonalny; formularz transakcji wysyła go zawsze.
 */
export const IdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, 'Nieprawidłowy klucz idempotencji');

/** Parametry paginacji kursorowej. */
export const CursorPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/** Metadane paginacji zwracane z listą. */
export const PaginationMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  totalCount: z.number().int().optional(),
});
```

## 4. Auth — `dto/auth.dto.ts`

```ts
/** Dane logowania: adres e-mail i PIN. */
export const LoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email('Nieprawidłowy adres e-mail'),
  pin: z.string().regex(/^\d{6,8}$/, 'PIN musi mieć od 6 do 8 cyfr'),
  deviceLabel: z.string().max(80).optional(),
});

/** Profil zalogowanego użytkownika. */
export const UserDtoSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  displayName: z.string(),
  avatarColor: HexColorSchema.nullable(),
  lastLoginAt: TimestampSchema.nullable(),
});

/** Ustawienia gospodarstwa domowego zwracane po zalogowaniu. */
export const HouseholdDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  baseCurrency: CurrencySchema,
  timezone: z.string(),
  locale: z.string(),
  backPostingLimitMonths: z.number().int().min(0).max(12),
  monthStartDay: z.number().int().min(1).max(28),
  /** Konto proponowane przy wydatkach i skanie; `null` = brak (ADR-070). */
  defaultExpenseAccountId: IdSchema.nullable(),
});

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: UserDtoSchema,
  household: HouseholdDtoSchema,
});

/**
 * Odpowiedź na odświeżenie sesji — ten sam kształt co logowanie.
 *
 * Access token żyje tylko w pamięci, więc po odświeżeniu strony front nie ma ani jego,
 * ani profilu. Odświeżenie musi oddać komplet, inaczej aplikacja po `F5` wstawałaby
 * pusta i dopytywała o profil osobnym żądaniem.
 */
export const RefreshResponseSchema = LoginResponseSchema;

/** Zmiana PIN-u wymaga potwierdzenia obecnego. */
export const ChangePinRequestSchema = z.object({
  currentPin: z.string().regex(/^\d{6,8}$/),
  newPin: z.string().regex(/^\d{6,8}$/),
});

/** Profil zalogowanego użytkownika wraz z gospodarstwem — `GET /auth/me`. */
export const MeResponseSchema = z.object({
  user: UserDtoSchema,
  household: HouseholdDtoSchema,
});

/**
 * Aktywna sesja na liście urządzeń (09 §3.5).
 *
 * `sameDevice` zastępuje „przybliżoną lokalizację": z hasha IP nie da się odczytać
 * miejsca — można tylko porównać go z hashem bieżącego żądania.
 */
export const SessionDtoSchema = z.object({
  id: IdSchema,
  deviceLabel: z.string().nullable(),
  current: z.boolean(),
  sameDevice: z.boolean(),
  lastUsedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
});

/** Potwierdzenie operacji, która nie zwraca danych. */
export const AuthAckSchema = z.object({
  affected: z.number().int().nonnegative(),
});
```

## 5. Konta — `dto/account.dto.ts`

```ts
/** Konto: miejsce, w którym leżą pieniądze. */
export const AccountDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  type: AccountTypeSchema,
  allocationClass: AllocationClassSchema,
  currency: CurrencySchema,
  openingBalanceMinor: AmountMinorSchema,
  openingBalanceOn: DateOnlySchema,
  institution: z.string().nullable(),
  color: HexColorSchema.nullable(),
  icon: z.string().nullable(),
  includeInNetWorth: z.boolean(),
  sortOrder: z.number().int(),
  isArchived: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const CreateAccountRequestSchema = z.object({
  name: z.string().trim().min(1, 'Nazwa jest wymagana').max(60, 'Nazwa może mieć najwyżej 60 znaków'),
  type: AccountTypeSchema,
  /** Pominięte — wywnioskowane z `type` (patrz 07 §2.1). */
  allocationClass: AllocationClassSchema.optional(),
  openingBalanceMinor: AmountMinorSchema.default(0),
  openingBalanceOn: DateOnlySchema,
  institution: z.string().trim().max(60, 'Nazwa instytucji może mieć najwyżej 60 znaków').nullish(),
  color: HexColorSchema.nullish(),
  icon: z.string().max(40).nullish(),
  includeInNetWorth: z.boolean().default(true),
});

/**
 * `.partial()` owija pola w `optional` na zewnątrz `default`, więc pominięte pole zostaje
 * `undefined` — PATCH nie przywraca wartości domyślnych. `null` czyści pole opcjonalne.
 */
export const UpdateAccountRequestSchema = CreateAccountRequestSchema.partial();

/**
 * `?includeArchived=true|false`. Nie `z.coerce.boolean()` — to zamieniłoby napis
 * `"false"` na `true` (ADR-031).
 */
export const ListAccountsQuerySchema = z.object({
  includeArchived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

/** Nowa kolejność kont; lista może obejmować część kont, bez powtórzeń (ADR-031). */
export const ReorderAccountsRequestSchema = z.object({
  ids: z
    .array(IdSchema)
    .min(1, 'Lista kont nie może być pusta')
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'Konto występuje na liście więcej niż raz'),
});

/** Szczegóły konta: konto i saldo na dziś gospodarstwa (ADR-032). */
export const AccountDetailDtoSchema = AccountDtoSchema.extend({
  balanceMinor: AmountMinorSchema,
  balanceAsOf: DateOnlySchema,
});

/** `?asOf` albo `?month`, nie oba; brak obu = dziś (ADR-032). */
export const BalancesQuerySchema = z
  .object({ asOf: DateOnlySchema.optional(), month: MonthKeySchema.optional() })
  .refine((v) => v.asOf === undefined || v.month === undefined, {
    message: 'Podaj datę albo miesiąc, nie oba naraz',
    path: ['month'],
  });

/** Saldo konta wraz z ruchem w wybranym miesiącu. */
export const AccountBalanceDtoSchema = z.object({
  accountId: IdSchema,
  name: z.string(),
  type: AccountTypeSchema,
  allocationClass: AllocationClassSchema,
  color: HexColorSchema.nullable(),
  icon: z.string().nullable(),
  /** Zarchiwizowane pojawia się tylko z niezerowym saldem w okresie (07 §7). */
  isArchived: z.boolean(),
  balanceMinor: AmountMinorSchema,
  balanceAtMonthStartMinor: AmountMinorSchema,
  changeInMonthMinor: AmountMinorSchema,
});

/** Podsumowanie majątku: sumy per klasa kont i wartość netto. */
export const BalancesMetaSchema = z.object({
  asOf: DateOnlySchema,
  totalsByClass: z.object({
    spending: AmountMinorSchema,
    savings: AmountMinorSchema,
    investment: AmountMinorSchema,
  }),
  netWorthMinor: AmountMinorSchema,
  liabilitiesRemainingMinor: AmountMinorSchema,
});
```

## 6. Kategorie — `dto/category.dto.ts`

```ts
/** Kategoria wydatku, przychodu lub transferu. */
export const CategoryDtoSchema = z.object({
  id: IdSchema,
  parentId: IdSchema.nullable(),
  name: z.string(),
  slug: z.string(),
  kind: CategoryKindSchema,
  icon: z.string().nullable(),
  color: HexColorSchema.nullable(),
  /** Słowa kluczowe i nazwy sprzedawców pomagające AI dopasować kategorię. */
  aiHints: z.string().nullable(),
  isSystem: z.boolean(),
  isArchived: z.boolean(),
  sortOrder: z.number().int(),
});

/** Kategoria wraz z podkategoriami (maks. jeden poziom zagnieżdżenia). */
export const CategoryTreeDtoSchema = CategoryDtoSchema.extend({
  children: z.array(CategoryDtoSchema),
});

export const CreateCategoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(50),
  kind: CategoryKindSchema,
  parentId: IdSchema.nullish(),
  icon: z.string().max(40).nullish(),
  color: HexColorSchema.nullish(),
  aiHints: z.string().trim().max(500).nullish(),
});

/** Zmiana kategorii — bez `kind` (I-4); `parentId: null` = poziom główny (ADR-033). */
export const UpdateCategoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  parentId: IdSchema.nullish(),
  icon: z.string().max(40).nullish(),
  color: HexColorSchema.nullish(),
  aiHints: z.string().trim().max(500).nullish(),
});

/** `?kind=&includeArchived=true|false` dla `/categories` i `/categories/flat`. */
export const ListCategoriesQuerySchema = z.object({
  kind: CategoryKindSchema.optional(),
  includeArchived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export const MergeCategoryRequestSchema = z.object({ targetCategoryId: IdSchema });

/** Wynik scalenia: cel po zmianie (z połączonymi `aiHints`) i liczba przepiętych transakcji. */
export const MergeCategoryResponseSchema = z.object({
  target: CategoryDtoSchema,
  transactionsMoved: z.number().int().nonnegative(),
});

/** `GET /categories/usage?month=` (od `F2-9`, ADR-038). */
export const CategoryUsageQuerySchema = z.object({ month: MonthKeySchema });

/**
 * Użycie jednej kategorii — ekran ustawień (06 §3.11). Tylko kategorie z transakcjami;
 * liczby **bez** podkategorii (sumę rodzica składa front).
 */
export const CategoryUsageDtoSchema = z.object({
  categoryId: IdSchema,
  /** Transakcje w księdze (bez kosza), ze wszystkich miesięcy. */
  transactionCount: z.number().int().nonnegative(),
  /** Suma zaksięgowanych (`posted`) w podanym miesiącu. */
  monthAmountMinor: NonNegativeAmountMinorSchema,
});

// `CategorySpendingDtoSchema` przeniesiony do `dto/month.ts` (§13): to raport miesiąca,
// nie zarządzanie kategoriami. `categoryId` jest `nullable` — „Bez kategorii" (ADR-039).
```

## 6a. Źródła przychodu — `dto/income-source.ts`

Dopisane przy `F2-4` — wcześniej 05 nie miał tej sekcji ([ADR-034](./14-decisions-log.md#adr-034)).

```ts
/** Źródło przychodu — wymaganie #10. */
export const IncomeSourceDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  kind: IncomeSourceKindSchema,
  /** Czyje to źródło; `null` = wspólne. */
  ownerUserId: IdSchema.nullable(),
  /** Czy wchodzi do podstawy celów procentowych (07 §2.3). */
  countsTowardAllocation: z.boolean(),
  isArchived: z.boolean(),
  sortOrder: z.number().int(),
});

export const CreateIncomeSourceRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: IncomeSourceKindSchema,
  ownerUserId: IdSchema.nullish(),
  /** Pominięte — `defaultCountsTowardAllocation(kind)`: `refund` → false, reszta → true. */
  countsTowardAllocation: z.boolean().optional(),
});

/** Zmiana `kind` nie przelicza `countsTowardAllocation`. */
export const UpdateIncomeSourceRequestSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  kind: IncomeSourceKindSchema.optional(),
  ownerUserId: IdSchema.nullish(),
  countsTowardAllocation: z.boolean().optional(),
});

export const ListIncomeSourcesQuerySchema = z.object({
  includeArchived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});
```

Porównanie nazw (kategorie, źródła) — `sameName` z `utils/names.ts`: bez względu na
wielkość liter, z polskimi znakami.

## 7. Transakcje — `dto/transaction.dto.ts`

Stan po `F2-5` ([ADR-035](./14-decisions-log.md#adr-035)). Plik w kodzie:
`dto/transaction.ts`, reguły kształtu w `domain/transaction.ts`, efekty alokacji
w `domain/allocation.ts`.

```ts
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
  monthKey: MonthKeySchema,
  /** Zawsze dodatnia; kierunek wynika z `type`. */
  amountMinor: PositiveAmountMinorSchema,
  currency: CurrencySchema,
  accountId: IdSchema.nullable(),
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
   * Liczony przy odczycie funkcją `allocationEffects` z `shared`, nie przechowywany.
   */
  allocationEffects: z.array(AllocationEffectDtoSchema),
  description: z.string().nullable(),
  merchant: z.string().nullable(),
  notes: z.string().nullable(),
  source: TransactionSourceSchema,
  sourceDocumentId: IdSchema.nullable(),
  recurringOccurrenceId: IdSchema.nullable(),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  deletedAt: TimestampSchema.nullable(),
});

/**
 * Transakcja wzbogacona o dane powiązanych bytów.
 *
 * Zwracana przez listy, szczegóły (`GET /transactions/:id`) i ekran miesiąca, żeby front
 * nie musiał łączyć danych po stronie klienta ani wykonywać dodatkowych żądań.
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
```

### Walidacja krzyżowa

Niezmienniki I-2, I-3 i I-7a z [03 §4](./03-data-model.md#4-niezmienniki-wymuszane-w-serwisach)
oraz „źródło przychodu tylko przy przychodzie" (I-3a) są **jedną funkcją** w `shared`:

```ts
/** Zwraca listę problemów `{ path, message }`; pusta = kształt poprawny. */
export function transactionShapeIssues(tx: TransactionShape): TransactionIssue[];
```

Korzystają z niej dwa miejsca:

- **formularz** — `CreateTransactionRequestSchema` = pola + `superRefine` z tą funkcją,
  więc błąd podświetla się pod polem, zanim cokolwiek pójdzie do API;
- **serwis** — sprawdza transakcję **po scaleniu** z `PATCH` i odpowiada `422`
  z problemami w `details`. „Przelew wymaga konta docelowego" to reguła domenowa, więc
  `422`, nie `400` ([04 §2](./04-api-spec.md#2-kody-statusu), ADR-016). Dlatego ciałem
  `POST /transactions` jest `TransactionFieldsSchema` — te same pola **bez** `superRefine`.

```ts
/** Opcjonalny tekst: przycięty, pusty zapisywany jako `null`. */
const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => (v === '' ? null : v));

/** Pola transakcji bez walidacji krzyżowej — ciało `POST /transactions`. */
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

/** Schemat formularza: te same pola plus reguły kształtu. */
export const CreateTransactionRequestSchema = TransactionFieldsSchema.superRefine(
  (value, ctx) => {
    for (const issue of transactionShapeIssues(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
    }
  },
);

/** Typ transakcji jest niezmienny — inaczej trzeba ją usunąć i dodać na nowo. */
export const UpdateTransactionRequestSchema = TransactionFieldsSchema.partial().omit({
  type: true,
});

/** Metadane odpowiedzi zapisu (`POST`, `PATCH`, `restore`). */
export const TransactionMutationMetaSchema = z.object({
  /** Miesiące, których cache front ma unieważnić (stary i nowy przy zmianie daty). */
  affectedMonths: z.array(MonthKeySchema),
});
```

### Filtry listy

```ts
/** Pojedyncza wartość albo powtórzony parametr → zawsze tablica (1–50 wartości). */
const oneOrMany = <T extends z.ZodTypeAny>(item: T) =>
  z.union([z.array(item).min(1).max(50), item.transform((v) => [v])]);

export const TransactionQuerySchema = CursorPaginationSchema.extend({
  month: MonthKeySchema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  type: oneOrMany(TransactionTypeSchema).optional(),
  accountId: oneOrMany(IdSchema).optional(),
  categoryId: oneOrMany(IdSchema).optional(),
  goalId: oneOrMany(IdSchema).optional(),
  liabilityId: oneOrMany(IdSchema).optional(),
  incomeSourceId: oneOrMany(IdSchema).optional(),
  allocationKind: oneOrMany(AllocationKindSchema).optional(),
  source: oneOrMany(TransactionSourceSchema).optional(),
  q: z.string().trim().max(100).optional(),
  /** Parametr zapytania przychodzi tekstem. */
  minAmountMinor: z.coerce.number().pipe(NonNegativeAmountMinorSchema).optional(),
  maxAmountMinor: z.coerce.number().pipe(NonNegativeAmountMinorSchema).optional(),
  /** Tylko transakcje bez kategorii (`Z-18`, ADR-041); wyklucza `categoryId`. */
  uncategorized: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Tylko dwa literały — `z.coerce.boolean()` zamieniłoby napis "false" na `true`. */
  includeDeleted: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  sort: z.enum([
    'bookedOn:desc', 'bookedOn:asc', 'amount:desc', 'amount:asc', 'createdAt:desc',
  ]).default('bookedOn:desc'),
}).superRefine(/* month wyklucza from/to; uncategorized wyklucza categoryId; from ≤ to; min ≤ max */);
```

Zmiany względem pierwotnego zapisu tej sekcji (ADR-035): `includeDeleted` bez
`z.coerce.boolean()`, kwoty z tekstu, filtry identyfikatorów i `source` wielokrotne
(jak w 04 §7), reguły spójności zakresów, osobne `TransactionFieldsSchema` jako ciało API.

### Podsumowanie listy (od `F2-8`, [ADR-038](./14-decisions-log.md#adr-038))

```ts
/** Sumy jednego dnia — nagłówek grupy dnia na ekranie historii. */
export const TransactionDayTotalSchema = z.object({
  bookedOn: DateOnlySchema,
  expenseMinor: NonNegativeAmountMinorSchema,
  incomeMinor: NonNegativeAmountMinorSchema,
});

/**
 * Podsumowanie dla bieżących filtrów: `count` — każda pasująca transakcja; sumy —
 * wyłącznie `posted` i nieusunięte (jak salda). Przelewy mają osobną sumę.
 */
export const TransactionListSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  expenseMinor: NonNegativeAmountMinorSchema,
  incomeMinor: NonNegativeAmountMinorSchema,
  transferMinor: NonNegativeAmountMinorSchema,
  days: z.array(TransactionDayTotalSchema), // od najnowszego
});

/** `meta` odpowiedzi `GET /transactions`; `summary` wyłącznie na pierwszej stronie. */
export const TransactionListMetaSchema = PaginationMetaSchema.extend({
  summary: TransactionListSummarySchema.optional(),
});
```

## 8. Zobowiązania — `dto/liability.dto.ts`

> **Stan po `F4-4`** ([ADR-047](./14-decisions-log.md#adr-047)) — w kodzie
> `packages/shared/src/dto/liability.ts`: `LiabilityDtoSchema` jak niżej, z kwotami stanu
> jako `NonNegativeAmountMinorSchema` i dodatkowo `installmentsRemainingAtAsOf`,
> `installmentsRemaining` (zawsze liczba), `nextDueOn`, `firstPaymentOn`, `lastPaymentOn`,
> `createdAt`, `updatedAt`; `LiabilityDetailDtoSchema` (+ `payments:
> TransactionListItemDto[]`); ciało `LiabilityFieldsSchema` bez walidacji krzyżowej
> i `CreateLiabilityRequestSchema` dla formularza (reguły z `liabilityIssues`);
> `UpdateLiabilityRequestSchema` (bez `createRecurringRule`, z `isActive`);
> `ListLiabilitiesQuerySchema`; `RebaseLiabilityRequestSchema` (`note` przycinane);
> `LiabilityPaymentRequestSchema`, `LiabilityPaymentResultDtoSchema`,
> `LiabilityMutationMetaSchema`; `ScheduledInstallmentDtoSchema`. Poniżej kształt z planu.

```ts
/** Zobowiązanie wraz z wyliczonym stanem bieżącym. */
export const LiabilityDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  kind: LiabilityKindSchema,
  creditor: z.string().nullable(),
  currency: CurrencySchema,

  openingBalanceMinor: AmountMinorSchema,
  balanceAsOf: DateOnlySchema,
  /** Wyliczane: `openingBalanceMinor` minus suma rat zaksięgowanych po `balanceAsOf`. */
  remainingMinor: AmountMinorSchema,
  paidSoFarMinor: AmountMinorSchema,

  monthlyPaymentMinor: PositiveAmountMinorSchema,
  installmentsTotal: z.number().int().nullable(),
  /** Wyliczane: `ceil(remainingMinor / monthlyPaymentMinor)`. */
  installmentsRemaining: z.number().int().nullable(),
  projectedFinalPaymentOn: DateOnlySchema.nullable(),

  interestRateBps: BpsSchema.nullable(),
  paymentDay: z.number().int().min(1).max(31).nullable(),
  paymentAccountId: IdSchema.nullable(),
  categoryId: IdSchema.nullable(),
  recurringRuleId: IdSchema.nullable(),

  /** Udział spłaconej części: 0 = nic, 10000 = spłacone w całości. */
  progressBps: BpsSchema,
  paidThisMonth: z.boolean(),
  isActive: z.boolean(),
  notes: z.string().nullable(),
});

export const CreateLiabilityRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: LiabilityKindSchema,
  creditor: z.string().max(60).nullish(),
  /** Pozostała kwota do spłaty na dzień `balanceAsOf` (wymaganie #2). */
  openingBalanceMinor: PositiveAmountMinorSchema,
  balanceAsOf: DateOnlySchema,
  monthlyPaymentMinor: PositiveAmountMinorSchema,
  installmentsTotal: z.number().int().positive().nullish(),
  installmentsRemainingAtAsOf: z.number().int().positive().nullish(),
  interestRateBps: BpsSchema.nullish(),
  paymentDay: z.number().int().min(1).max(31).nullish(),
  firstPaymentOn: DateOnlySchema.nullish(), // najbliższa rata wprost; brak → po balanceAsOf (ADR-068)
  paymentAccountId: IdSchema.nullish(),
  categoryId: IdSchema.nullish(),
  /** Gdy `true`, tworzona jest od razu reguła cykliczna na ratę. */
  createRecurringRule: z.boolean().default(false),
  notes: z.string().max(1000).nullish(),
});

/** Korekta stanu zobowiązania do wartości z wyciągu bankowego. */
export const RebaseLiabilityRequestSchema = z.object({
  remainingMinor: AmountMinorSchema.nonnegative(),
  asOf: DateOnlySchema,
  note: z.string().max(200).nullish(),
});
```

## 9. Cele — `dto/goal.dto.ts`

```ts
/** Plan wpłat na cel wraz z przeliczeniem na procent wpływów miesiąca. */
export const GoalContributionDtoSchema = z.object({
  mode: ContributionModeSchema,
  /** Kwota planowana na miesiąc — dla trybu procentowego wyliczona z wpływów. */
  plannedAmountMinor: AmountMinorSchema.nullable(),
  /** Udział planowanej kwoty we wpływach miesiąca — druga strona przelicznika. */
  plannedPercentBps: BpsSchema.nullable(),
  contributedThisMonthMinor: AmountMinorSchema,
  isPlanMetThisMonth: z.boolean(),
});

/** Prognoza dojścia do celu przy bieżącym tempie wpłat. */
export const GoalProjectionDtoSchema = z.object({
  monthsToTargetAtCurrentPace: z.number().int().nullable(),
  projectedCompletionMonth: MonthKeySchema.nullable(),
  /** Ile trzeba wpłacać miesięcznie, żeby zdążyć na `targetDate`. */
  requiredMonthlyToHitTargetDateMinor: AmountMinorSchema.nullable(),
  isOnTrack: z.boolean().nullable(),
});

export const GoalDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  kind: GoalKindSchema,
  purpose: z.string().nullable(),
  targetAmountMinor: AmountMinorSchema.nullable(),
  targetDate: DateOnlySchema.nullable(),
  startingAmountMinor: AmountMinorSchema,
  linkedAccountId: IdSchema.nullable(),
  progressSource: ProgressSourceSchema,
  currentAmountMinor: AmountMinorSchema,
  /** Postęp względem `targetAmountMinor`; `null` dla celów bez kwoty docelowej. */
  progressBps: BpsSchema.nullable(),
  remainingMinor: AmountMinorSchema.nullable(),
  contribution: GoalContributionDtoSchema,
  projection: GoalProjectionDtoSchema,
  priority: z.number().int(),
  color: HexColorSchema.nullable(),
  icon: z.string().nullable(),
  status: GoalStatusSchema,
});

export const CreateGoalRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    kind: GoalKindSchema,
    purpose: z.string().max(40).nullish(),
    targetAmountMinor: PositiveAmountMinorSchema.nullish(),
    targetDate: DateOnlySchema.nullish(),
    startingAmountMinor: AmountMinorSchema.default(0),
    linkedAccountId: IdSchema.nullish(),
    progressSource: ProgressSourceSchema.default('contributions'),
    contributionMode: ContributionModeSchema.default('fixed'),
    contributionAmountMinor: PositiveAmountMinorSchema.nullish(),
    contributionPercentBps: BpsSchema.nullish(),
    color: HexColorSchema.nullish(),
    icon: z.string().max(40).nullish(),
  })
  .superRefine((value, ctx) => {
    // I-14: tryb wpłaty musi mieć wypełnione odpowiadające mu pole.
    if (value.contributionMode === 'fixed' && value.contributionAmountMinor == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contributionAmountMinor'],
        message: 'Podaj kwotę miesięcznej wpłaty',
      });
    }
    if (value.contributionMode === 'percent_of_income' && value.contributionPercentBps == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contributionPercentBps'],
        message: 'Podaj procent wpływów',
      });
    }
    if (value.progressSource === 'account_balance' && !value.linkedAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['linkedAccountId'],
        message: 'Śledzenie po saldzie wymaga wskazania konta',
      });
    }
  });

/**
 * Żądanie przelicznika % ↔ kwota (wymaganie #6).
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
  .refine(
    (v) => (v.amountMinor == null) !== (v.percentBps == null),
    { message: 'Podaj dokładnie jedno: kwotę albo procent' },
  );

export const ConvertContributionResponseSchema = z.object({
  month: MonthKeySchema,
  /** Suma przychodów miesiąca ze źródeł oznaczonych `countsTowardAllocation`. */
  incomeBaseMinor: AmountMinorSchema,
  amountMinor: AmountMinorSchema,
  percentBps: BpsSchema,
  /** `true`, gdy miesiąc jeszcze trwa — podstawa może wzrosnąć. */
  isPartialMonth: z.boolean(),
  basedOnIncomeSoFar: z.boolean(),
});
```

**Stan po `F5-1`, `F5-2`** ([ADR-052](./14-decisions-log.md#adr-052)). W kodzie:
`packages/shared/src/dto/goal.ts`, reguły w `domain/goal.ts`. Różnice względem szkicu wyżej:

- `purpose` — `GoalPurposeSchema` (enum z `CHECK` tabeli), nie dowolny tekst.
- `GoalDto` dokłada zapisaną stronę przelicznika (`contributionAmountMinor`,
  `contributionPercentBps`), `achievedAt`, `createdAt`, `updatedAt`; `currentAmountMinor`,
  `remainingMinor` nieujemne; `contribution.contributedThisMonthMinor` ze znakiem (netto).
- `GoalProjectionDto` dokłada `paceMonthlyMinor` (tempo, na którym stoi prognoza).
- Ciało `POST` to `GoalFieldsSchema` bez walidacji krzyżowej; `CreateGoalRequestSchema`
  (formularz) stosuje `goalIssues` przez `superRefine` — jak ADR-035.
- `UpdateGoalRequestSchema` — wszystkie pola opcjonalne **bez** domyślnych, plus
  `status: 'active' | 'paused' | 'archived'`.
- Nowe: `GoalsListMetaSchema`, `GoalDetailDtoSchema` (`contributions`, `history`),
  `GoalContributionRequestSchema`, `GoalContributionResultDtoSchema`,
  `ReorderGoalsRequestSchema`, `ListGoalsQuerySchema` (`month`, `kind`, `includeArchived`).

## 10. Rozkład docelowy — `dto/allocation.dto.ts`

```ts
/** Założony rozkład procentowy obowiązujący od danego miesiąca (wymaganie #8). */
export const AllocationTargetDtoSchema = z.object({
  id: IdSchema,
  effectiveFromMonth: MonthKeySchema,
  savingsPercentBps: BpsSchema,
  investmentPercentBps: BpsSchema,
  debtPercentBps: BpsSchema,
  note: z.string().nullable(),
});

export const UpsertAllocationTargetRequestSchema = z.object({
  effectiveFromMonth: MonthKeySchema,
  savingsPercentBps: BpsSchema,
  investmentPercentBps: BpsSchema,
  debtPercentBps: BpsSchema.default(0),
  note: z.string().max(200).nullish(),
});

/** Jedna linia porównania plan/wykonanie. */
export const AllocationLineDtoSchema = z.object({
  kind: z.enum(['savings', 'investment', 'debt_repayment']),
  targetPercentBps: BpsSchema,
  targetAmountMinor: AmountMinorSchema,
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

/** Stan realizacji celów procentowych w miesiącu — zasila kafel na ekranie głównym. */
export const AllocationStatusDtoSchema = z.object({
  month: MonthKeySchema,
  incomeBaseMinor: AmountMinorSchema,
  isPartialMonth: z.boolean(),
  daysElapsed: z.number().int(),
  daysInMonth: z.number().int(),
  lines: z.array(AllocationLineDtoSchema),
  totals: z.object({
    targetPercentBps: BpsSchema,
    actualPercentBps: z.number().int(),
    targetAmountMinor: AmountMinorSchema,
    actualAmountMinor: AmountMinorSchema,
    /** Ile jeszcze trzeba przelać, żeby domknąć plan miesiąca. */
    shortfallMinor: AmountMinorSchema,
  }),
});
```

**Stan po `F5-3`** ([ADR-053](./14-decisions-log.md#adr-053)). W kodzie:
`packages/shared/src/dto/allocation.ts`, porównanie w `domain/allocation-status.ts`.
Różnice: udziały w `UpsertAllocationTargetRequestSchema` ≤ 10 000 bps każdy, pusta notatka
→ `null`; `AllocationTargetDto` z `createdAt`/`updatedAt`; `AllocationStatusDto` dokłada
`effectiveFromMonth` (nullable), kwoty planu nieujemne; nowe `AllocationTargetMetaSchema`
(`warning`), `AllocationMonthQuerySchema`, `AllocationTrendQuerySchema` (≤ 24 miesiące).

## 11. Pozycje cykliczne — `dto/recurring.dto.ts`

> **Stan po `F4-1`** ([ADR-043](./14-decisions-log.md#adr-043)) — w kodzie
> `packages/shared/src/dto/recurring.ts`: `RecurringRuleDtoSchema` (z `createdAt`,
> `updatedAt`), `RecurringRuleDetailDtoSchema` (+ `upcomingDueDates`), ciało
> `RecurringRuleFieldsSchema` bez walidacji krzyżowej i `CreateRecurringRuleRequestSchema`
> dla formularza (reguły z `recurringRuleShapeIssues`, 07 §6.1), `UpdateRecurringRuleRequestSchema`
> (bez `flow` i bez wartości domyślnych), `ListRecurringRulesQuerySchema`.
> Wspólna normalizacja: `recurringRuleFromRequest`.
>
> **Stan po `F4-2`** ([ADR-045](./14-decisions-log.md#adr-045)): `RecurringOccurrenceDtoSchema`
> z `id` **nullable** (`null` = podgląd miesiąca przyszłego, bez zapisu) i `plannedAmountMinor`
> / `postedAmountMinor` jako `PositiveAmountMinorSchema`; `RecurringOccurrencesMetaSchema`
> (`month`, `isPreview`, `plannedTotalMinor`, `postedTotalMinor`, `remainingTotalMinor`,
> `byFlow` z `OccurrenceFlowTotalsDtoSchema`); `ListOccurrencesQuerySchema` (`month`
> wymagany); `GenerateOccurrencesRequestSchema` i `GenerateOccurrencesResultDtoSchema`
> (`month`, `createdCount`). `allocationEffects` używa `AllocationEffectDtoSchema`
> z kontraktu transakcji.
>
> **Stan po `F4-3`** ([ADR-046](./14-decisions-log.md#adr-046)): `OccurrenceParamsSchema`,
> `PostOccurrenceRequestSchema` (jak niżej; `notes` przycinane, puste jako `null`),
> `PostOccurrenceResultDtoSchema` (`occurrence`, `transaction: TransactionDto`),
> `OccurrenceMutationMetaSchema` (= `TransactionMutationMetaSchema`, `affectedMonths`),
> `SkipOccurrenceRequestSchema` (`reason` do 200 znaków, pusty jako `null`).
> Poniżej kształt z planu.

```ts
/** Definicja powtarzalnej transakcji (wymagania #3 i #9). */
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
  intervalCount: z.number().int().min(1),
  dayOfMonth: z.number().int().min(1).max(31).nullable(),
  weekday: z.number().int().min(0).max(6).nullable(),
  monthOfYear: z.number().int().min(1).max(12).nullable(),
  anchorDate: DateOnlySchema,
  startMonth: MonthKeySchema,
  endMonth: MonthKeySchema.nullable(),
  autoPost: z.boolean(),
  isFixedExpense: z.boolean(),
  isActive: z.boolean(),
  notes: z.string().nullable(),
  nextDueOn: DateOnlySchema.nullable(),
});

export const CreateRecurringRuleRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    flow: TransactionTypeSchema,
    amountMinor: PositiveAmountMinorSchema,
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
    anchorDate: DateOnlySchema.optional(),
    startMonth: MonthKeySchema,
    endMonth: MonthKeySchema.nullish(),
    autoPost: z.boolean().default(false),
    isFixedExpense: z.boolean().default(false),
    notes: z.string().max(1000).nullish(),
  })
  .superRefine((value, ctx) => {
    const needsDayOfMonth = ['monthly', 'quarterly', 'yearly', 'every_n_months'];
    if (needsDayOfMonth.includes(value.frequency) && value.dayOfMonth == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dayOfMonth'],
        message: 'Podaj dzień miesiąca',
      });
    }
    if (['weekly', 'biweekly'].includes(value.frequency) && value.weekday == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weekday'],
        message: 'Podaj dzień tygodnia',
      });
    }
    if (value.frequency === 'yearly' && value.monthOfYear == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['monthOfYear'],
        message: 'Podaj miesiąc',
      });
    }
    if (value.flow === 'transfer' && !value.counterAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['counterAccountId'],
        message: 'Przelew cykliczny wymaga konta docelowego',
      });
    }
  });

/** Konkretna instancja reguły w danym miesiącu. */
export const RecurringOccurrenceDtoSchema = z.object({
  /** `null` — podgląd miesiąca przyszłego, wystąpienia nie ma w bazie (ADR-045). */
  id: IdSchema.nullable(),
  ruleId: IdSchema,
  ruleName: z.string(),
  flow: TransactionTypeSchema,
  dueOn: DateOnlySchema,
  monthKey: MonthKeySchema,
  plannedAmountMinor: AmountMinorSchema,
  status: OccurrenceStatusSchema,
  postedAmountMinor: AmountMinorSchema.nullable(),
  transactionId: IdSchema.nullable(),
  categoryId: IdSchema.nullable(),
  categoryName: z.string().nullable(),
  /** Przewidywany wpływ na pule po zaksięgowaniu; wyliczany z klas kont reguły. */
  allocationEffects: z.array(
    z.object({ kind: AllocationKindSchema, amountMinor: AmountMinorSchema }),
  ),
  isFixedExpense: z.boolean(),
  /** `true`, gdy termin minął, a wystąpienie wciąż czeka na potwierdzenie. */
  isOverdue: z.boolean(),
  amountIsEstimate: z.boolean(),
});

/** Zaksięgowanie wystąpienia. Puste ciało księguje kwotę planowaną w terminie. */
export const PostOccurrenceRequestSchema = z.object({
  amountMinor: PositiveAmountMinorSchema.optional(),
  bookedOn: DateOnlySchema.optional(),
  accountId: IdSchema.optional(),
  notes: z.string().max(1000).nullish(),
});

/**
 * „Zapisz jako wydatek stały" — `POST /transactions/:id/save-as-recurring` (`F4-8`, ADR-051).
 * Kwota, konta, kategoria, źródło, cel i zobowiązanie — z transakcji; ciało to terminarz.
 * Pominięte: `frequency` = `monthly`, dzień / dzień tygodnia / miesiąc roku — z daty
 * transakcji, `startMonth` — jej miesiąc, `name` — opis → zobowiązanie → sprzedawca →
 * kategoria → źródło (`recurringNameFromTransaction`), `isFixedExpense` — `true` przy wydatku.
 */
export const SaveAsRecurringRequestSchema = RecurringRuleFieldsSchema.pick({
  amountIsEstimate: true, intervalCount: true, dayOfMonth: true, weekday: true,
  monthOfYear: true, anchorDate: true, endMonth: true, autoPost: true, notes: true,
}).extend({
  name: RecurringRuleFieldsSchema.shape.name.optional(),
  frequency: FrequencySchema.default('monthly'),
  startMonth: MonthKeySchema.optional(),
  isFixedExpense: z.boolean().optional(),
});
// Wspólne dla serwera i podglądu w formularzu:
// recurringRuleFromTransaction(tx, input) → CreateRecurringRuleRequest
// sourcePaymentDueOn / dueDatesAfterSource (domain/recurring.ts) — termin opłacony transakcją
```

## 11a. Planowane wydatki — `dto/planned-expense.dto.ts`

```ts
/** Stan odkładania na planowany wydatek (sinking fund). */
export const SetAsideDtoSchema = z.object({
  enabled: z.boolean(),
  accountId: IdSchema.nullable(),
  goalId: IdSchema.nullable(),
  /** Kwota zebrana do tej pory: wpłaty oznaczone tym wydatkiem + kwota początkowa. */
  accumulatedMinor: AmountMinorSchema,
  remainingMinor: AmountMinorSchema,
  /** Pokrycie szacunku: 10000 = odłożone w całości. */
  coverageBps: BpsSchema,
  /**
   * Ile trzeba odkładać miesięcznie, żeby zdążyć na termin.
   *
   * Wyliczane przy każdym odczycie, nie przechowywane — po pominięciu wpłaty
   * rata rośnie, a zapisana wartość byłaby nieaktualna zaraz po zapisie.
   */
  monthlyRequiredMinor: AmountMinorSchema,
  paidThisMonth: z.boolean(),
  isOnTrack: z.boolean(),
});

/** Większy wydatek zaplanowany na przyszłość (wymaganie #13). */
export const PlannedExpenseDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  estimatedAmountMinor: PositiveAmountMinorSchema,
  amountIsEstimate: z.boolean(),
  currency: CurrencySchema,
  dueMonth: MonthKeySchema,
  dueOn: DateOnlySchema.nullable(),
  /** Liczba pełnych miesięcy do terminu; 0 = wypada w tym miesiącu, ujemne = zaległy. */
  monthsUntilDue: z.number().int(),
  categoryId: IdSchema.nullable(),
  categoryName: z.string().nullable(),
  accountId: IdSchema.nullable(),
  liabilityId: IdSchema.nullable(),
  priority: PlannedExpensePrioritySchema,
  status: PlannedExpenseStatusSchema,
  setAside: SetAsideDtoSchema,
  repeatsYearly: z.boolean(),
  transactionId: IdSchema.nullable(),
  postedAmountMinor: AmountMinorSchema.nullable(),
  notes: z.string().nullable(),
});

export const CreatePlannedExpenseRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
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
    setAsideStartMonth: MonthKeySchema.nullish(),
    alreadySetAsideMinor: AmountMinorSchema.nonnegative().default(0),
    repeatsYearly: z.boolean().default(false),
    notes: z.string().max(1000).nullish(),
  })
  .superRefine((value, ctx) => {
    // I-16: dokładna data musi należeć do zadeklarowanego miesiąca.
    if (value.dueOn && value.dueOn.slice(0, 7) !== value.dueMonth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dueOn'],
        message: 'Data musi mieścić się w wybranym miesiącu',
      });
    }
    // I-17: odkładanie musi wiedzieć, gdzie gromadzić pieniądze.
    if (value.setAsideEnabled && !value.setAsideAccountId && !value.setAsideGoalId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['setAsideAccountId'],
        message: 'Wskaż konto lub cel, na którym odkładasz',
      });
    }
    // I-19
    if (value.setAsideStartMonth && value.setAsideStartMonth > value.dueMonth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['setAsideStartMonth'],
        message: 'Odkładanie nie może zaczynać się po terminie wydatku',
      });
    }
  });

export const UpdatePlannedExpenseRequestSchema =
  CreatePlannedExpenseRequestSchema.innerType().partial();

/** Zaksięgowanie miesięcznej wpłaty na odkładanie. */
export const SetAsideContributionRequestSchema = z.object({
  /** Pominięte → księgowana jest wyliczona `monthlyRequiredMinor`. */
  amountMinor: PositiveAmountMinorSchema.optional(),
  bookedOn: DateOnlySchema.optional(),
  fromAccountId: IdSchema.optional(),
});

/** Zaksięgowanie samego wydatku, gdy nadejdzie termin. */
export const PostPlannedExpenseRequestSchema = z.object({
  /** Rzeczywista kwota — zwykle różni się od szacunku. */
  amountMinor: PositiveAmountMinorSchema,
  bookedOn: DateOnlySchema,
  accountId: IdSchema,
  categoryId: IdSchema.nullish(),
  notes: z.string().max(1000).nullish(),
});

/** Ostrzeżenie o niewystarczającym pokryciu wydatku w danym miesiącu. */
export const LiquidityWarningSchema = z.object({
  month: MonthKeySchema,
  code: z.enum(['INSUFFICIENT_PROJECTED_BALANCE', 'UNFUNDED_MUST_EXPENSE', 'SET_ASIDE_BEHIND']),
  message: z.string(),
  gapMinor: AmountMinorSchema,
});

/** Prognoza obciążeń w horyzoncie kilku miesięcy — zasila ekran i kafel na dashboardzie. */
export const UpcomingExpensesMetaSchema = z.object({
  horizonMonths: z.number().int(),
  totalUpcomingMinor: AmountMinorSchema,
  totalSetAsideMinor: AmountMinorSchema,
  /** Suma rat odkładania ze wszystkich aktywnych wydatków — kluczowa liczba tej funkcji. */
  monthlySetAsideRequiredMinor: AmountMinorSchema,
  byMonth: z.array(
    z.object({
      month: MonthKeySchema,
      totalMinor: AmountMinorSchema,
      coveredMinor: AmountMinorSchema,
      shortfallMinor: AmountMinorSchema,
    }),
  ),
  liquidityWarnings: z.array(LiquidityWarningSchema),
});
```

**Stan po `F6-1`…`F6-5`** ([ADR-055](./14-decisions-log.md#adr-055)). W kodzie:
`packages/shared/src/dto/planned-expense.ts`, reguły w `domain/planned-expense.ts`.
Różnice: `SetAsideDto` + `startMonth`, `monthsLeft`, kwoty nieujemne; `PlannedExpenseDto` +
`alreadySetAsideMinor`, `previousInstanceId`, `postedAt`, `createdAt`, `updatedAt`;
`PlannedExpenseFieldsSchema` (ciało `POST`, bez walidacji krzyżowej) i
`CreatePlannedExpenseRequestSchema` (formularz, `plannedExpenseIssues`);
`UpdatePlannedExpenseRequestSchema` bez domyślnych; `PostPlannedExpenseRequestSchema` —
wszystkie pola opcjonalne; nowe `PlannedExpenseDetailDtoSchema`,
`DeferPlannedExpenseRequestSchema`, `SetAsideResultDtoSchema`,
`PostPlannedExpenseResultDtoSchema`, `LiquidityWarningDtoSchema` (z `plannedExpenseId`),
`MonthPlannedExpensesSectionDtoSchema`. `TransactionDto` dostał `plannedExpenseId`,
`TransactionQuery` — filtr `plannedExpenseId`.

## 12. Dokumenty / OCR — `dto/document.dto.ts`

```ts
/** Pozycja odczytana z dokumentu, oczekująca na weryfikację. */
export const DocumentItemDtoSchema = z.object({
  id: IdSchema,
  lineNo: z.number().int(),
  rawText: z.string().nullable(),
  description: z.string(),
  quantity: z.number().nullable(),
  unitPriceMinor: AmountMinorSchema.nullable(),
  amountMinor: AmountMinorSchema,
  direction: z.enum(['inflow', 'outflow']),
  bookedOn: DateOnlySchema.nullable(),
  suggestedCategoryId: IdSchema.nullable(),
  /** Nazwa kategorii zaproponowanej przez AI, gdy żadna istniejąca nie pasuje. */
  suggestedCategoryName: z.string().nullable(),
  /** Pewność dopasowania w zakresie 0–1; poniżej 0,6 UI oznacza pozycję do sprawdzenia. */
  confidence: z.number().min(0).max(1).nullable(),
  reviewStatus: ReviewStatusSchema,
  transactionId: IdSchema.nullable(),
  duplicateOfTransactionId: IdSchema.nullable(),
});

/** Nagłówek odczytany z dokumentu. */
export const DocumentSummaryDtoSchema = z.object({
  merchant: z.string().nullable(),
  bookedOn: DateOnlySchema.nullable(),
  totalMinor: AmountMinorSchema.nullable(),
  currency: CurrencySchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  detectedMonthKey: MonthKeySchema.nullable(),
});

export const DocumentDtoSchema = z.object({
  id: IdSchema,
  kind: DocumentKindSchema,
  status: DocumentStatusSchema,
  originalFilename: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  fileUrl: z.string(),
  summary: DocumentSummaryDtoSchema.nullable(),
  suggestedAccountId: IdSchema.nullable(),
  items: z.array(DocumentItemDtoSchema),
  /** Kategorie, których AI nie znalazło na liście — do jednoklikowego dodania. */
  newCategoryProposals: z.array(
    z.object({
      name: z.string(),
      kind: CategoryKindSchema,
      itemIds: z.array(IdSchema),
    }),
  ),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  ai: z
    .object({
      model: z.string(),
      costMinor: AmountMinorSchema,
      processedAt: TimestampSchema,
    })
    .nullable(),
  createdAt: TimestampSchema,
});

/** Korekta pozycji przed zatwierdzeniem dokumentu. */
export const UpdateDocumentItemRequestSchema = z.object({
  description: z.string().max(200).optional(),
  amountMinor: PositiveAmountMinorSchema.optional(),
  suggestedCategoryId: IdSchema.nullish(),
  bookedOn: DateOnlySchema.optional(),
  reviewStatus: z.enum(['pending', 'accepted', 'rejected']).optional(),
});

/**
 * Zatwierdzenie dokumentu i utworzenie transakcji.
 *
 * `single`      — cały paragon jako jedna transakcja (typowy przypadek zakupów).
 * `by_category` — jedna transakcja na kategorię wydatku (07 §9.4, ADR-069).
 * `split`       — osobna transakcja na każdą zaakceptowaną pozycję (przydatne przy wyciągu).
 */
export const CommitDocumentRequestSchema = z
  .object({
    mode: z.enum(['single', 'by_category', 'split']),
    accountId: IdSchema,
    bookedOn: DateOnlySchema,
    categoryId: IdSchema.nullish(),
    itemIds: z.array(IdSchema).min(1, 'Wybierz przynajmniej jedną pozycję'),
    createCategories: z
      .array(
        z.object({
          name: z.string().min(1).max(50),
          kind: CategoryKindSchema,
          parentId: IdSchema.nullish(),
        }),
      )
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'single' && !value.categoryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categoryId'],
        message: 'Wybierz kategorię dla całego dokumentu',
      });
    }
  });
```

### Stan po implementacji (`F7-1`…`F7-10`, [ADR-059](./14-decisions-log.md#adr-059))

Plik to `shared/src/dto/document.ts`. Względem szkicu wyżej:

- `DocumentSummaryDto` ma dodatkowo `notes` (uwagi modelu), `accountHint`, `periodFrom`,
  `periodTo` (wyciąg); `DocumentDto` — `pageCount`; `ai.costMinor` nieujemne.
- `LOW_CONFIDENCE = 0.6` — próg „do sprawdzenia" eksportowany ze schematu.
- `DocumentListItemDto` (`id`, `kind`, `status`, `originalFilename`, `merchant`, `bookedOn`,
  `totalMinor`, `itemCount`, `errorMessage`, `createdAt`), `DocumentQuery`
  (`status`, `month`, `limit`).
- `UploadDocumentFields` (`kind` bez `other`, `accountId` i `monthHint` — pusty napis
  pola formularza to brak) i `UploadDocumentResponse` (`id`, `status`, `pollAfterMs`).
- `UpdateDocumentRequest` (`kind`, `merchant`, `bookedOn`, `accountId`);
  `UpdateDocumentItemRequest` dostało `direction`, opis przycięty i niepusty.
- `CommitDocumentRequest`: `categoryName` (nowa kategoria całości z `createCategories`),
  `merchant`, `itemIds` do 200, `createCategories` do 20 z `CategoryNameSchema`
  (eksportowany z `category.ts`); `CommitDocumentResponse` = `{ document, transactions }`,
  meta jak zapis transakcji.
- `AiUsageDto` — `enabled`, `model`, `monthKey`, `documentCount`, `inputTokens`,
  `outputTokens`, `spentMinor`, `budgetMinor`, `remainingMinor`.
- `transaction.ts`: `BulkCreateTransactionsRequest` (`transactions` 1–100,
  `BULK_TRANSACTIONS_MAX`).
- Reguły wspólne w `shared/domain/document.ts`: `documentItemsNetMinor`,
  `checkDocumentTotal`, `findDuplicates` (±3 dni, `DUPLICATE_WINDOW_DAYS`),
  `collectCategoryProposals`; w `utils/month.ts` — `addDays`, `daysBetween`.

## 13. Miesiąc — `dto/month.dto.ts`

W kodzie: `packages/shared/src/dto/month.ts`. Podsumowanie rośnie **sekcja po sekcji**
([ADR-039](./14-decisions-log.md#adr-039)) — niżej stan po `F3-2`. Od `F4-7`
([ADR-050](./14-decisions-log.md#adr-050)) dochodzą `recurring: MonthRecurringSectionDtoSchema`
(pola jak niżej, `items` z zaległymi z wcześniejszych miesięcy) i `liabilities:
MonthLiabilitiesSectionDtoSchema` (pola jak niżej; `items` — aktywne). Od `F5-8`:
`allocation: AllocationStatusDtoSchema` i `goals: z.array(GoalDtoSchema)` (aktywne). Od `F6-8`:
`plannedExpenses: MonthPlannedExpensesSectionDtoSchema` (ADR-055). Od `F9-8`:
`budget: MonthBudgetSectionDtoSchema` (§13b, ADR-079).
Sekcje dochodzące później (kształt docelowy z pierwotnego planu):

```ts
// F5-8
allocation: AllocationStatusDtoSchema,
goals: z.array(GoalDtoSchema),
// F4-7
liabilities: z.object({
  totalRemainingMinor, monthlyPaymentTotalMinor, paidThisMonthMinor,
  unpaidCount: z.number().int(), items: z.array(LiabilityDtoSchema),
}),
recurring: z.object({
  plannedTotalMinor, postedTotalMinor, pendingCount, overdueCount,
  items: z.array(RecurringOccurrenceDtoSchema),
}),
// Faza 6
plannedExpenses: z.object({
  dueThisMonthMinor, upcoming6MonthsMinor, monthlySetAsideRequiredMinor,
  setAsidePaidThisMonthMinor, warningCount, items: z.array(PlannedExpenseDtoSchema),
}),
```

```ts
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
  /** Zmiana względem poprzedniego miesiąca; `0`, gdy tam było zero (07 §3, `toBps`). */
  incomeDeltaBps: SignedBpsSchema,
  expenseDeltaMinor: AmountMinorSchema,
  expenseDeltaBps: SignedBpsSchema,
});
/** Porównanie z poprzednim miesiącem. */
export type MonthComparisonDto = z.infer<typeof MonthComparisonDtoSchema>;

/**
 * Ładunek ekranu miesiąca — jedno żądanie rysuje cały dashboard (04 §14).
 *
 * Sekcje Faz 4–6 (`allocation`, `goals`, `liabilities`, `recurring`, `plannedExpenses`)
 * dochodzą razem ze swoimi modułami (ADR-039).
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
```

## 13a. Ustawienia — `dto/settings.ts`

Od `F8-1`/`F8-2` ([ADR-061](./14-decisions-log.md#adr-061)).

```ts
/** Strefa IANA — sprawdzana konstruktorem `Intl.DateTimeFormat`. */
export function isValidTimeZone(value: string): boolean;
export const TimeZoneSchema = z.string().trim().refine(isValidTimeZone, 'Nieznana strefa czasowa');

export const HouseholdMemberDtoSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  displayName: z.string(),
  avatarColor: HexColorSchema.nullable(),
  isCurrent: z.boolean(),          // zalogowana osoba — tylko ona zmienia swój profil i PIN
  lastLoginAt: TimestampSchema.nullable(),
});

export const SettingsDtoSchema = z.object({
  household: HouseholdDtoSchema,
  users: z.array(HouseholdMemberDtoSchema), // aktywni, zalogowany pierwszy
  appVersion: z.string(),
});

export const UpdateHouseholdRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  timezone: TimeZoneSchema,
  backPostingLimitMonths: z.number().int().min(0).max(12),
  monthStartDay: z.literal(1),     // ADR-006
  defaultExpenseAccountId: IdSchema.nullable(), // ADR-070
}).partial();

export const UpdateProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  avatarColor: HexColorSchema.nullable(),
}).partial();

export const EXPORT_FORMAT = 'fineapp-export';
export const EXPORT_VERSION = 1;
export const EXPORT_TABLES = [
  'accounts', 'categories', 'incomeSources', 'goals', 'liabilities', 'allocationTargets',
  'recurringRules', 'recurringOccurrences', 'plannedExpenses', 'documents',
  'documentItems', 'transactions',
] as const;                        // kolejność kluczy obcych — pod przyszły import

export const ExportDtoSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: TimestampSchema,
  appVersion: z.string(),
  household: HouseholdDtoSchema,
  users: z.array(z.object({ id, email, displayName, avatarColor, isActive, createdAt })),
  tables: z.object({ /* każda z EXPORT_TABLES: z.array(z.record(z.string(), z.unknown())) */ }),
});

export const ExportCsvQuerySchema = z.object({ month: MonthKeySchema.optional() });
export function exportFileName(kind: 'json' | 'csv', stamp: string): string; // fineapp-<stamp>.<kind>
```

Wiersz tabeli w eksporcie ma kolumny w `camelCase`, kwoty w groszach, czas w ms — tak,
jak zapisuje je baza.

Usunięcie wszystkich danych ([ADR-072](./14-decisions-log.md#adr-072)):

```ts
export const ResetDataRequestSchema = z.object({ pin: PinSchema });   // PIN zalogowanej osoby
export const ResetDataResultSchema = z.object({
  deleted: z.object({ /* każda z EXPORT_TABLES: z.number().int().nonnegative() */ }),
});
```

## 13b. Planer budżetu — `dto/budget.ts`

> **Faza 9 — zrobione w `F9-2`** (`packages/shared/src/dto/budget.ts`, nazwa pliku jak
> pozostałe DTO). Czyste wyliczenia: `domain/budget.ts`. Reguły:
> [07 §13](./07-domain-rules.md#13-planer-budżetu), endpointy:
> [04 §14a](./04-api-spec.md#14a-planer-budżetu--apiv1budget-drafts). Poniżej skrót —
> wiążący jest kod z testami (`dto/budget.test.ts`).
>
> Doprecyzowania z `F9-2`: zamiana w regułę **wymaga** `accountId` (reguła bez konta nie
> powstaje, §11); doszły `UpdateBudgetDraftRequestSchema`, `BudgetLineParamsSchema`
> (`monthKey`, `lineId`), `CategoryAveragesQuerySchema` (`months` z zapytania, domyślnie 3)
> i `BudgetPromoteTargetSchema`; `sourceState` ma swoje typy też w `domain/budget.ts`
> (test pilnuje zgodności list).

```ts
// BudgetLineFlowSchema i BudgetLineOriginSchema — w `domain/enums.ts` (§2), bo idą
// do CHECK w DDL (od `F9-1`).
export const BudgetSourceStateSchema = z.enum([
  'in_sync', 'source_changed', 'not_in_month', 'missing',
]);
export const AverageMonthsSchema = z.union([z.literal(3), z.literal(6), z.literal(12)]);

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
  /** Kwota źródła z chwili wypełnienia albo ostatniego „Przyjmij”. */
  sourceAmountMinor: AmountMinorSchema.nullable(),
  /**
   * Stan źródła liczony przy odczycie (07 §13.5); `null` dla linii własnych
   * i w szkicu tylko do odczytu.
   */
  sourceState: BudgetSourceStateSchema.nullable(),
  /** Bieżąca kwota źródła dla miesiąca szkicu — tylko przy `source_changed`. */
  sourceCurrentAmountMinor: AmountMinorSchema.nullable(),
  averageMonths: AverageMonthsSchema.nullable(),
  isExcluded: z.boolean(),
  /** Co można z linią zrobić — front nie powtarza reguł z 07 §13.6–13.7. */
  canPromote: z.array(z.enum(['recurring', 'planned'])),
  canApplyToSource: z.boolean(),
  sortOrder: z.number().int(),
  notes: z.string().nullable(),
});

/** Ocena linii rozkładu docelowego w planie (07 §13.4). */
export const BudgetAllocationLineSchema = z.object({
  kind: z.enum(['savings', 'investment', 'debt']),
  targetBps: BpsSchema,
  targetMinor: NonNegativeAmountMinorSchema,
  plannedMinor: AmountMinorSchema,          // netto — może być ujemne
  plannedBps: SignedBpsSchema,
  status: z.enum(['met', 'short']),
  shortfallMinor: NonNegativeAmountMinorSchema,
});

export const BudgetGoalCheckSchema = z.object({
  goalId: IdSchema,
  name: z.string(),
  kind: z.enum(['savings', 'investment']),
  plannedMinor: AmountMinorSchema,
  requiredMinor: NonNegativeAmountMinorSchema.nullable(),
  /** Skąd wymaganie: termin celu (prognoza) albo plan wpłat. */
  requirementBasis: z.enum(['target_date', 'contribution_plan']).nullable(),
  status: z.enum(['met', 'short', 'no_requirement']),
  shortfallMinor: NonNegativeAmountMinorSchema,
});

export const BudgetSetAsideCheckSchema = z.object({
  plannedExpenseId: IdSchema,
  name: z.string(),
  dueMonth: MonthKeySchema,
  requiredMinor: NonNegativeAmountMinorSchema,
  plannedMinor: AmountMinorSchema,
  status: z.enum(['met', 'short']),
});

export const BudgetWarningSchema = z.object({
  code: z.enum([
    'NEGATIVE_LEFTOVER', 'NO_INCOME', 'ALLOCATION_SHORT',
    'GOAL_SHORT', 'SET_ASIDE_SHORT', 'ORPHAN_LINES',
  ]),
  message: z.string(),                      // po polsku, gotowe do pokazania
  amountMinor: AmountMinorSchema.nullable(),
  /** Do przycisku „Dodaj brakujące” — pula albo cel, którego dotyczy. */
  target: z.object({
    kind: z.enum(['savings', 'investment', 'debt', 'goal', 'planned_expense']),
    id: IdSchema.nullable(),
  }).nullable(),
});

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

/** Wykonanie planu (07 §13.8) — tylko dla M ≤ bieżący miesiąc. */
export const BudgetActualsSchema = z.object({
  /** Wykonanie linii powiązanych; klucz = id linii. */
  lines: z.record(IdSchema, AmountMinorSchema),
  /** Wykonanie grup linii własnych: kategorie główne i źródła przychodu. */
  groups: z.array(z.object({
    kind: z.enum(['category', 'income_source']),
    id: IdSchema,
    name: z.string(),
    lineIds: z.array(IdSchema),
    plannedMinor: AmountMinorSchema,
    actualMinor: AmountMinorSchema,
  })),
  totals: z.object({
    incomeMinor: NonNegativeAmountMinorSchema,
    expenseMinor: NonNegativeAmountMinorSchema,
    savingsMinor: AmountMinorSchema,
    investmentMinor: AmountMinorSchema,
    netMinor: AmountMinorSchema,
  }),
  unplannedMinor: NonNegativeAmountMinorSchema,
});

export const BudgetDraftDtoSchema = z.object({
  id: IdSchema,
  month: MonthKeySchema,
  isEditable: z.boolean(),                  // M ≥ bieżący (07 §13.1)
  notes: z.string().nullable(),
  lastFilledAt: TimestampSchema.nullable(),
  lines: z.array(BudgetLineDtoSchema),      // także wykluczone — UI zwija je osobno
  summary: BudgetSummarySchema,
  actuals: BudgetActualsSchema.nullable(),
});

export const BudgetDraftListItemSchema = z.object({
  month: MonthKeySchema,
  incomeMinor: NonNegativeAmountMinorSchema,
  expenseMinor: NonNegativeAmountMinorSchema,
  leftoverMinor: AmountMinorSchema,
  lineCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
});

export const BudgetDraftListDtoSchema = z.object({
  items: z.array(BudgetDraftListItemSchema),
  /** Najbliższy miesiąc bez szkicu z zakresu; w ostatnim tygodniu miesiąca — następny. */
  suggestedMonth: MonthKeySchema.nullable(),
  range: z.object({ from: MonthKeySchema, to: MonthKeySchema }),
});

export const CreateBudgetDraftRequestSchema = z.object({
  fillFromSources: z.boolean().default(true),
  copyManualFrom: MonthKeySchema.nullish(),
  averageLines: z.array(z.object({
    categoryId: IdSchema,
    months: AverageMonthsSchema.default(3),
  })).max(50).default([]),
  notes: optionalText(1000),                // pusty tekst → null
});
export const UpdateBudgetDraftRequestSchema = z.object({ notes: optionalText(1000) });

const BudgetLineFieldsSchema = z.object({
  flow: BudgetLineFlowSchema,
  name: z.string().trim().min(1).max(60),
  amountMinor: AmountMinorSchema,
  categoryId: IdSchema.nullish(),
  incomeSourceId: IdSchema.nullish(),
  goalId: IdSchema.nullish(),
  dueOn: DateOnlySchema.nullish(),          // ∈ miesiąc szkicu — sprawdza serwis
  averageMonths: AverageMonthsSchema.nullish(),
  notes: optionalText(1000),
});
// Kształt z `budgetLineIssues(…, null)` (domain/budget.ts): I-21, kategoria i cel przy
// właściwym `flow`, źródło przychodu tylko przy wpływie. Rodzaj kategorii (I-23)
// i datę w miesiącu sprawdza serwis — zna kategorie i miesiąc.
export const CreateBudgetLineRequestSchema = BudgetLineFieldsSchema.superRefine(/* … */);

export const UpdateBudgetLineRequestSchema = BudgetLineFieldsSchema
  .omit({ flow: true }).partial()
  .extend({ isExcluded: z.boolean().optional(), sortOrder: z.number().int().min(0).optional() });

export const BudgetPromoteTargetSchema = z.enum(['recurring', 'planned']);
export const PromoteBudgetLineRequestSchema = z.discriminatedUnion('target', [
  z.object({
    target: z.literal('recurring'),
    // pola terminarza jak RecurringRuleFieldsSchema (§11); startMonth = miesiąc szkicu
    frequency: FrequencySchema.default('monthly'),
    intervalCount: z.number().int().min(1).max(24).default(1),
    dayOfMonth: z.number().int().min(1).max(31).nullish(),
    weekday: z.number().int().min(0).max(6).nullish(),
    monthOfYear: z.number().int().min(1).max(12).nullish(),
    endMonth: MonthKeySchema.nullish(),
    accountId: IdSchema,                    // wymagane — jak w regule (§11)
    counterAccountId: IdSchema.nullish(),
    autoPost: z.boolean().default(false),
    amountIsEstimate: z.boolean().default(false),
    isFixedExpense: z.boolean().default(true),
  }),
  z.object({
    target: z.literal('planned'),
    // pola jak CreatePlannedExpenseRequestSchema (§11a) bez nazwy, kwoty i kategorii
    dueMonth: MonthKeySchema.optional(),    // domyślnie miesiąc szkicu
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

export const PromoteBudgetLineResultSchema = z.object({
  draft: BudgetDraftDtoSchema,
  created: z.object({
    kind: z.enum(['recurring_rule', 'planned_expense']),
    id: IdSchema,
  }),
  lineMovedTo: MonthKeySchema.nullable(),
});

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

export const CategoryAveragesDtoSchema = z.object({
  months: AverageMonthsSchema,
  window: z.object({ from: MonthKeySchema, to: MonthKeySchema }),
  monthsWithData: z.number().int().nonnegative(),
  items: z.array(z.object({
    categoryId: IdSchema,
    name: z.string(),
    icon: z.string().nullable(),
    averageMinor: NonNegativeAmountMinorSchema,
    byMonth: z.array(z.object({ month: MonthKeySchema, amountMinor: NonNegativeAmountMinorSchema })),
  })),
});

// Sekcja `budget` w MonthSummaryDto (od `F9-8`, 04 §14).
export const MonthBudgetSectionDtoSchema = z.object({
  month: MonthKeySchema,
  hasDraft: z.boolean(),
  canCreate: z.boolean(),                 // zakres 07 §13.1 — odnośnik „Zaplanuj" w podglądzie
  leftoverMinor: AmountMinorSchema.nullable(), // „Zostaje" ze szkicu; null bez szkicu
  nextMonth: MonthKeySchema,
  nextMonthHasDraft: z.boolean(),
  suggestNextMonth: z.boolean(),          // bieżący miesiąc, ostatni tydzień, następny bez planu
});
```

**Dlaczego `canPromote` i `canApplyToSource` przychodzą z API.** Warunki zależą od
źródła (reguła raty, cel procentowy), od miesiąca i od tego, czy szkic jest edytowalny.
Powtórzone na froncie rozjechałyby się przy pierwszej zmianie 07 §13.6–13.7.


### Grupy i układ (`F9-11`, ADR-081)

```ts
// domain/enums.ts — idzie do CHECK w DDL.
export const BudgetSectionSchema = z.enum(['income', 'expense', 'pools']);

/** Grupa linii w sekcji szkicu (03 §3.21). */
export const BudgetGroupDtoSchema = z.object({
  id: IdSchema,
  section: BudgetSectionSchema,
  name: z.string(),
  sortOrder: z.number().int(),
});

// BudgetLineDtoSchema   += groupId: IdSchema.nullable()
// BudgetDraftDtoSchema  += groups: z.array(BudgetGroupDtoSchema)   // po sekcji i sortOrder
// CreateBudgetLineRequest / UpdateBudgetLineRequest += groupId: IdSchema.nullish()

const GroupNameSchema = z.string().trim().min(1, 'Nazwa jest wymagana')
  .max(40, 'Nazwa może mieć najwyżej 40 znaków');

export const CreateBudgetGroupRequestSchema = z.object({
  section: BudgetSectionSchema,
  name: GroupNameSchema,
  /** Linie przenoszone do nowej grupy, w tej kolejności (np. „Cofnij" usunięcia). */
  lineIds: z.array(IdSchema).max(200).default([]),
  /** Miejsce wśród grup sekcji, od 0; domyślnie na końcu. */
  position: z.number().int().min(0).optional(),
});
export const UpdateBudgetGroupRequestSchema = z.object({ name: GroupNameSchema });
export const GroupBudgetByOriginRequestSchema = z.object({ section: BudgetSectionSchema });

/** Pełny układ jednej sekcji — PATCH …/layout. */
export const UpdateBudgetLayoutRequestSchema = z.object({
  section: BudgetSectionSchema,
  groups: z.array(z.object({ id: IdSchema, lineIds: z.array(IdSchema).max(200) })).max(50),
  ungroupedLineIds: z.array(IdSchema).max(200),
});
export const BudgetGroupParamsSchema = z.object({ monthKey: MonthKeySchema, groupId: IdSchema });
```

## 14. Helpery izomorficzne

### `utils/money.ts`

```ts
/**
 * Formatuje kwotę w groszach jako tekst w walucie.
 *
 * @param minor - Kwota w groszach.
 * @param currency - Kod waluty ISO 4217.
 * @param locale - Ustawienia regionalne.
 * @returns Sformatowana kwota, np. `1 234,56 zł`.
 */
export function formatMinor(minor: number, currency = 'PLN', locale = 'pl-PL'): string;

/**
 * Zamienia tekst wpisany przez użytkownika na grosze.
 *
 * Akceptuje przecinek i kropkę jako separator dziesiętny oraz spacje jako separator tysięcy.
 * Zwraca `null`, gdy tekstu nie da się zinterpretować jako kwoty.
 *
 * @param input - Tekst z pola formularza, np. `"1 234,56"`.
 * @returns Kwota w groszach albo `null`.
 */
export function parseAmountToMinor(input: string): number | null;

/**
 * Wylicza udział kwoty w podstawie, w punktach bazowych.
 *
 * @param amountMinor - Kwota.
 * @param baseMinor - Podstawa (np. wpływy miesiąca).
 * @returns Udział w bps; `0`, gdy podstawa wynosi zero.
 */
export function toBps(amountMinor: number, baseMinor: number): number;

/**
 * Wylicza kwotę odpowiadającą udziałowi w podstawie.
 *
 * Zaokrąglenie: połówki w górę co do wartości bezwzględnej, żeby wynik był symetryczny
 * dla kwot dodatnich i ujemnych.
 *
 * @param bps - Udział w punktach bazowych.
 * @param baseMinor - Podstawa.
 * @returns Kwota w groszach.
 */
export function fromBps(bps: number, baseMinor: number): number;

/**
 * Rozdziela kwotę na `parts` części tak, by suma części równała się dokładnie kwocie.
 *
 * Reszta z dzielenia jest rozdawana po jednym groszu od pierwszej części.
 * Używane przy dzieleniu paragonu na pozycje.
 *
 * @param totalMinor - Kwota do podziału.
 * @param parts - Liczba części.
 * @returns Tablica kwot sumująca się do `totalMinor`.
 */
export function splitEvenly(totalMinor: number, parts: number): number[];

/** Zaokrągla połówki w górę co do wartości bezwzględnej — jedna reguła całej aplikacji (07 §8.3). */
export function roundHalfAwayFromZero(value: number): number;

/** Formatuje kwotę skrótowo — wyłącznie na wykresach. */
export function formatMinorCompact(minor: number, currency?: string, locale?: string): string;

/** Sumuje kwoty w groszach, pilnując, że wszystkie są całkowite. */
export function sumMinor(amounts: readonly number[]): number;
```

### `utils/month.ts`

```ts
/** Zwraca klucz miesiąca dla podanej daty biznesowej. */
export function monthKeyOf(dateOnly: string, monthStartDay?: number): MonthKey;

/** Zwraca zakres dat obejmowany przez miesiąc budżetowy. */
export function monthRange(month: MonthKey, monthStartDay?: number): { from: string; to: string };

/** Przesuwa klucz miesiąca o podaną liczbę miesięcy (może być ujemna). */
export function shiftMonth(month: MonthKey, delta: number): MonthKey;

/** Formatuje klucz miesiąca po polsku, np. `wrzesień 2026`. */
export function formatMonth(month: MonthKey, locale?: string): string;

/** Zwraca listę kluczy miesięcy z zakresu (włącznie z krańcami). */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[];

/** Zwraca różnicę w miesiącach ze znakiem. */
export function monthsDiff(from: MonthKey, to: MonthKey): number;

/** Najwcześniejsza data, na którą wolno zaksięgować transakcję (07 §1.3). */
export function earliestPostableDate(today: string, limitMonths: number): string;

/** Przycina dzień miesiąca do jego długości — „31." w lutym to 28 albo 29 (07 §6.1). */
export function clampDayToMonth(month: MonthKey, dayOfMonth: number): string;

/** Sprawdzenia kalendarzowe używane też przez prymitywy. */
export function isValidDateOnly(dateOnly: string): boolean;
export function isValidMonthKey(month: string): boolean;
export function isLeapYear(year: number): boolean;
export function daysInMonth(year: number, month: number): number;
```

> **Gdzie to mieszka.** `money.ts` i `month.ts` są **wyłącznie** w `packages/shared/utils/` —
> są izomorficzne i używa ich zarówno API, jak i front. Backend ma własne `core/dates.ts`
> tylko na to, czego nie da się zrobić bez strefy gospodarstwa: zamianę `Date` na datę
> biznesową (ADR-017).

## 15. Użycie kontraktów

**Backend** — schemat jest jednocześnie walidacją i dokumentacją trasy:

```ts
app.route({
  method: 'POST',
  url: '/',
  schema: {
    body: TransactionFieldsSchema, // reguły kształtu sprawdza serwis → 422 (§7)
    response: { 201: apiResponse(TransactionDtoSchema, TransactionMutationMetaSchema) },
  },
  handler: (request, reply) => {
    const { householdId, userId } = authContext(request);
    const result = createTransaction(db, clock, householdId, userId, request.body);
    void reply.status(201).header('location', `/api/v1/transactions/${result.data.id}`);
    return result;
  },
});
```

**Frontend** — ten sam schemat waliduje formularz:

```ts
const form = useForm<CreateTransactionRequest>({
  resolver: zodResolver(CreateTransactionRequestSchema),
  defaultValues: { type: 'expense', bookedOn: todayIso(), amountMinor: 0 },
});
```

Komunikat „Przelew wymaga konta docelowego" pojawi się w formularzu i w odpowiedzi API
— bo pochodzi z jednego miejsca (`transactionShapeIssues`): w formularzu przez
`superRefine`, w API jako `422` z tym samym tekstem w `details`. To główny powód, dla którego kontrakty są współdzielone.
