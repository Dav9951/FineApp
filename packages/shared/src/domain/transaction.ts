import type { AllocationOverride, TransactionType } from './enums.js';

/**
 * Niezmienniki kształtu transakcji wspólne dla formularza i API
 * ([03 §4](../../../../plans/03-data-model.md#4-niezmienniki-wymuszane-w-serwisach),
 * [05 §7](../../../../plans/05-dto-contracts.md#walidacja-krzyżowa)).
 *
 * Reguły są **jedną funkcją**, a nie treścią `superRefine`, bo korzystają z nich dwa
 * miejsca o różnych potrzebach: formularz podświetla pole (Zod), a serwis sprawdza
 * transakcję **po scaleniu** z żądaniem `PATCH` i odpowiada `422` (04 §2). Dwie kopie
 * rozjechałyby się przy pierwszej nowej regule.
 */

/** Problem wskazujący pole — ten sam kształt co `details` w odpowiedzi błędu. */
export interface TransactionIssue {
  readonly path: string;
  readonly message: string;
}

/** Pola transakcji, których dotyczą niezmienniki kształtu. */
export interface TransactionShape {
  readonly type: TransactionType;
  readonly accountId?: string | null;
  readonly counterAccountId?: string | null;
  readonly incomeSourceId?: string | null;
  readonly liabilityId?: string | null;
  readonly allocationOverride?: AllocationOverride | null;
}

/**
 * Sprawdza niezmienniki kształtu transakcji.
 *
 * - **I-2** — przelew ma konto docelowe, różne od źródłowego.
 * - **I-3** — wydatek i przychód nie mają konta docelowego.
 * - **I-7a** — alokację nadpisuje się dla przelewu; dla wydatku wyłącznie `'none'`
 *   i wyłącznie przy racie zobowiązania (wyłączenie jej ze spłaty długu, 07 §2.2a).
 * - **Źródło przychodu** tylko przy przychodzie — na wydatku nic by nie znaczyło, a raport
 *   źródeł (04 §12) mógłby je policzyć (ADR-035).
 *
 * Konto źródłowe jest wymagane przez schemat, więc tu go nie sprawdzamy.
 *
 * @param tx - Transakcja w całości (przy `PATCH` — po scaleniu z bieżącym stanem).
 * @returns Lista problemów; pusta, gdy kształt jest poprawny.
 */
export function transactionShapeIssues(tx: TransactionShape): TransactionIssue[] {
  const issues: TransactionIssue[] = [];

  if (tx.type === 'transfer') {
    if (!tx.counterAccountId) {
      issues.push({ path: 'counterAccountId', message: 'Przelew wymaga konta docelowego' });
    } else if (tx.counterAccountId === tx.accountId) {
      issues.push({
        path: 'counterAccountId',
        message: 'Konto docelowe musi być inne niż źródłowe',
      });
    }
  } else if (tx.counterAccountId) {
    issues.push({
      path: 'counterAccountId',
      message: 'Konto docelowe dotyczy wyłącznie przelewów',
    });
  }

  if (tx.allocationOverride && tx.type !== 'transfer') {
    const isLiabilityOptOut =
      tx.type === 'expense' && !!tx.liabilityId && tx.allocationOverride === 'none';
    if (!isLiabilityOptOut) {
      issues.push({
        path: 'allocationOverride',
        message:
          tx.type === 'expense' && tx.liabilityId
            ? 'Ratę zobowiązania można tylko wyłączyć z rozliczenia'
            : 'Alokację można ustawić tylko dla przelewu',
      });
    }
  }

  if (tx.incomeSourceId && tx.type !== 'income') {
    issues.push({
      path: 'incomeSourceId',
      message: 'Źródło przychodu dotyczy wyłącznie przychodów',
    });
  }

  return issues;
}
