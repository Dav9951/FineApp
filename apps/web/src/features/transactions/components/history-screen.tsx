import {
  formatMonth,
  shiftMonth,
  type MonthKey,
  type TransactionListItemDto,
  type TransactionListSummary,
  type TransactionType,
} from '@fineapp/shared';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  Camera,
  ListFilter,
  Receipt,
  Repeat,
  ScrollText,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  Money,
  MonthSwitcher,
  Section,
  Skeleton,
  SkeletonList,
  Tabs,
  TextField,
} from '../../../components/ui/index.js';
import { useAuth } from '../../auth/auth-context.js';
import { useMonthParam } from '../../../hooks/use-month-param.js';
import { errorDetails } from '../../../lib/api-client.js';
import { transactionCountLabel } from '../../../lib/format.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import {
  hasAnyFilter,
  historyFiltersToParams,
  historyQuery,
  NO_FILTERS,
  panelFilterCount,
  parseHistoryFilters,
  type HistoryFilters,
} from '../history-filters.js';
import { captionParts, dayHeading, groupByDay, transactionTitle } from '../history-view.js';
import { useTrashTransaction } from '../hooks/use-trash-transaction.js';
import { useTransactionPages } from '../hooks/use-transactions.js';
import { HistoryFilterSheet } from './history-filter-sheet.js';
import { SwipeRow } from './swipe-row.js';
import { useTransactionSheet } from './transaction-sheet.js';

/**
 * Historia transakcji — `/m/:month/transactions`
 * ([06 §3.2](../../../../../../plans/06-ui-views.md#32-historia-transakcji--mmonthtransactions)).
 *
 * Transakcje miesiąca pogrupowane po dniach z sumą dnia, szybkie filtry typu,
 * wyszukiwarka i panel filtrów — wszystko w adresie. Przewijanie doczytuje kolejne
 * strony; na końcu przycisk do poprzedniego miesiąca zamiast automatycznego przeskoku.
 *
 * Dotknięcie wiersza otwiera edycję (tam też „Usuń"), gest w bok to skrót: w lewo
 * usuwa z „Cofnij", w prawo otwiera edycję (15 §4.8).
 */

/** Wartość szybkiego filtra „Wszystko" — `Tabs` wymaga napisu. */
const ALL = 'all';

/** Szybkie filtry typu. */
const QUICK_FILTERS: readonly { value: TransactionType | typeof ALL; label: string }[] = [
  { value: ALL, label: 'Wszystko' },
  { value: 'expense', label: 'Wydatki' },
  { value: 'income', label: 'Wpływy' },
  { value: 'transfer', label: 'Przelewy' },
];

/** Ile czekać po ostatnim znaku, zanim tekst trafi do adresu i do API. */
const SEARCH_DEBOUNCE_MS = 300;

/** Ikona typu transakcji — kategorie nie mają jeszcze ikon (`Z-22`). */
const TYPE_ICON = {
  expense: Receipt,
  income: ArrowDownLeft,
  transfer: ArrowLeftRight,
} as const;

/**
 * Adres historii dla miesiąca z zachowaniem filtrów.
 *
 * @param month - Miesiąc.
 * @param filters - Filtry.
 * @returns Ścieżka z parametrami.
 */
export function historyHref(month: MonthKey, filters: HistoryFilters): string {
  const search = historyFiltersToParams(filters).toString();
  return `/m/${month}/transactions${search ? `?${search}` : ''}`;
}

/**
 * Szkielet listy — nagłówek dnia i wiersze, jak treść.
 *
 * @returns Element szkieletu.
 */
function HistorySkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Wczytywanie transakcji">
      <Skeleton className="mt-4 h-4 w-56" />
      <Section>
        <Skeleton className="mb-2 h-3 w-40" />
        <SkeletonList rows={3} />
      </Section>
      <Section>
        <Skeleton className="mb-2 h-3 w-40" />
        <SkeletonList rows={2} />
      </Section>
    </div>
  );
}

