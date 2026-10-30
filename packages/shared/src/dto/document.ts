import { z } from 'zod';

import {
  CategoryKindSchema,
  DocumentKindSchema,
  DocumentStatusSchema,
  ReviewStatusSchema,
} from '../domain/enums.js';
import {
  AmountMinorSchema,
  CurrencySchema,
  DateOnlySchema,
  IdSchema,
  MonthKeySchema,
  NonNegativeAmountMinorSchema,
  PositiveAmountMinorSchema,
  TimestampSchema,
} from '../domain/primitives.js';
import { CategoryNameSchema } from './category.js';
import { TransactionDtoSchema, TransactionMutationMetaSchema } from './transaction.js';

/**
 * Kontrakty dokumentów i OCR
 * ([05 §12](../../../../plans/05-dto-contracts.md#12-dokumenty--ocr--dtodocumentdtots),
 * [04 §13](../../../../plans/04-api-spec.md#13-dokumenty--ocr--apiv1documents), Faza 7).
 *
 * Zasada nadrzędna z 08 §1: **AI proponuje, człowiek zatwierdza** — pozycje żyją
 * w dokumencie, dopóki commit nie zamieni ich w transakcje.
 */

/** Kierunek pozycji: `outflow` = obciążenie (wydatek, rabat to `inflow`). */
export const DocumentItemDirectionSchema = z.enum(['inflow', 'outflow']);
/** Kierunek pozycji dokumentu. */
export type DocumentItemDirection = z.infer<typeof DocumentItemDirectionSchema>;

/** Rodzaje dokumentów, które można wrzucić (`other` zostaje dla importu). */
export const UploadDocumentKindSchema = z.enum(['receipt', 'bank_statement', 'invoice']);
/** Rodzaj wrzucanego dokumentu. */
export type UploadDocumentKind = z.infer<typeof UploadDocumentKindSchema>;

/** Pewność modelu 0–1. */
const ConfidenceSchema = z.number().min(0).max(1);

/** Próg, poniżej którego UI oznacza pozycję „do sprawdzenia" (06 §3.4). */
export const LOW_CONFIDENCE = 0.6;

/** Pozycja odczytana z dokumentu, oczekująca na weryfikację. */
export const DocumentItemDtoSchema = z.object({
  id: IdSchema,
  lineNo: z.number().int(),
  rawText: z.string().nullable(),
  description: z.string(),
  quantity: z.number().nullable(),
  unitPriceMinor: AmountMinorSchema.nullable(),
  amountMinor: AmountMinorSchema,
  direction: DocumentItemDirectionSchema,
  bookedOn: DateOnlySchema.nullable(),
  suggestedCategoryId: IdSchema.nullable(),
  /** Nazwa kategorii zaproponowanej przez AI, gdy żadna istniejąca nie pasuje. */
  suggestedCategoryName: z.string().nullable(),
  /** Pewność dopasowania w zakresie 0–1; poniżej 0,6 UI oznacza pozycję do sprawdzenia. */
  confidence: ConfidenceSchema.nullable(),
  reviewStatus: ReviewStatusSchema,
  transactionId: IdSchema.nullable(),
  duplicateOfTransactionId: IdSchema.nullable(),
});
/** Pozycja dokumentu. */
export type DocumentItemDto = z.infer<typeof DocumentItemDtoSchema>;

/** Nagłówek odczytany z dokumentu. */
export const DocumentSummaryDtoSchema = z.object({
  merchant: z.string().nullable(),
  bookedOn: DateOnlySchema.nullable(),
  totalMinor: AmountMinorSchema.nullable(),
  currency: CurrencySchema.nullable(),
  confidence: ConfidenceSchema.nullable(),
  detectedMonthKey: MonthKeySchema.nullable(),
  /** Uwagi modelu o odczycie (rozdarty paragon, niezgodna suma) — 08 §7 pkt 2. */
  notes: z.string().nullable(),
  /** Wyciąg: numer lub nazwa konta z nagłówka. */
  accountHint: z.string().nullable(),
  /** Wyciąg: okres. */
  periodFrom: DateOnlySchema.nullable(),
  periodTo: DateOnlySchema.nullable(),
});
/** Nagłówek dokumentu. */
export type DocumentSummaryDto = z.infer<typeof DocumentSummaryDtoSchema>;

