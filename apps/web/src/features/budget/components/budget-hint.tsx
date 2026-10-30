import { formatMonth, type MonthSummaryDto } from '@fineapp/shared';
import { ChevronRight, ClipboardList } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '../../../components/ui/index.js';

/**
 * Wejścia do planera z ekranu miesiąca
 * ([06 §3.14](../../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth),
 * `F9-8`). Kiedy je pokazać, mówi sekcja `budget` podsumowania — ekran tylko rysuje.
 */

/**
 * Podpowiedź „Zaplanuj {miesiąc}" pod „Nadchodzące" — w ostatnim tygodniu bieżącego
 * miesiąca, gdy następny nie ma planu.
 *
 * @param props - Właściwości komponentu.
 * @param props.summary - Podsumowanie miesiąca z sekcją `budget`.
 * @returns Wiersz z odnośnikiem albo nic.
 */
export function BudgetHint({ summary }: { summary: MonthSummaryDto }): ReactNode {
  const { budget } = summary;
  if (!budget.suggestNextMonth) return null;
  return (
    <Link
      className="mt-4 flex min-h-touch items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
      to={`/budget/${budget.nextMonth}`}
    >
      <ClipboardList
        aria-hidden="true"
        className="h-5 w-5 shrink-0 text-muted-foreground"
        strokeWidth={1.5}
      />
      <span className="min-w-0 flex-1 font-medium">Zaplanuj {formatMonth(budget.nextMonth)}</span>
      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/**
 * Odnośnik do planu w banerze podglądu przyszłego miesiąca: „Plan budżetu", gdy szkic
 * istnieje, „Zaplanuj", gdy da się go założyć.
 *
 * @param props - Właściwości komponentu.
 * @param props.summary - Podsumowanie miesiąca z sekcją `budget`.
 * @returns Odnośnik albo nic.
 */
export function BudgetPreviewLink({ summary }: { summary: MonthSummaryDto }): ReactNode {
  const { budget } = summary;
  if (!budget.hasDraft && !budget.canCreate) return null;
  return (
    <Button asChild className="self-start" size="small" variant="link">
      <Link to={`/budget/${budget.month}`}>{budget.hasDraft ? 'Plan budżetu' : 'Zaplanuj'}</Link>
    </Button>
  );
}