/**
 * Linia podsumowania: „47 transakcji · wydatki 6 423,00 zł".
 *
 * Pokazuje sumy, które coś mówią przy bieżącym filtrze: przy „Wydatkach" wpływy są
 * z definicji zerem, a „wpływy 0,00 zł" to szum.
 *
 * @param props - Właściwości komponentu.
 * @param props.summary - Podsumowanie z serwera.
 * @param props.type - Szybki filtr typu.
 * @returns Element podsumowania.
 */
function SummaryLine({
  summary,
  type,
}: {
  summary: TransactionListSummary;
  type: TransactionType | undefined;
}): ReactNode {
  const parts: ReactNode[] = [<span key="count">{transactionCountLabel(summary.count)}</span>];
  if (type === 'expense' || (type === undefined && summary.expenseMinor > 0)) {
    parts.push(
      <span key="expense">
        wydatki <Money amountMinor={summary.expenseMinor} size="meta" />
      </span>,
    );
  }
  if (type === 'income' || (type === undefined && summary.incomeMinor > 0)) {
    parts.push(
      <span key="income">
        wpływy <Money amountMinor={summary.incomeMinor} size="meta" />
      </span>,
    );
  }
  if (type === 'transfer') {
    parts.push(
      <span key="transfer">
        przelewy <Money amountMinor={summary.transferMinor} size="meta" />
      </span>,
    );
  }
  return (
    <p className="mt-3 flex flex-wrap gap-x-1 text-meta text-muted-foreground">
      {parts.map((part, index) => (
        <span className="inline-flex gap-1" key={index}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {part}
        </span>
      ))}
    </p>
  );
}

/**
 * Suma dnia w nagłówku grupy: wpływy minus wydatki; zero się nie pokazuje.
 *
 * @param props - Właściwości komponentu.
 * @param props.netMinor - Suma netto dnia.
 * @returns Element kwoty albo nic.
 */
function DayTotal({ netMinor }: { netMinor: number }): ReactNode {
  if (netMinor === 0) return null;
  return (
    <Money
      amountMinor={Math.abs(netMinor)}
      size="sm"
      variant={netMinor < 0 ? 'expense' : 'income'}
    />
  );
}

/**
 * Wiersz transakcji.
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Transakcja.
 * @param props.first - Czy pierwszy w grupie dnia.
 * @param props.onEdit - Otwarcie edycji.
 * @param props.onDelete - Przeniesienie do kosza.
 * @returns Element wiersza.
 */
function TransactionRow({
  item,
  first,
  onEdit,
  onDelete,
}: {
  item: TransactionListItemDto;
  first: boolean;
  onEdit: () => void;
  onDelete: () => void;
}): ReactNode {
  const Icon = TYPE_ICON[item.type];
  const deleted = item.deletedAt !== null;
  const caption = (
    <span className="inline-flex items-center gap-1">
      {captionParts(item).join(' · ')}
      {item.source === 'ocr' ? (
        <Camera aria-label="z paragonu" className="h-3.5 w-3.5" role="img" strokeWidth={1.5} />
      ) : null}
      {item.source === 'recurring' ? (
        <Repeat aria-label="cykliczna" className="h-3.5 w-3.5" role="img" strokeWidth={1.5} />
      ) : null}
    </span>
  );
  const name = (
    <span className="inline-flex max-w-full items-center gap-2">
      <span className="truncate">{transactionTitle(item)}</span>
      {deleted ? <Badge tone="neutral">w koszu</Badge> : null}
      {item.status === 'pending' ? <Badge>oczekuje</Badge> : null}
      {item.status === 'void' ? <Badge tone="neutral">anulowana</Badge> : null}
    </span>
  );
  return (
    <SwipeRow disabled={deleted} onSwipeLeft={onDelete} onSwipeRight={onEdit}>
      <ListRow
        amount={
          <Money
            amountMinor={item.amountMinor}
            variant={item.type === 'transfer' ? 'neutral' : item.type}
          />
        }
        caption={caption}
        className={deleted ? 'opacity-60' : undefined}
        first={first}
        icon={<Icon aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={1.5} />}
        name={name}
        onClick={onEdit}
      />
    </SwipeRow>
  );
}