/** Propozycja nowej kategorii — pozycje, którym AI nie znalazło miejsca na liście. */
export const NewCategoryProposalSchema = z.object({
  name: z.string(),
  kind: CategoryKindSchema,
  itemIds: z.array(IdSchema),
});
/** Propozycja nowej kategorii. */
export type NewCategoryProposal = z.infer<typeof NewCategoryProposalSchema>;

/** Dokument ze stanem analizy i pozycjami — `GET /documents/:id`. */
export const DocumentDtoSchema = z.object({
  id: IdSchema,
  kind: DocumentKindSchema,
  status: DocumentStatusSchema,
  originalFilename: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  pageCount: z.number().int().nullable(),
  fileUrl: z.string(),
  summary: DocumentSummaryDtoSchema.nullable(),
  /** Konto wskazane przy wrzuceniu albo w korekcie nagłówka (ADR-059). */
  suggestedAccountId: IdSchema.nullable(),
  items: z.array(DocumentItemDtoSchema),
  /** Kategorie, których AI nie znalazło na liście — do jednoklikowego dodania. */
  newCategoryProposals: z.array(NewCategoryProposalSchema),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  ai: z
    .object({
      model: z.string(),
      costMinor: NonNegativeAmountMinorSchema,
      processedAt: TimestampSchema,
    })
    .nullable(),
  createdAt: TimestampSchema,
});
/** Dokument. */
export type DocumentDto = z.infer<typeof DocumentDtoSchema>;

/** Wiersz listy „Ostatnie" na ekranie skanu. */
export const DocumentListItemDtoSchema = z.object({
  id: IdSchema,
  kind: DocumentKindSchema,
  status: DocumentStatusSchema,
  originalFilename: z.string(),
  merchant: z.string().nullable(),
  bookedOn: DateOnlySchema.nullable(),
  totalMinor: AmountMinorSchema.nullable(),
  itemCount: z.number().int().nonnegative(),
  errorMessage: z.string().nullable(),
  createdAt: TimestampSchema,
});
/** Wiersz listy dokumentów. */
export type DocumentListItemDto = z.infer<typeof DocumentListItemDtoSchema>;

