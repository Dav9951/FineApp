import { z } from 'zod';

/**
 * Enumy domenowe — jedyne źródło tych wartości.
 *
 * Te same napisy trafiają do `CHECK` w DDL (generowanym z Drizzle) i do `<Select>`
 * na froncie ([05 §2](../../../../plans/05-dto-contracts.md)). Dopisanie wartości
 * w jednym miejscu, a zapomnienie o drugim, jest tu niemożliwe.
 */

/** Rodzaj konta. */
export const AccountTypeSchema = z.enum(['checking', 'cash', 'savings', 'investment', 'other']);
/** Rodzaj konta. Dozwolone wartości ustala schemat powyżej. */
export type AccountType = z.infer<typeof AccountTypeSchema>;

/** Klasa alokacji konta — decyduje, do której puli trafia przelew (07 §2.1). */
export const AllocationClassSchema = z.enum(['spending', 'savings', 'investment']);
/** Klasa alokacji konta. Dozwolone wartości ustala schemat powyżej. */
export type AllocationClass = z.infer<typeof AllocationClassSchema>;

/** Typ transakcji. */
export const TransactionTypeSchema = z.enum(['expense', 'income', 'transfer']);
/** Typ transakcji. Dozwolone wartości ustala schemat powyżej. */
export type TransactionType = z.infer<typeof TransactionTypeSchema>;

/** Status transakcji. */
export const TransactionStatusSchema = z.enum(['posted', 'pending', 'void']);
/** Status transakcji. Dozwolone wartości ustala schemat powyżej. */
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

/** Skąd wzięła się transakcja. */
export const TransactionSourceSchema = z.enum(['manual', 'ocr', 'recurring', 'planned', 'import']);
/** Pochodzenie transakcji. Dozwolone wartości ustala schemat powyżej. */
export type TransactionSource = z.infer<typeof TransactionSourceSchema>;

/** Pula celów procentowych, której dotyczy efekt alokacji. */
export const AllocationKindSchema = z.enum(['savings', 'investment', 'debt_repayment']);
/** Pula celów procentowych. Dozwolone wartości ustala schemat powyżej. */
export type AllocationKind = z.infer<typeof AllocationKindSchema>;

/** Nadpisanie wyliczonej alokacji przez użytkownika. `none` = nie licz tej operacji. */
export const AllocationOverrideSchema = z.enum(['none', 'savings', 'investment']);
/** Nadpisanie wyliczonej alokacji. Dozwolone wartości ustala schemat powyżej. */
export type AllocationOverride = z.infer<typeof AllocationOverrideSchema>;

/** Rodzaj kategorii — musi zgadzać się z typem transakcji (niezmiennik I-4). */
export const CategoryKindSchema = z.enum(['expense', 'income', 'transfer']);
/** Rodzaj kategorii. Dozwolone wartości ustala schemat powyżej. */
export type CategoryKind = z.infer<typeof CategoryKindSchema>;

/** Rodzaj celu. */
export const GoalKindSchema = z.enum(['savings', 'investment']);
/** Rodzaj celu. Dozwolone wartości ustala schemat powyżej. */
export type GoalKind = z.infer<typeof GoalKindSchema>;

/** Status celu. */
export const GoalStatusSchema = z.enum(['active', 'paused', 'achieved', 'archived']);
/** Status celu. Dozwolone wartości ustala schemat powyżej. */
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

/** Sposób zasilania celu (07 §3). */
export const ContributionModeSchema = z.enum(['fixed', 'percent_of_income', 'none']);
/** Sposób zasilania celu. Dozwolone wartości ustala schemat powyżej. */
export type ContributionMode = z.infer<typeof ContributionModeSchema>;

/** Skąd liczony jest postęp celu. */
export const ProgressSourceSchema = z.enum(['contributions', 'account_balance']);
/** Źródło postępu celu. Dozwolone wartości ustala schemat powyżej. */
export type ProgressSource = z.infer<typeof ProgressSourceSchema>;

/** Rodzaj zobowiązania. */
export const LiabilityKindSchema = z.enum([
  'mortgage',
  'cash_loan',
  'car_loan',
  'installment',
  'credit_card',
  'bnpl',
  'private',
  'other',
]);
/** Rodzaj zobowiązania. Dozwolone wartości ustala schemat powyżej. */
export type LiabilityKind = z.infer<typeof LiabilityKindSchema>;

