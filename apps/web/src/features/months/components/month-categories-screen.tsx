import type { CategorySpendingDto, CategorySpendingTreeDto, MonthKey } from '@fineapp/shared';
import { ChevronDown, PieChart } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import {
  Button,
  EmptyState,
  ErrorState,
  Money,
  MonthSwitcher,
  Section,
  Skeleton,
  SkeletonList,
} from '../../../components/ui/index.js';
import { useMonthParam } from '../../../hooks/use-month-param.js';
import { errorDetails } from '../../../lib/api-client.js';
import { cn } from '../../../lib/cn.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useAuth } from '../../auth/auth-context.js';
import { useMonthCategories } from '../hooks/use-months.js';
import { categoryTrend, monthGenitive, percentLabel } from '../month-view.js';

/**
 * Rozbicie wydatków po kategoriach — `/m/:month/categories` (06 §2, `F3-2`).
 *
 * Wejście z „szczegóły" w sekcji „Na co idą pieniądze". Kategorie główne malejąco,
 * każda z paskiem udziału, kwotą z poprzedniego miesiąca i rozwijanymi podkategoriami.
 * Wykres kołowy zostaje na Fazę 8 (wykresy) — lista z paskami czyta się na 390 px
 * lepiej niż koło z dwunastoma wycinkami.
 */

/**
 * Adres ekranu rozbicia dla miesiąca.
 *
 * @param month - Klucz miesiąca.
 * @returns Ścieżka.
 */
function categoriesHref(month: MonthKey): string {
  return `/m/${month}/categories`;
}

/**
 * Kwota z poprzedniego miesiąca z trendem, pod nazwą kategorii.
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Pozycja rozbicia.
 * @param props.previousMonth - Poprzedni miesiąc.
 * @returns Element podpisu albo nic.
 */
function PreviousLine({
  item,
  previousMonth,
}: {
  item: CategorySpendingDto;
  previousMonth: MonthKey;
}): ReactNode {
  const trend = categoryTrend(item);
  if (item.previousMonthAmountMinor === null || trend === null) return null;
  return (
    <span className="flex items-center gap-1 text-caption text-muted-foreground">
      <span aria-hidden="true">{trend.arrow}</span>
      <span className="sr-only">{trend.label},</span>
      do {monthGenitive(previousMonth)}:
      <Money amountMinor={item.previousMonthAmountMinor} size="meta" />
    </span>
  );
}

/**
 * Kategoria główna z paskiem udziału i rozwijanymi podkategoriami.
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Kategoria główna.
 * @param props.previousMonth - Poprzedni miesiąc.
 * @param props.first - Czy pierwsza na liście.
 * @returns Element pozycji.
 */
function CategoryItem({
  item,
  previousMonth,
  first,
}: {
  item: CategorySpendingTreeDto;
  previousMonth: MonthKey;
  first: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const hasChildren = item.children.length > 0;
  const head = (
    <>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 text-sm font-medium leading-tight">{item.name}</span>
        <span className="text-caption tabular-nums text-muted-foreground">
          {percentLabel(item.shareBps)}
        </span>
        <Money amountMinor={item.amountMinor} variant="expense" />
      </span>
      {/* Udział jako pasek w kolorze wydatku; liczba stoi obok, więc pasek jest ozdobą. */}
      <span aria-hidden="true" className="mt-1.5 block h-1.5 w-full rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-expense/70"
          style={{ width: `${String(Math.min(item.shareBps, 10_000) / 100)}%` }}
        />
      </span>
      <span className="mt-1 flex items-center justify-between gap-2">
        <PreviousLine item={item} previousMonth={previousMonth} />
        {hasChildren ? (
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform',
              open ? 'rotate-180' : '',
            )}
            strokeWidth={1.5}
          />
        ) : null}
      </span>
    </>
  );
  return (
    <li className={first ? 'py-2' : 'border-t border-border py-2'}>
      {hasChildren ? (
        <button
          aria-expanded={open}
          className="flex min-h-touch w-full flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
          onClick={() => {
            setOpen(!open);
          }}
          type="button"
        >
          {head}
        </button>
      ) : (
        <div className="flex min-h-touch flex-col">{head}</div>
      )}
      {open ? (
        <ul className="mt-1 border-l border-border pl-3">
          {item.children.map((child) => (
            <li
              className="flex min-h-touch items-center justify-between gap-3 py-1"
              key={child.categoryId}
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-sm leading-tight">{child.name}</span>
                <PreviousLine item={child} previousMonth={previousMonth} />
              </span>
              <Money amountMinor={child.amountMinor} size="sm" variant="expense" />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Ekran rozbicia wydatków po kategoriach.
 *
 * @returns Element ekranu.
 */
export default function MonthCategoriesScreen(): ReactNode {
  const { household } = useAuth();
  const month = useMonthParam(household?.timezone);
  const report = useMonthCategories(month);

  let content: ReactNode;
  if (report.isPending) {
    content = (
      <div aria-busy="true" aria-label="Wczytywanie kategorii">
        <Section first>
          <Skeleton className="h-8 w-40" />
        </Section>
        <Section>
          <SkeletonList rows={5} />
        </Section>
      </div>
    );
  } else if (report.isError) {
    content = (
      <ErrorState
        details={errorDetails(report.error)}
        lastUpdatedAt={lastUpdatedLabel(report.dataUpdatedAt)}
        onRetry={() => {
          void report.refetch();
        }}
        retrying={report.isFetching}
        title="Nie udało się wczytać kategorii"
      />
    );
  } else if (report.data.items.length === 0) {
    content = (
      <EmptyState
        action={
          <Button asChild size="large" variant="ghost">
            <Link to={`/m/${month}`}>Wróć do miesiąca</Link>
          </Button>
        }
        description="W tym i poprzednim miesiącu nie ma zaksięgowanych wydatków."
        icon={<PieChart aria-hidden="true" className="h-7 w-7" strokeWidth={1.5} />}
        title="Nie ma czego rozbić"
      />
    );
  } else {
    content = (
      <>
        <Section first title="Wydatki razem">
          <Money amountMinor={report.data.expenseMinor} size="amount" variant="expense" />
        </Section>
        <Section title="Kategorie">
          <ul>
            {report.data.items.map((item, index) => (
              <CategoryItem
                first={index === 0}
                item={item}
                key={item.categoryId ?? 'none'}
                previousMonth={report.data.previousMonth}
              />
            ))}
          </ul>
        </Section>
      </>
    );
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <MonthSwitcher dimmed={report.isPending} hrefFor={categoriesHref} month={month} />
      </header>
      {content}
    </main>
  );
}