/**
 * Obserwuje koniec listy i doczytuje kolejną stronę, gdy wjedzie w widok.
 *
 * Przycisk „Wczytaj więcej" zostaje obok jako droga bez przewijania — i jedyna tam,
 * gdzie `IntersectionObserver` nie istnieje.
 *
 * @param onVisible - Wywoływane, gdy znacznik końca jest widoczny.
 * @param enabled - Czy obserwować (jest kolejna strona i nic się nie wczytuje).
 * @returns Referencja do znacznika końca listy.
 */
function useEndOfList(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!enabled || node === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onVisible();
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(node);
    return (): void => {
      observer.disconnect();
    };
  }, [onVisible, enabled]);
  return ref;
}

/**
 * Ekran historii transakcji.
 *
 * @returns Element ekranu.
 */
export default function HistoryScreen(): ReactNode {
  const { household } = useAuth();
  const month = useMonthParam(household?.timezone);
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseHistoryFilters(params), [params]);
  const query = useMemo(() => historyQuery(month, filters), [month, filters]);
  const pages = useTransactionPages(query);
  const { openEdit, openNew } = useTransactionSheet();
  const trash = useTrashTransaction();

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(filters.q !== undefined);
  const [searchText, setSearchText] = useState(filters.q ?? '');

  /**
   * Zapisuje filtry w adresie.
   *
   * @param next - Nowe filtry.
   * @param replace - Zastąpić wpis historii zamiast dokładać (pisanie w wyszukiwarce).
   */
  const applyFilters = (next: HistoryFilters, replace = false): void => {
    setParams(historyFiltersToParams(next), { replace });
  };

  // Tekst trafia do adresu po chwili bez pisania: żądanie na każdy znak to wyścig
  // odpowiedzi, a wpis historii na każdy znak robi z „wstecz" gumkę.
  useEffect(() => {
    const trimmed = searchText.trim();
    if (trimmed === (filters.q ?? '')) return;
    const timer = setTimeout(() => {
      const { q: _previous, ...rest } = filters;
      setParams(historyFiltersToParams(trimmed === '' ? rest : { ...rest, q: trimmed }), {
        replace: true,
      });
    }, SEARCH_DEBOUNCE_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [searchText, filters, setParams]);

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = pages;
  const loadMore = useMemo(
    () => (): void => {
      void fetchNextPage();
    },
    [fetchNextPage],
  );
  const endRef = useEndOfList(loadMore, hasNextPage && !isFetchingNextPage);

  const previousMonth = shiftMonth(month, -1);
  const filtered = hasAnyFilter(filters);
  const panelCount = panelFilterCount(filters);

  let list: ReactNode;
  if (pages.isPending) {
    list = <HistorySkeleton />;
  } else if (pages.isError) {
    list = (
      <ErrorState
        details={errorDetails(pages.error)}
        lastUpdatedAt={lastUpdatedLabel(pages.dataUpdatedAt)}
        onRetry={() => {
          void pages.refetch();
        }}
        retrying={pages.isFetching}
        title="Nie udało się wczytać transakcji"
      />
    );
  } else {
    const items = pages.data.pages.flatMap((page) => page.data);
    const summary = pages.data.pages[0]?.meta.summary;
    const groups = groupByDay(items, summary?.days);

    if (items.length === 0) {
      list = filtered ? (
        <EmptyState
          action={
            <Button
              onClick={() => {
                setSearchText('');
                applyFilters(NO_FILTERS);
              }}
              size="large"
              variant="ghost"
            >
              Wyczyść filtry
            </Button>
          }
          description="Zmień filtry albo poszukaj w innym miesiącu."
          icon={<ListFilter aria-hidden="true" className="h-7 w-7" strokeWidth={1.5} />}
          title="Nic nie pasuje do filtrów"
        />
      ) : (
        <EmptyState
          action={
            <Button
              onClick={() => {
                openNew('expense');
              }}
              size="large"
              variant="primary"
            >
              Dodaj wydatek
            </Button>
          }
          description={`W miesiącu ${formatMonth(month)} nie ma jeszcze żadnej transakcji.`}
          icon={<ScrollText aria-hidden="true" className="h-7 w-7" strokeWidth={1.5} />}
          title="Pusty miesiąc"
        />
      );
    } else {
      list = (
        <>
          {summary ? <SummaryLine summary={summary} type={filters.type} /> : null}
          {groups.map((group) => (
            <Section
              action={<DayTotal netMinor={group.netMinor} />}
              key={group.bookedOn}
              title={dayHeading(group.bookedOn)}
            >
              <ul>
                {group.items.map((item, index) => (
                  <li key={item.id}>
                    <TransactionRow
                      first={index === 0}
                      item={item}
                      onDelete={() => {
                        trash({ id: item.id, monthKey: item.monthKey });
                      }}
                      onEdit={() => {
                        openEdit(item.id);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </Section>
          ))}
          <div className="mt-6" ref={endRef}>
            {hasNextPage ? (
              <Button loading={isFetchingNextPage} onClick={loadMore} size="large" variant="ghost">
                Wczytaj więcej
              </Button>
            ) : (
              <Button asChild size="large" variant="ghost">
                <Link to={historyHref(previousMonth, filters)}>
                  Pokaż {formatMonth(previousMonth)}
                </Link>
              </Button>
            )}
          </div>
        </>
      );
    }
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <MonthSwitcher hrefFor={(m) => historyHref(m, filters)} month={month} />
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            aria-expanded={searchOpen}
            className="border-0"
            label={searchOpen ? 'Zamknij wyszukiwanie' : 'Szukaj'}
            onClick={() => {
              if (searchOpen) setSearchText('');
              setSearchOpen(!searchOpen);
            }}
          >
            {searchOpen ? (
              <X aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            ) : (
              <Search aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            )}
          </IconButton>
          <Button
            aria-label={panelCount > 0 ? `Filtry, aktywne: ${String(panelCount)}` : 'Filtry'}
            className="relative min-w-touch px-2"
            onClick={() => {
              setFiltersOpen(true);
            }}
            variant="link"
          >
            <ListFilter aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            {/* Na 390 px napis zabierał miejsce nazwie miesiąca („wrzesień …") — zostaje
                ikona z etykietą dostępności i plakietką liczby filtrów. */}
            <span className="hidden sm:inline">Filtry</span>
            {panelCount > 0 ? (
              // Plakietka na ikonie, nie obok: przycisk zostaje 44 px, a nazwa
              // najdłuższego miesiąca („październik 2026") mieści się na 390 px.
              <Badge className="absolute right-0 top-1 sm:static">{panelCount}</Badge>
            ) : null}
          </Button>
        </div>
      </header>

      {searchOpen ? (
        <TextField
          autoFocus
          className="mt-2"
          label="Szukaj w opisie, sprzedawcy i notatkach"
          maxLength={100}
          onChange={setSearchText}
          placeholder="np. Lidl"
          value={searchText}
        />
      ) : null}

      <div className="mt-3">
        <Tabs
          items={QUICK_FILTERS.map((option) => ({
            value: option.value,
            label: option.label,
            content: list,
          }))}
          onValueChange={(value) => {
            const { type: _previous, ...rest } = filters;
            const parsed = QUICK_FILTERS.find((option) => option.value === value)?.value;
            applyFilters(parsed === undefined || parsed === ALL ? rest : { ...rest, type: parsed });
          }}
          value={filters.type ?? ALL}
        />
      </div>

      <HistoryFilterSheet
        filters={filters}
        onApply={(next) => {
          // Zamknięcie arkusza cofa jego wpis historii (`history.back()`, 15 §4.6).
          // Zmiana adresu w tej samej chwili zostałaby tym cofnięciem odwołana —
          // filtry trafiają do adresu dopiero po `popstate`, jak przejście do kont
          // z arkusza transakcji (ADR-037).
          window.addEventListener(
            'popstate',
            () => {
              applyFilters(next);
            },
            { once: true },
          );
          setFiltersOpen(false);
        }}
        onOpenChange={setFiltersOpen}
        open={filtersOpen}
      />
    </main>
  );
}