/** Częstotliwość pozycji cyklicznej. */
export const FrequencySchema = z.enum([
  'monthly',
  'weekly',
  'biweekly',
  'quarterly',
  'yearly',
  'every_n_months',
]);
/** Częstotliwość pozycji cyklicznej. Dozwolone wartości ustala schemat powyżej. */
export type Frequency = z.infer<typeof FrequencySchema>;

/** Status wystąpienia pozycji cyklicznej. */
export const OccurrenceStatusSchema = z.enum(['planned', 'posted', 'skipped']);
/** Status wystąpienia cyklicznego. Dozwolone wartości ustala schemat powyżej. */
export type OccurrenceStatus = z.infer<typeof OccurrenceStatusSchema>;

/** Status planowanego wydatku. */
export const PlannedExpenseStatusSchema = z.enum([
  'planned',
  'funding',
  'ready',
  'posted',
  'deferred',
  'cancelled',
]);
/** Status planowanego wydatku. Dozwolone wartości ustala schemat powyżej. */
export type PlannedExpenseStatus = z.infer<typeof PlannedExpenseStatusSchema>;

/** Priorytet planowanego wydatku. */
export const PlannedExpensePrioritySchema = z.enum(['must', 'should', 'nice']);
/** Priorytet planowanego wydatku. Dozwolone wartości ustala schemat powyżej. */
export type PlannedExpensePriority = z.infer<typeof PlannedExpensePrioritySchema>;

/** Rodzaj dokumentu wrzuconego do OCR. */
export const DocumentKindSchema = z.enum(['receipt', 'bank_statement', 'invoice', 'other']);
/** Rodzaj dokumentu. Dozwolone wartości ustala schemat powyżej. */
export type DocumentKind = z.infer<typeof DocumentKindSchema>;

/** Status przetwarzania dokumentu. */
export const DocumentStatusSchema = z.enum([
  'uploaded',
  'processing',
  'parsed',
  'failed',
  'committed',
  'discarded',
]);
/** Status przetwarzania dokumentu. Dozwolone wartości ustala schemat powyżej. */
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

/** Status przeglądu pozycji rozpoznanej przez AI. */
export const ReviewStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'merged']);
/** Status przeglądu pozycji z OCR. Dozwolone wartości ustala schemat powyżej. */
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

/** Rodzaj źródła przychodu. */
export const IncomeSourceKindSchema = z.enum([
  'salary',
  'business',
  'freelance',
  'benefit',
  'rental',
  'investment',
  'refund',
  'gift',
  'sale',
  'other',
]);
/** Rodzaj źródła przychodu. Dozwolone wartości ustala schemat powyżej. */
export type IncomeSourceKind = z.infer<typeof IncomeSourceKindSchema>;

/** Status linii rozkładu docelowego (07 §2.5). */
export const AllocationStatusSchema = z.enum(['on_track', 'behind', 'ahead', 'met']);
/** Status linii rozkładu docelowego. Dozwolone wartości ustala schemat powyżej. */
export type AllocationStatus = z.infer<typeof AllocationStatusSchema>;

/**
 * Strona bilansu linii szkicu budżetu (07 §13, ADR-075).
 *
 * Nie typ transakcji: przelew na oszczędności to linia `savings`, bo plan pyta
 * „ile odkładam", a nie „z jakiego konta na jakie".
 */
export const BudgetLineFlowSchema = z.enum(['income', 'expense', 'savings', 'investment']);
/** Strona bilansu linii szkicu budżetu. Dozwolone wartości ustala schemat powyżej. */
export type BudgetLineFlow = z.infer<typeof BudgetLineFlowSchema>;

/**
 * Pochodzenie linii szkicu budżetu (07 §13.2). `manual` — linia istnieje tylko
 * w szkicu; pozostałe są powiązane ze źródłem, z którego powstały.
 */
export const BudgetLineOriginSchema = z.enum([
  'manual',
  'recurring',
  'planned',
  'set_aside',
  'goal',
  'liability',
]);
/** Pochodzenie linii szkicu budżetu. Dozwolone wartości ustala schemat powyżej. */
export type BudgetLineOrigin = z.infer<typeof BudgetLineOriginSchema>;

/**
 * Sekcja szkicu budżetu — miejsce grupy linii (07 §13.10, ADR-081).
 *
 * Nie strona bilansu: `pools` łączy oszczędności i inwestycje, bo tak wygląda ekran
 * (06 §3.14) i tam użytkownik układa linie.
 */
export const BudgetSectionSchema = z.enum(['income', 'expense', 'pools']);
/** Sekcja szkicu budżetu. Dozwolone wartości ustala schemat powyżej. */
export type BudgetSection = z.infer<typeof BudgetSectionSchema>;
