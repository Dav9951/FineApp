import { z } from 'zod';

import { AccountTypeSchema, AllocationClassSchema } from '../domain/enums.js';
import {
  AmountMinorSchema,
  CurrencySchema,
  DateOnlySchema,
  HexColorSchema,
  IdSchema,
  MonthKeySchema,
  TimestampSchema,
} from '../domain/primitives.js';

/**
 * Kontrakty kont
 * ([05 §5](../../../../plans/05-dto-contracts.md#5-konta--dtoaccountdtots)).
 */

/** Konto: miejsce, w którym leżą pieniądze. */
export const AccountDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  type: AccountTypeSchema,
  /** Pula, do której liczy się przelew na to konto (07 §2.1). */
  allocationClass: AllocationClassSchema,
  currency: CurrencySchema,
  /** Saldo w dniu `openingBalanceOn`; może być ujemne (debet, karta kredytowa). */
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
/** Konto. */
export type AccountDto = z.infer<typeof AccountDtoSchema>;

/** Dane nowego konta. */
export const CreateAccountRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Nazwa jest wymagana')
    .max(60, 'Nazwa może mieć najwyżej 60 znaków'),
  type: AccountTypeSchema,
  /** Pominięte — wywnioskowane z `type` (07 §2.1). */
  allocationClass: AllocationClassSchema.optional(),
  openingBalanceMinor: AmountMinorSchema.default(0),
  openingBalanceOn: DateOnlySchema,
  institution: z.string().trim().max(60, 'Nazwa instytucji może mieć najwyżej 60 znaków').nullish(),
  color: HexColorSchema.nullish(),
  icon: z.string().max(40).nullish(),
  includeInNetWorth: z.boolean().default(true),
});
/** Dane nowego konta po walidacji (z uzupełnionymi wartościami domyślnymi). */
export type CreateAccountRequest = z.infer<typeof CreateAccountRequestSchema>;
/** Dane nowego konta tak, jak wysyła je klient (wartości domyślne opcjonalne). */
export type CreateAccountInput = z.input<typeof CreateAccountRequestSchema>;

/**
 * Zmiana konta — każde pole opcjonalne.
 *
 * `.partial()` owija pola w `optional` **na zewnątrz** `default`, więc pominięte
 * `openingBalanceMinor` czy `includeInNetWorth` zostają `undefined`, a nie wracają do
 * wartości domyślnej — PATCH zmienia wyłącznie to, co przysłano. `null` w polach
 * opcjonalnych (`institution`, `color`, `icon`) czyści wartość.
 *
 * Zmiana `type` bez `allocationClass` przelicza klasę tylko wtedy, gdy nie była
 * nadpisana (`allocationClassAfterTypeChange`).
 */
export const UpdateAccountRequestSchema = CreateAccountRequestSchema.partial();
/** Zmiana konta po walidacji. */
export type UpdateAccountRequest = z.infer<typeof UpdateAccountRequestSchema>;

/**
 * Parametry listy kont.
 *
 * Parametr zapytania przychodzi jako tekst. `z.coerce.boolean()` zamieniłoby `"false"`
 * na `true` (niepusty napis), dlatego dozwolone są wyłącznie dwa literały.
 */
export const ListAccountsQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
/** Parametry listy kont po walidacji. */
export type ListAccountsQuery = z.infer<typeof ListAccountsQuerySchema>;

/**
 * Nowa kolejność kont.
 *
 * Lista może obejmować część kont (np. tylko aktywne, bo tylko te widać na ekranie).
 * Wymienione dostają kolejne pozycje od zera, pozostałe trafiają za nie z zachowaniem
 * dotychczasowej kolejności — dzięki temu dwie pozycje nigdy nie mają tego samego
 * miejsca.
 */
export const ReorderAccountsRequestSchema = z.object({
  ids: z
    .array(IdSchema)
    .min(1, 'Lista kont nie może być pusta')
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'Konto występuje na liście więcej niż raz'),
});
/** Nowa kolejność kont. */
export type ReorderAccountsRequest = z.infer<typeof ReorderAccountsRequestSchema>;

/**
 * Szczegóły konta: konto i jego saldo na dziś (w strefie gospodarstwa).
 *
 * `balanceAsOf` mówi, na jaki dzień policzono saldo — bez tego klient nie odróżni
 * „dziś" serwera od swojego „dziś" tuż po północy.
 */
export const AccountDetailDtoSchema = AccountDtoSchema.extend({
  balanceMinor: AmountMinorSchema,
  balanceAsOf: DateOnlySchema,
});
/** Szczegóły konta z saldem. */
export type AccountDetailDto = z.infer<typeof AccountDetailDtoSchema>;

/**
 * Parametry `GET /accounts/balances`: `asOf` albo `month`, nie oba.
 *
 * - `month` — saldo na **ostatni dzień** miesiąca budżetowego;
 * - `asOf` — saldo na wskazany dzień, ruch liczony od początku jego miesiąca;
 * - brak obu — saldo na dziś w strefie gospodarstwa.
 */
export const BalancesQuerySchema = z
  .object({
    asOf: DateOnlySchema.optional(),
    month: MonthKeySchema.optional(),
  })
  .refine((value) => value.asOf === undefined || value.month === undefined, {
    message: 'Podaj datę albo miesiąc, nie oba naraz',
    path: ['month'],
  });
/** Parametry sald po walidacji. */
export type BalancesQuery = z.infer<typeof BalancesQuerySchema>;

/** Saldo konta wraz z ruchem w wybranym miesiącu. */
export const AccountBalanceDtoSchema = z.object({
  accountId: IdSchema,
  name: z.string(),
  type: AccountTypeSchema,
  allocationClass: AllocationClassSchema,
  color: HexColorSchema.nullable(),
  icon: z.string().nullable(),
  /**
   * Konto zarchiwizowane pojawia się w saldach tylko wtedy, gdy w okresie miało
   * niezerowe saldo — archiwizacja nie może zmienić liczb za przeszłe miesiące (07 §7).
   */
  isArchived: z.boolean(),
  balanceMinor: AmountMinorSchema,
  balanceAtMonthStartMinor: AmountMinorSchema,
  changeInMonthMinor: AmountMinorSchema,
});
/** Saldo konta. */
export type AccountBalanceDto = z.infer<typeof AccountBalanceDtoSchema>;

/** Podsumowanie majątku: sumy per klasa kont i wartość netto. */
export const BalancesMetaSchema = z.object({
  asOf: DateOnlySchema,
  totalsByClass: z.object({
    spending: AmountMinorSchema,
    savings: AmountMinorSchema,
    investment: AmountMinorSchema,
  }),
  /** Aktywa z `includeInNetWorth` minus pozostałe zobowiązania (07 §7). */
  netWorthMinor: AmountMinorSchema,
  /** Do `F4-4` zawsze `0` — zobowiązań nie da się jeszcze założyć (ADR-032). */
  liabilitiesRemainingMinor: AmountMinorSchema,
});
/** Podsumowanie majątku. */
export type BalancesMeta = z.infer<typeof BalancesMetaSchema>;
