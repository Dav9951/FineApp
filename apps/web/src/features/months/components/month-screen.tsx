import {
  currentMonthKey,
  formatMonth,
  shiftMonth,
  type AccountBalanceDto,
  type CategorySpendingDto,
  type MonthKey,
  type MonthSummaryDto,
  type TransactionListItemDto,
} from '@fineapp/shared';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  CalendarClock,
  Lock,
  Receipt,
  Tag,
  WalletCards,
} from 'lucide-react';
import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  Money,
  MonthGridSheet,
  MonthSwitcher,
  ProgressBar,
  Section,
  Skeleton,
  SkeletonList,
} from '../../../components/ui/index.js';
import { useMonthParam } from '../../../hooks/use-month-param.js';
import { errorDetails } from '../../../lib/api-client.js';
import { formatDateShort } from '../../../lib/format.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { AllocationTile } from '../../allocation/components/allocation-tile.js';
import { useAuth } from '../../auth/auth-context.js';
import { BudgetHint, BudgetPreviewLink } from '../../budget/components/budget-hint.js';
import { GoalsTile } from '../../goals/components/goals-tile.js';
import { UpcomingTile } from '../../planned-expenses/components/upcoming-tile.js';
import { captionParts, transactionTitle } from '../../transactions/history-view.js';
import { useTransactionSheet } from '../../transactions/components/transaction-sheet.js';
import { TodoSection } from './todo-section.js';
import {
  useAvailableMonths,
  useMonthSummary,
  usePrefetchNeighbourMonths,
} from '../hooks/use-months.js';
import {
  categoryTrend,
  deltaLabel,
  isFirstRun,
  monthHref,
  monthNotice,
  monthProgress,
  percentLabel,
  swipeDirection,
  uncategorizedLabel,
} from '../month-view.js';

/**
 * Ekran miesiąca — `/m/:month`, domyślny widok aplikacji (wymaganie #12,
 * [06 §3.1](../../../../../../plans/06-ui-views.md#31-miesiąc-dashboard--mmonth)).
 *
 * Jedno żądanie (`GET /months/:month/summary`) rysuje cały ekran. Kolejność sekcji
 * odpowiada kolejności pytań: „ile mam" → „co się działo" → „czy trzymam plan" (cele
 * procentowe i cele, `F5-8`) → „co muszę zrobić" → „na co idą pieniądze" → „co ostatnio".
 * Planowane wydatki dochodzą w Fazie 6 (ADR-039).
 *
 * Przełączanie: strzałki, siatka po dotknięciu nazwy, gest w bok na treści; sąsiednie
 * miesiące pobierane w tle po wczytaniu bieżącego (`F3-5`).
 */

/** Ikona typu transakcji — kategorie nie mają jeszcze ikon (`Z-22`). */
const TYPE_ICON = {
  expense: Receipt,
  income: ArrowDownLeft,
  transfer: ArrowLeftRight,
} as const;

/** Klasa ikony w wierszu listy (15 §6: 17 px, linia 1,5). */
const ROW_ICON = 'h-[17px] w-[17px]';

/**
 * Gest w bok na treści — zmiana miesiąca (06 §3.1).
 *
 * Gest startujący na elemencie przewijanym w poziomie (kafle kont) jest ignorowany:
 * tam poziomy ruch palca przewija kafle. Gest to skrót — strzałki i siatka są zawsze.
 *
 * @param month - Oglądany miesiąc.
 * @returns Obsługa zdarzeń wskaźnika dla kontenera treści.
 */
function useMonthSwipe(month: MonthKey): {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
} {
  const navigate = useNavigate();
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (event) => {
      const target = event.target as HTMLElement;
      start.current =
        event.pointerType === 'mouse' || target.closest('[data-swipe-ignore]') !== null
          ? null
          : { x: event.clientX, y: event.clientY };
    },
    onPointerUp: (event) => {
      const from = start.current;
      start.current = null;
      if (from === null) return;
      const direction = swipeDirection(event.clientX - from.x, event.clientY - from.y);
      if (direction !== null) {
        void navigate(monthHref(shiftMonth(month, direction === 'next' ? 1 : -1)));
      }
    },
  };
}

/**
 * Szkielet dashboardu — kafle kont, trzy wiersze podsumowania, wiersze list (15 §4.9),
 * żeby po dojściu danych nic nie przeskoczyło.
 *
 * @returns Element szkieletu.
 */
function MonthSkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Wczytywanie miesiąca">
      <Section first title="Konta">
        <div className="-mx-4 flex gap-2 overflow-hidden px-4">
          {[0, 1, 2, 3].map((key) => (
            <div
              className="flex w-[124px] shrink-0 flex-col gap-2 rounded-lg border border-border px-3 py-2.5"
              key={key}
            >
              <Skeleton className="h-2.5 w-3/5" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          ))}
        </div>
      </Section>
      <Section>
        <Skeleton className="mb-3 h-3 w-24" />
        {[0, 1, 2].map((key) => (
          <div className="flex justify-between py-1.5" key={key}>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
        <Skeleton className="mt-3 h-1.5 w-full" />
      </Section>
      <Section>
        <Skeleton className="mb-3 h-3 w-40" />
        <SkeletonList rows={3} />
      </Section>
      <Section>
        <Skeleton className="mb-3 h-3 w-24" />
        <SkeletonList rows={4} />
      </Section>
    </div>
  );
}

/**
 * Kwota ze znakiem kierunku: dodatnia jako wpływ, ujemna jako wydatek, zero neutralnie.
 *
 * `<Money>` bierze znak z wariantu (15 §4.1), więc ruch ujemny idzie jako wartość
 * bezwzględna w wariancie `expense`.
 *
 * @param props - Właściwości komponentu.
 * @param props.amountMinor - Kwota ze znakiem.
 * @param props.size - Rozmiar.
 * @param props.unit - Czy pokazać `zł`.
 * @returns Element kwoty.
 */
function SignedMoney({
  amountMinor,
  size = 'base',
  unit = true,
}: {
  amountMinor: number;
  size?: 'meta' | 'sm' | 'base' | 'lg';
  unit?: boolean;
}): ReactNode {
  if (amountMinor === 0) return <Money amountMinor={0} size={size} unit={unit} />;
  return (
    <Money
      amountMinor={Math.abs(amountMinor)}
      size={size}
      unit={unit}
      variant={amountMinor > 0 ? 'income' : 'expense'}
    />
  );
}

/**
 * Konta: kafle przewijane poziomo i majątek netto w nagłówku.
 *
 * @param props - Właściwości komponentu.
 * @param props.accounts - Salda na koniec miesiąca.
 * @param props.netWorthMinor - Majątek netto.
 * @returns Element sekcji.
 */
function AccountsSection({
  accounts,
  netWorthMinor,
}: {
  accounts: readonly AccountBalanceDto[];
  netWorthMinor: number;
}): ReactNode {
  return (
    <Section
      action={
        <span className="flex flex-col items-end">
          <span className="text-caption text-muted-foreground">majątek netto</span>
          {netWorthMinor < 0 ? (
            <Money amountMinor={-netWorthMinor} variant="expense" />
          ) : (
            <Money amountMinor={netWorthMinor} />
          )}
        </span>
      }
      first
      title="Konta"
    >
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Brak kont.{' '}
          <Link className="text-primary underline-offset-4 hover:underline" to="/accounts">
            Dodaj pierwsze
          </Link>
        </p>
      ) : (
        // `relative`: teksty `sr-only` w kaflach (kwoty dla czytnika) są pozycjonowane
        // absolutnie. Bez pozycjonowanego przodka liczą się od całej strony, więc kafle
        // przewinięte za prawą krawędź poszerzały dokument i FAB wyjeżdżał poza ekran
        // (ADR-074). Taśma z `relative` przycina je razem z kaflami.
        <ul
          className="scrollbar-none relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
          data-swipe-ignore=""
        >
          {accounts.map((account) => (
            <li className="shrink-0" key={account.accountId}>
              <Link
                className="flex w-[124px] flex-col rounded-lg border border-border px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
                to={`/accounts/${account.accountId}`}
              >
                <span className="mb-1 truncate text-caption text-muted-foreground">
                  {account.name}
                  {account.isArchived ? <span className="sr-only"> (w archiwum)</span> : null}
                </span>
                <Money amountMinor={account.balanceMinor} unit={false} />
                <span className="mt-0.5">
                  <SignedMoney amountMinor={account.changeInMonthMinor} size="meta" unit={false} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * Wiersz podsumowania: etykieta, porównanie, kwota.
 *
 * @param props - Właściwości komponentu.
 * @param props.label - Etykieta.
 * @param props.delta - Porównanie z poprzednim miesiącem.
 * @param props.children - Kwota.
 * @returns Element wiersza.
 */
function SummaryRow({
  label,
  delta,
  children,
}: {
  label: string;
  delta?: { text: string; label: string } | null;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-sm">{label}</dt>
      <dd className="flex items-baseline gap-2">
        {delta ? (
          <span className="text-caption text-muted-foreground">
            <span aria-hidden="true">{delta.text}</span>
            <span className="sr-only">{delta.label}</span>
          </span>
        ) : null}
        {children}
      </dd>
    </div>
  );
}

/**
 * Podsumowanie: wpływy i wydatki z porównaniem, odkładanie netto, wynik i upływ miesiąca.
 *
 * Wiersze oszczędności i inwestycji są tylko wtedy, gdy coś się w nich ruszyło — bez nich
 * „Zostaje" nie zgadzałoby się z „Wpływy − Wydatki" i wyglądało na błąd rachunku.
 *
 * @param props - Właściwości komponentu.
 * @param props.summary - Podsumowanie miesiąca.
 * @returns Element sekcji.
 */
function TotalsSection({ summary }: { summary: MonthSummaryDto }): ReactNode {
  const { totals, comparison } = summary;
  const progress = monthProgress(summary);
  const name = formatMonth(summary.month).replace(/\s+\d{4}$/u, '');
  return (
    <Section title={name}>
      <dl>
        <SummaryRow
          delta={deltaLabel(
            comparison.incomeDeltaMinor,
            comparison.incomeDeltaBps,
            comparison.hasPreviousData,
            comparison.previousMonth,
          )}
          label="Wpływy"
        >
          <Money amountMinor={totals.incomeMinor} variant="income" />
        </SummaryRow>
        <SummaryRow
          delta={deltaLabel(
            comparison.expenseDeltaMinor,
            comparison.expenseDeltaBps,
            comparison.hasPreviousData,
            comparison.previousMonth,
          )}
          label="Wydatki"
        >
          <Money amountMinor={totals.expenseMinor} variant="expense" />
        </SummaryRow>
        {totals.savingsMinor === 0 ? null : (
          <SummaryRow label={totals.savingsMinor > 0 ? 'Na oszczędności' : 'Z oszczędności'}>
            <Money amountMinor={Math.abs(totals.savingsMinor)} variant="savings" />
          </SummaryRow>
        )}
        {totals.investmentMinor === 0 ? null : (
          <SummaryRow label={totals.investmentMinor > 0 ? 'Na inwestycje' : 'Z inwestycji'}>
            <Money amountMinor={Math.abs(totals.investmentMinor)} variant="investment" />
          </SummaryRow>
        )}
        <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
          <dt className="text-sm font-medium">{totals.netMinor < 0 ? 'Na minusie' : 'Zostaje'}</dt>
          <dd>
            {totals.netMinor < 0 ? (
              <Money amountMinor={-totals.netMinor} size="lg" variant="expense" />
            ) : (
              <Money amountMinor={totals.netMinor} size="lg" />
            )}
          </dd>
        </div>
      </dl>
      {progress ? (
        <div className="mt-3">
          <ProgressBar pool="savings" valueBps={progress.valueBps} />
          <div className="mt-1.5 flex justify-between gap-2 text-caption tabular-nums text-muted-foreground">
            <span>{progress.elapsed}</span>
            <span className="text-right">{progress.remaining}</span>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

/**
 * Wiersz kategorii: nazwa, udział, trend, kwota.
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Kategoria.
 * @param props.first - Czy pierwszy wiersz.
 * @returns Element wiersza.
 */
function CategoryRow({ item, first }: { item: CategorySpendingDto; first: boolean }): ReactNode {
  const trend = categoryTrend(item);
  return (
    <li
      className={
        first
          ? 'flex min-h-touch items-center gap-2.5 py-1.5'
          : 'flex min-h-touch items-center gap-2.5 border-t border-border py-1.5'
      }
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-muted text-muted-foreground">
        <Tag aria-hidden="true" className={ROW_ICON} strokeWidth={1.5} />
      </span>
      <span className="min-w-0 flex-1 text-sm leading-tight">{item.name}</span>
      <span className="w-10 text-right text-caption tabular-nums text-muted-foreground">
        {percentLabel(item.shareBps)}
      </span>
      <span className="w-4 text-center text-caption text-muted-foreground">
        {trend ? (
          <>
            <span aria-hidden="true">{trend.arrow}</span>
            <span className="sr-only">{trend.label}</span>
          </>
        ) : null}
      </span>
      <Money amountMinor={item.amountMinor} variant="expense" />
    </li>
  );
}

/**
 * Na co idą pieniądze: do pięciu kategorii i licznik wydatków bez kategorii.
 *
 * @param props - Właściwości komponentu.
 * @param props.summary - Podsumowanie miesiąca.
 * @returns Element sekcji.
 */
function CategoriesSection({ summary }: { summary: MonthSummaryDto }): ReactNode {
  const { topCategories, uncategorizedCount, month } = summary;
  return (
    <Section
      action={
        <Button asChild size="small" variant="link">
          <Link to={`/m/${month}/categories`}>szczegóły</Link>
        </Button>
      }
      title="Na co idą pieniądze"
    >
      {topCategories.length === 0 ? (
        <p className="text-sm text-muted-foreground">W tym miesiącu nie ma jeszcze wydatków.</p>
      ) : (
        <ul>
          {topCategories.map((item, index) => (
            <CategoryRow first={index === 0} item={item} key={item.categoryId ?? 'none'} />
          ))}
        </ul>
      )}
      {uncategorizedCount > 0 ? (
        <p className="mt-2 text-sm">
          <Link
            className="inline-flex min-h-touch items-center text-primary underline-offset-4 hover:underline"
            to={`/m/${month}/transactions?type=expense&uncategorized=true`}
          >
            {uncategorizedLabel(uncategorizedCount)} — uzupełnij
          </Link>
        </p>
      ) : null}
    </Section>
  );
}

/**
 * Wiersz ostatniej transakcji — dotknięcie otwiera edycję w arkuszu.
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Transakcja.
 * @param props.first - Czy pierwszy wiersz.
 * @param props.onOpen - Otwarcie edycji.
 * @returns Element wiersza.
 */
function RecentRow({
  item,
  first,
  onOpen,
}: {
  item: TransactionListItemDto;
  first: boolean;
  onOpen: () => void;
}): ReactNode {
  const Icon = TYPE_ICON[item.type];
  return (
    <ListRow
      amount={
        <Money
          amountMinor={item.amountMinor}
          variant={item.type === 'transfer' ? 'neutral' : item.type}
        />
      }
      caption={[formatDateShort(item.bookedOn), ...captionParts(item)].join(' · ')}
      first={first}
      icon={<Icon aria-hidden="true" className={ROW_ICON} strokeWidth={1.5} />}
      name={transactionTitle(item)}
      onClick={onOpen}
    />
  );
}

/**
 * Ostatnie transakcje miesiąca.
 *
 * @param props - Właściwości komponentu.
 * @param props.summary - Podsumowanie miesiąca.
 * @returns Element sekcji.
 */
function RecentSection({ summary }: { summary: MonthSummaryDto }): ReactNode {
  const { openEdit, openNew } = useTransactionSheet();
  const canAdd = !summary.isFuture && summary.range.to >= summary.canPostBackTo;
  return (
    <Section
      action={
        <Button asChild size="small" variant="link">
          <Link to={`/m/${summary.month}/transactions`}>historia</Link>
        </Button>
      }
      title="Ostatnie"
    >
      {summary.recentTransactions.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">
            W miesiącu {formatMonth(summary.month)} nie ma jeszcze żadnej transakcji.
          </p>
          {canAdd ? (
            <Button
              onClick={() => {
                openNew('expense');
              }}
              variant="ghost"
            >
              Dodaj wydatek
            </Button>
          ) : null}
        </div>
      ) : (
        <ul>
          {summary.recentTransactions.map((item, index) => (
            <li key={item.id}>
              <RecentRow
                first={index === 0}
                item={item}
                onOpen={() => {
                  openEdit(item.id);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * Baner nad treścią: podgląd przyszłego miesiąca albo zamknięty miesiąc.
 *
 * @param props - Właściwości komponentu.
 * @param props.summary - Podsumowanie miesiąca.
 * @returns Element banera albo nic.
 */
function Notice({ summary }: { summary: MonthSummaryDto }): ReactNode {
  const notice = monthNotice(summary);
  if (notice === null) return null;
  const Icon = notice.kind === 'future' ? CalendarClock : Lock;
  return (
    <p
      className="mt-3 flex gap-2.5 rounded-md border-l-[3px] border-muted-foreground bg-muted-foreground/10 px-3 py-2.5 text-sm leading-snug"
      role="note"
    >
      <Icon aria-hidden="true" className="mt-px h-4 w-4 shrink-0" strokeWidth={1.5} />
      {notice.kind === 'future' ? (
        <span className="flex flex-col">
          Podgląd — ten miesiąc jeszcze się nie zaczął, więc nie da się w nim księgować.
          <BudgetPreviewLink summary={summary} />
        </span>
      ) : (
        `Miesiąc zamknięty — księgowanie i zmiany kwot są możliwe od ${notice.from}. Limit zmienisz w ustawieniach.`
      )}
    </p>
  );
}

/**
 * Pierwsze uruchomienie: cztery kroki startowe, przycisk tylko przy pierwszym (15 §4.9).
 *
 * @returns Element stanu pustego.
 */
function FirstRun(): ReactNode {
  return (
    <EmptyState
      action={
        <Button asChild size="small" variant="primary">
          <Link to="/accounts">Dodaj konto</Link>
        </Button>
      }
      description="Cztery kroki i aplikacja pokaże, dokąd idą pieniądze."
      icon={<WalletCards aria-hidden="true" className="h-7 w-7" strokeWidth={1.5} />}
      steps={[
        { label: 'Dodaj konta' },
        { label: 'Ustaw wydatki stałe' },
        { label: 'Określ cele' },
        { label: 'Wpisz pierwszy przychód' },
      ]}
      title="Zacznijmy od kont"
    />
  );
}

/**
 * Ekran miesiąca.
 *
 * @returns Element ekranu.
 */
export default function MonthScreen(): ReactNode {
  const { household } = useAuth();
  const month = useMonthParam(household?.timezone);
  const summary = useMonthSummary(month);
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const available = useAvailableMonths(pickerOpen);
  const swipe = useMonthSwipe(month);
  usePrefetchNeighbourMonths(month, summary.isSuccess);

  let content: ReactNode;
  if (summary.isPending) {
    content = <MonthSkeleton />;
  } else if (summary.isError) {
    content = (
      <ErrorState
        details={errorDetails(summary.error)}
        lastUpdatedAt={lastUpdatedLabel(summary.dataUpdatedAt)}
        onRetry={() => {
          void summary.refetch();
        }}
        retrying={summary.isFetching}
        title="Nie udało się wczytać miesiąca"
      />
    );
  } else if (isFirstRun(summary.data) && !summary.data.comparison.hasPreviousData) {
    content = <FirstRun />;
  } else {
    content = (
      <>
        <Notice summary={summary.data} />
        <AccountsSection
          accounts={summary.data.accounts}
          netWorthMinor={summary.data.netWorthMinor}
        />
        <TotalsSection summary={summary.data} />
        <AllocationTile summary={summary.data} />
        <GoalsTile summary={summary.data} />
        <TodoSection summary={summary.data} />
        <UpcomingTile summary={summary.data} />
        <BudgetHint summary={summary.data} />
        <CategoriesSection summary={summary.data} />
        <RecentSection summary={summary.data} />
      </>
    );
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <MonthSwitcher
          dimmed={summary.isPending}
          hrefFor={monthHref}
          month={month}
          onOpenPicker={() => {
            setPickerOpen(true);
          }}
        />
      </header>
      {/* Klucz = miesiąc: zmiana miesiąca to krótkie wejście treści (15 §7), a nie
          podmiana liczb w miejscu, która wyglądałaby jak błąd. */}
      <div
        className="duration-200 animate-in fade-in motion-reduce:animate-none"
        key={month}
        onPointerDown={swipe.onPointerDown}
        onPointerUp={swipe.onPointerUp}
      >
        {content}
      </div>
      <MonthGridSheet
        available={available.data?.months}
        currentMonth={
          available.data?.currentMonth ?? currentMonthKey(household?.timezone ?? 'Europe/Warsaw')
        }
        // Rok siatki startuje od oglądanego miesiąca — nowy miesiąc, nowa siatka.
        key={`grid-${month}`}
        month={month}
        onOpenChange={setPickerOpen}
        onPick={(picked) => {
          void navigate(monthHref(picked));
        }}
        open={pickerOpen}
      />
    </main>
  );
}