/** Filtry `GET /documents`. */
export const DocumentQuerySchema = z.object({
  status: DocumentStatusSchema.optional(),
  /** Miesiąc wrzucenia (w strefie gospodarstwa). */
  month: MonthKeySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
/** Filtry listy dokumentów. */
export type DocumentQuery = z.infer<typeof DocumentQuerySchema>;

/**
 * Pola formularza `POST /documents` poza samym plikiem.
 *
 * Pola `multipart/form-data` przychodzą jako tekst, więc puste pole to `''`, nie brak.
 */
export const UploadDocumentFieldsSchema = z.object({
  kind: UploadDocumentKindSchema.default('receipt'),
  accountId: z
    .union([IdSchema, z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),
  monthHint: z
    .union([MonthKeySchema, z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),
});
/** Pola wrzucenia dokumentu. */
export type UploadDocumentFields = z.infer<typeof UploadDocumentFieldsSchema>;

/** Odpowiedź `202` na wrzucenie — front odpytuje `GET /documents/:id`. */
export const UploadDocumentResponseSchema = z.object({
  id: IdSchema,
  status: DocumentStatusSchema,
  pollAfterMs: z.number().int().positive(),
});
/** Odpowiedź na wrzucenie dokumentu. */
export type UploadDocumentResponse = z.infer<typeof UploadDocumentResponseSchema>;

/** Korekta nagłówka dokumentu przed zatwierdzeniem. */
export const UpdateDocumentRequestSchema = z.object({
  kind: UploadDocumentKindSchema.optional(),
  merchant: z.string().trim().max(120).nullish(),
  bookedOn: DateOnlySchema.nullish(),
  accountId: IdSchema.nullish(),
});
/** Korekta nagłówka dokumentu. */
export type UpdateDocumentRequest = z.infer<typeof UpdateDocumentRequestSchema>;

/** Korekta pozycji przed zatwierdzeniem dokumentu. */
export const UpdateDocumentItemRequestSchema = z.object({
  description: z.string().trim().min(1).max(200).optional(),
  amountMinor: PositiveAmountMinorSchema.optional(),
  direction: DocumentItemDirectionSchema.optional(),
  suggestedCategoryId: IdSchema.nullish(),
  bookedOn: DateOnlySchema.optional(),
  reviewStatus: z.enum(['pending', 'accepted', 'rejected']).optional(),
});
/** Korekta pozycji dokumentu. */
export type UpdateDocumentItemRequest = z.infer<typeof UpdateDocumentItemRequestSchema>;

/** Nowa kategoria zakładana razem z commitem (wymaganie #5). */
export const CommitNewCategorySchema = z.object({
  name: CategoryNameSchema,
  kind: CategoryKindSchema,
  parentId: IdSchema.nullish(),
});
/** Nowa kategoria przy commicie. */
export type CommitNewCategory = z.infer<typeof CommitNewCategorySchema>;

/**
 * Zatwierdzenie dokumentu i utworzenie transakcji.
 *
 * `single`      — cały paragon jako jedna transakcja (typowy przypadek zakupów).
 * `by_category` — jedna transakcja wydatku na kategorię (paragon mieszany; 07 §9.4,
 *                 ADR-069).
 * `split`       — osobna transakcja na każdą zaakceptowaną pozycję (przydatne przy wyciągu).
 *
 * Nowa kategoria z `createCategories` trafia do pozycji, których
 * `suggestedCategoryName` ma tę samą nazwę (bez względu na wielkość liter) i które nie
 * mają wybranej kategorii. W trybie `single` kategoria całości może być nową kategorią —
 * wtedy `categoryName` zamiast `categoryId`.
 */
export const CommitDocumentRequestSchema = z
  .object({
    mode: z.enum(['single', 'by_category', 'split']),
    accountId: IdSchema,
    bookedOn: DateOnlySchema,
    categoryId: IdSchema.nullish(),
    /** Tryb `single`: nazwa kategorii z `createCategories` zamiast `categoryId`. */
    categoryName: z.string().trim().min(1).max(50).nullish(),
    merchant: z.string().trim().max(120).nullish(),
    itemIds: z.array(IdSchema).min(1, 'Wybierz przynajmniej jedną pozycję').max(200),
    createCategories: z.array(CommitNewCategorySchema).max(20).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'single' && !value.categoryId && !value.categoryName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categoryId'],
        message: 'Wybierz kategorię dla całego dokumentu',
      });
    }
  });
/** Zatwierdzenie dokumentu. */
export type CommitDocumentRequest = z.infer<typeof CommitDocumentRequestSchema>;

/** Odpowiedź commitu: dokument po zatwierdzeniu i utworzone transakcje. */
export const CommitDocumentResponseSchema = z.object({
  document: DocumentDtoSchema,
  transactions: z.array(TransactionDtoSchema),
});
/** Wynik commitu dokumentu. */
export type CommitDocumentResponse = z.infer<typeof CommitDocumentResponseSchema>;

/** Meta odpowiedzi commitu — miesiące do unieważnienia, jak przy zapisie transakcji. */
export const CommitDocumentMetaSchema = TransactionMutationMetaSchema;

/** Zużycie OCR w bieżącym miesiącu — `GET /settings/ai-usage` (08 §9). */
export const AiUsageDtoSchema = z.object({
  /** `AI_ENABLED` — gdy `false`, UI ukrywa zakładkę *Skan*. */
  enabled: z.boolean(),
  model: z.string(),
  monthKey: MonthKeySchema,
  documentCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  spentMinor: NonNegativeAmountMinorSchema,
  /** `AI_MONTHLY_BUDGET_MINOR`; `0` = bez limitu. */
  budgetMinor: NonNegativeAmountMinorSchema,
  /** Ile zostało; `null` przy braku limitu. */
  remainingMinor: NonNegativeAmountMinorSchema.nullable(),
});
/** Zużycie OCR. */
export type AiUsageDto = z.infer<typeof AiUsageDtoSchema>;
