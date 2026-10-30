import { formatMonth } from '@fineapp/shared';
import { ChevronRight, ClipboardList } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  Card,
  ErrorState,
  ListRow,
  Money,
  Section,
  SkeletonList,
} from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { pluralPl } from '../../../lib/format.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useBudgetDrafts } from '../hooks/use-budget.js';

/**
 * Lista planów budżetu — `/budget`
 * ([06 §3.14](../../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth),
 * `F9-6`).
 *
 * Na górze kafel z miesiącem, który warto teraz zaplanować (w ostatnim tygodniu miesiąca —
 * następny), pod nim istniejące plany z tym, ile zostaje.
 */

/**
 * Ekran listy planów.
 *
 * @returns Element ekranu.
 */
export default function BudgetListScreen(): ReactNode {
  const navigate = useNavigate();
  const list = useBudgetDrafts();

  let content: ReactNode;
  if (list.isPending) {
    content = (
      <Section first>
        <SkeletonList rows={3} />
      </Section>
    );
  } else if (list.isError) {
    content = (
      <ErrorState
        details={errorDetails(list.error)}
        lastUpdatedAt={lastUpdatedLabel(list.dataUpdatedAt)}
        onRetry={() => {
          void list.refetch();
        }}
        retrying={list.isFetching}
        title="Nie udało się wczytać planów"
      />
    );
  } else {
    const { items, suggestedMonth } = list.data;
    content = (
      <>
        {suggestedMonth === null ? null : (
          <Section first>
            <Card className="p-0">
              <Link
                className="flex min-h-touch items-center gap-3 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
                to={`/budget/${suggestedMonth}`}
              >
                <ClipboardList
                  aria-hidden="true"
                  className="h-6 w-6 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-base font-semibold">
                    Zaplanuj {formatMonth(suggestedMonth)}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    Pozycje cykliczne, raty, planowane wydatki i cele wciągniemy za Ciebie.
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={1.5} />
              </Link>
            </Card>
          </Section>
        )}
        <Section first={suggestedMonth === null} title="Plany">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nie ma jeszcze żadnego planu. Plan to jedna kartka na miesiąc: ile wpłynie, ile
              wydasz, ile odłożysz — i czy to dowozi Twoje cele.
            </p>
          ) : (
            <ul>
              {items.map((item, index) => (
                <li key={item.month}>
                  <ListRow
                    amount={
                      <>
                        <span className="sr-only">Zostaje </span>
                        <Money amountMinor={item.leftoverMinor} size="sm" />
                      </>
                    }
                    caption={
                      item.warningCount === 0
                        ? `${String(item.lineCount)} ${pluralPl(item.lineCount, 'pozycja', 'pozycje', 'pozycji')}`
                        : `${String(item.lineCount)} ${pluralPl(item.lineCount, 'pozycja', 'pozycje', 'pozycji')} · ${String(item.warningCount)} ${pluralPl(item.warningCount, 'ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń')}`
                    }
                    first={index === 0}
                    name={formatMonth(item.month)}
                    onClick={() => {
                      void navigate(`/budget/${item.month}`);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </>
    );
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Budżet</h1>
      </header>
      {content}
    </main>
  );
}
