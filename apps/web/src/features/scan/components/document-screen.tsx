import {
  formatDateOnly,
  monthKeyOf,
  todayInTimezone,
  type AccountDto,
  type CommitNewCategory,
  type DocumentDto,
} from '@fineapp/shared';
import { AlertTriangle, CheckCircle2, FileText, Loader2, ScanLine, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Money,
  Section,
  Sheet,
  Skeleton,
  Tabs,
  TextField,
  useToast,
} from '../../../components/ui/index.js';
import { ApiRequestError, errorDetails } from '../../../lib/api-client.js';
import { transactionCountLabel } from '../../../lib/format.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { useAuth } from '../../auth/auth-context.js';
import { useCategoryTree } from '../../categories/hooks/use-categories.js';
import {
  AccountPicker,
  CategoryPicker,
  DatePicker,
} from '../../transactions/components/transaction-pickers.js';
import { useTransactionSheet } from '../../transactions/components/transaction-sheet.js';
import { defaultAccountId, postingBounds } from '../../transactions/transaction-form-state.js';
import { categoryLabel } from '../../transactions/transaction-view.js';
import {
  useCommitDocument,
  useDeleteDocument,
  useDiscardDocument,
  useDocument,
  useDocumentImage,
  useReanalyzeDocument,
  useUpdateDocument,
} from '../hooks/use-documents.js';
import {
  buildCommit,
  categoryGroups,
  defaultMode,
  defaultSelection,
  documentTitle,
  documentTotalCheck,
  dominantCategory,
  groupingKey,
  isInFlight,
  proposalAccepted,
  proposalNameOfKey,
  selectionSummary,
  type CommitMode,
} from '../scan-view.js';
import { ItemSheet, type ItemSheetTarget } from './item-sheet.js';
import { ReviewItemRow } from './review-item-row.js';

/**
 * Przegląd dokumentu — `/scan/:documentId`
 * ([06 §3.4 B i C](../../../../../../plans/06-ui-views.md#34-skanowanie--scan), `F7-8`, `F7-10`).
 *
 * Jedna trasa, kilka stanów: analiza w toku (podgląd z uczciwym „zwykle 5–15 sekund"),
 * nieudany odczyt (ponów albo dodaj ręcznie — nigdy ślepy zaułek, 08 §14), przegląd
 * i zatwierdzenie, dokument zapisany albo odrzucony. **AI proponuje, człowiek
 * zatwierdza**: nic nie trafia do księgi przed „Zatwierdź".
 */

/**
 * Konto proponowane, gdy dokument go nie wskazał: domyślne konto wydatków z ustawień
 * (ADR-070), a bez niego jedyne konto „na życie" — przy kilku takich zgadywanie byłoby
 * gorsze niż pytanie.
 *
 * @param accounts - Konta.
 * @param preferredId - Domyślne konto wydatków gospodarstwa albo `null`.
 * @returns Identyfikator albo `null`.
 */
function fallbackAccount(
  accounts: readonly AccountDto[] | undefined,
  preferredId: string | null,
): string | null {
  const list = accounts ?? [];
  if (preferredId !== null) {
    const preferred = defaultAccountId(list, preferredId);
    if (preferred === preferredId) return preferred;
  }
  const spending = list.filter(
    (account) => !account.isArchived && account.allocationClass === 'spending',
  );
  return spending.length === 1 ? (spending[0]?.id ?? null) : null;
}

/** Opcje przełącznika trybu (06 §3.4.C, ADR-069). */
const MODE_TABS: readonly { value: CommitMode; label: string }[] = [
  { value: 'single', label: 'Całość' },
  { value: 'by_category', label: 'Kategorie' },
  { value: 'split', label: 'Pozycje' },
];

/**
 * Zawęża wartość zakładki do trybu zatwierdzenia.
 *
 * @param value - Wartość z przełącznika.
 * @returns Tryb; nieznana wartość — `single`.
 */
function modeOf(value: string): CommitMode {
  return MODE_TABS.find((tab) => tab.value === value)?.value ?? 'single';
}

/**
 * Podgląd zdjęcia dokumentu (miniatura, dotknięcie — pełny obraz).
 *
 * @param props - Właściwości komponentu.
 * @param props.document - Dokument.
 * @param props.overlay - Nakładka (analiza w toku).
 * @returns Element podglądu.
 */
function DocumentPreview({
  document,
  overlay,
}: {
  document: DocumentDto;
  overlay?: ReactNode;
}): ReactNode {
  const isPdf = document.mimeType === 'application/pdf';
  const thumb = useDocumentImage(document.id, 'thumb', !isPdf);
  const [open, setOpen] = useState(false);
  const full = useDocumentImage(document.id, 'original', open && !isPdf);

  if (isPdf) {
    return (
      <div className="relative flex h-28 items-center justify-center gap-2 rounded-md border border-border bg-muted text-sm text-muted-foreground">
        <FileText aria-hidden="true" className="h-6 w-6" strokeWidth={1.5} />
        PDF
        {document.pageCount === null ? '' : ` · stron: ${String(document.pageCount)}`}
        {overlay}
      </div>
    );
  }
  return (
    <>
      <button
        aria-label="Powiększ zdjęcie dokumentu"
        className="relative flex h-28 w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        {thumb.url === null ? (
          <Skeleton className="h-full w-full" />
        ) : (
          <img alt="" className="h-full object-contain" src={thumb.url} />
        )}
        {overlay ?? (
          <span className="absolute bottom-2 right-2 rounded-full bg-card px-2 py-0.5 text-caption">
            dotknij, by powiększyć
          </span>
        )}
      </button>
      <Sheet onOpenChange={setOpen} open={open} title="Zdjęcie dokumentu">
        <div className="max-h-[75dvh] overflow-auto">
          {full.url === null ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <img alt="Zdjęcie dokumentu" className="w-full" src={full.url} />
          )}
        </div>
      </Sheet>
    </>
  );
}

/**
 * Szkielet przeglądu.
 *
 * @returns Element szkieletu.
 */
function ReviewSkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Wczytywanie dokumentu">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="mt-4 h-11 w-full" />
      <Skeleton className="mt-2 h-11 w-full" />
      <Skeleton className="mt-2 h-11 w-full" />
      <Skeleton className="mt-6 h-40 w-full" />
    </div>
  );
}

/** Pole nagłówka otwarte w arkuszu. */
type HeaderView = 'merchant' | 'date' | 'account' | 'category' | null;

/**
 * Przegląd odczytanego dokumentu z zatwierdzeniem (06 §3.4.C).
 *
 * @param props - Właściwości komponentu.
 * @param props.document - Dokument w stanie `parsed`.
 * @returns Element przeglądu.
 */
function DocumentReview({ document }: { document: DocumentDto }): ReactNode {
  const navigate = useNavigate();
  const toast = useToast();
  const { household } = useAuth();
  const today = todayInTimezone(household?.timezone ?? 'Europe/Warsaw');
  const bounds = postingBounds(
    today,
    household?.backPostingLimitMonths ?? 1,
    household?.monthStartDay ?? 1,
  );
  const accounts = useAccountList(false);
  const expenseTree = useCategoryTree('expense');
  const incomeTree = useCategoryTree('income');
  const updateHeader = useUpdateDocument(document.id);
  const commit = useCommitDocument(document.id);
  const discard = useDiscardDocument(document.id);

  const statement = document.kind === 'bank_statement';
  const [mode, setMode] = useState<CommitMode>(() =>
    defaultMode(document.kind, document.items, defaultSelection(document.items)),
  );
  const [selected, setSelected] = useState<Set<string>>(() => defaultSelection(document.items));
  const [categoryId, setCategoryId] = useState<string | null>(() =>
    dominantCategory(document.items, defaultSelection(document.items)),
  );
  const [accepted, setAccepted] = useState<CommitNewCategory[]>([]);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [headerView, setHeaderView] = useState<HeaderView>(null);
  const [itemTarget, setItemTarget] = useState<ItemSheetTarget | null>(null);
  const [merchantDraft, setMerchantDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const accountId =
    document.suggestedAccountId ??
    fallbackAccount(accounts.data, household?.defaultExpenseAccountId ?? null);
  const bookedOn = document.summary?.bookedOn ?? today;
  const merchant = document.summary?.merchant ?? null;
  const summary = selectionSummary(document.items, selected);
  const totalCheck = documentTotalCheck(document);
  const perItem = mode !== 'single';

  // Podgląd trybu „Kategorie" — ta sama funkcja, którą serwer grupuje przy zapisie
  // (07 §9.4). Zanim drzewo kategorii się wczyta, kategoria obciążenia uchodzi za
  // kategorię wydatku (serwer pilnuje zgodności kierunku przy korekcie).
  const groups = categoryGroups(document.items, selected, (item) =>
    groupingKey(
      item,
      (id) =>
        expenseTree.data === undefined
          ? item.direction === 'outflow'
          : categoryLabel(expenseTree.data, id) !== undefined,
      accepted,
    ),
  );

  const nameOf = useMemo(
    () =>
      (id: string | null): string | null => {
        if (id === null) return null;
        return (
          categoryLabel(expenseTree.data ?? [], id) ??
          categoryLabel(incomeTree.data ?? [], id) ??
          null
        );
      },
    [expenseTree.data, incomeTree.data],
  );

  const patchHeader = async (
    body: Parameters<typeof updateHeader.mutateAsync>[0],
  ): Promise<void> => {
    setMessage(null);
    try {
      await updateHeader.mutateAsync(body);
      setHeaderView(null);
    } catch (error) {
      setMessage(
        error instanceof ApiRequestError ? error.message : 'Nie udało się zapisać zmiany.',
      );
    }
  };

  const submit = async (): Promise<void> => {
    const built = buildCommit(
      { mode, accountId, bookedOn, categoryId, selected, acceptedProposals: accepted },
      summary,
    );
    if (!built.ok) {
      setMessage(built.message);
      // Brak konta rozwiązuje jeden wybór — od razu go pokazujemy (ADR-070).
      if (accountId === null) setHeaderView('account');
      return;
    }
    setMessage(null);
    try {
      const result = await commit.mutateAsync({ body: built.body, idempotencyKey });
      toast.show({
        message: `Zapisano: ${transactionCountLabel(result.data.transactions.length)}`,
      });
      void navigate(`/m/${monthKeyOf(bookedOn, household?.monthStartDay ?? 1)}`);
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.message : 'Nie udało się zapisać.');
    }
  };

  const allSelected = summary.selectedCount === summary.totalCount;
  const accountName =
    accountId === null
      ? 'Wybierz'
      : (accounts.data?.find((account) => account.id === accountId)?.name ?? '…');

  let totalValue: ReactNode = null;
  if (document.summary?.totalMinor !== null && document.summary?.totalMinor !== undefined) {
    totalValue = (
      <span className="flex items-baseline gap-2">
        <Money amountMinor={document.summary.totalMinor} size="sm" variant="expense" />
        {totalCheck.kind === 'match' ? (
          <span className="flex items-center gap-1 text-caption font-semibold text-success">
            <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
            zgadza się
          </span>
        ) : null}
        {totalCheck.kind === 'mismatch' ? (
          <span className="flex items-center gap-1 text-caption font-semibold text-danger">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
            różnica <Money amountMinor={Math.abs(totalCheck.differenceMinor)} size="meta" unit />
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <IconButton
          label="Zamknij przegląd"
          onClick={() => {
            void navigate('/scan');
          }}
          variant="ghost"
        >
          <X aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </IconButton>
        <h1 className="min-w-0 truncate text-lg font-semibold">
          {documentTitle(document.kind, merchant)}
        </h1>
        <Button
          loading={commit.isPending}
          onClick={() => {
            void submit();
          }}
          variant="primary"
        >
          Zatwierdź
        </Button>
      </header>
      {/* Komunikat tuż pod „Zatwierdź" — na dole listy nikt go nie widział (ADR-070). */}
      {message === null ? null : (
        <p
          className="mt-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
          role="alert"
        >
          {message}
        </p>
      )}

      <Section first>
        <DocumentPreview document={document} />
        <div className="mt-3">
          {statement ? (
            <Field
              label="Okres"
              value={
                document.summary?.periodFrom && document.summary.periodTo
                  ? `${formatDateOnly(document.summary.periodFrom)} – ${formatDateOnly(document.summary.periodTo)}`
                  : '—'
              }
            />
          ) : (
            <Field
              label="Sprzedawca"
              onOpen={() => {
                setMerchantDraft(merchant ?? '');
                setHeaderView('merchant');
              }}
              value={merchant ?? 'Dodaj'}
            />
          )}
          <Field
            label={statement ? 'Data zapisu' : 'Data'}
            onOpen={() => {
              setHeaderView('date');
            }}
            value={formatDateOnly(bookedOn)}
          />
          <Field
            label="Konto"
            onOpen={() => {
              setHeaderView('account');
            }}
            value={accountName}
          />
          {statement ? null : <Field label="Suma" value={totalValue ?? 'nieczytelna'} />}
          {!statement && mode === 'single' ? (
            <Field
              label="Kategoria"
              onOpen={() => {
                setHeaderView('category');
              }}
              value={nameOf(categoryId) ?? 'Wybierz'}
            />
          ) : null}
        </div>

        {totalCheck.kind === 'mismatch' ? (
          <p className="mt-3 flex gap-2 rounded-md border-l-2 border-warning bg-warning/10 p-3 text-sm">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              Pozycje nie sumują się do kwoty z paragonu. To normalne przy rabatach i kaucjach —{' '}
              <strong>zapis nie jest blokowany</strong>. Rozstrzygasz ty, nie model.
            </span>
          </p>
        ) : null}

        {document.summary?.notes ? (
          <p className="mt-3 text-caption text-muted-foreground">
            Uwagi z odczytu: {document.summary.notes}
          </p>
        ) : null}

        {statement ? null : (
          <Tabs
            className="mt-4"
            items={MODE_TABS.map((tab) => ({ ...tab, content: null }))}
            onValueChange={(value) => {
              setMode(modeOf(value));
            }}
            value={mode}
          />
        )}
        {!statement && mode === 'by_category' && groups.length > 0 ? (
          <div className="mt-3">
            <p className="text-caption text-muted-foreground">
              Do zapisu: {transactionCountLabel(groups.length)}
            </p>
            <ul aria-label="Transakcje do zapisu">
              {groups.map((group) => (
                <li
                  className="flex min-h-11 items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-b-0"
                  key={group.categoryKey ?? 'none'}
                >
                  <span className="min-w-0 truncate">
                    {group.categoryKey === null
                      ? 'Bez kategorii'
                      : (proposalNameOfKey(group.categoryKey) ??
                        nameOf(group.categoryKey) ??
                        'Kategoria')}
                  </span>
                  <Money amountMinor={group.amountMinor} size="sm" variant="expense" />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section
        action={
          <Button
            onClick={() => {
              setSelected(allSelected ? new Set() : new Set(document.items.map((item) => item.id)));
            }}
            size="small"
            variant="link"
          >
            {allSelected ? 'odznacz wszystkie' : 'zaznacz wszystkie'}
          </Button>
        }
        title={`${statement ? 'Operacje' : 'Pozycje'} (${String(document.items.length)})`}
      >
        <ul className="-mt-2">
          {document.items.map((item) => (
            <li key={item.id}>
              <ReviewItemRow
                categoryName={nameOf(item.suggestedCategoryId)}
                checked={selected.has(item.id)}
                item={item}
                onAcceptProposal={() => {
                  if (item.suggestedCategoryName === null) return;
                  const kind = item.direction === 'inflow' ? 'income' : 'expense';
                  setAccepted((current) => [
                    ...current,
                    { name: item.suggestedCategoryName ?? '', kind },
                  ]);
                }}
                onChangeCategory={() => {
                  setItemTarget({ item, view: 'category' });
                }}
                onCheckedChange={(checked) => {
                  setSelected((current) => {
                    const next = new Set(current);
                    if (checked) next.add(item.id);
                    else next.delete(item.id);
                    return next;
                  });
                }}
                onEdit={() => {
                  setItemTarget({ item, view: 'edit' });
                }}
                onUndoProposal={() => {
                  const name = item.suggestedCategoryName?.toLocaleLowerCase('pl-PL');
                  setAccepted((current) =>
                    current.filter((proposal) => proposal.name.toLocaleLowerCase('pl-PL') !== name),
                  );
                }}
                perItem={perItem}
                proposalAccepted={proposalAccepted(accepted, item)}
                statement={statement}
              />
            </li>
          ))}
        </ul>
        <p className="flex items-baseline justify-between gap-2 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">
            Zaznaczono {summary.selectedCount} z {summary.totalCount}
          </span>
          <Money amountMinor={summary.netMinor} variant="expense" />
        </p>
        <Button
          className="mt-4"
          loading={discard.isPending}
          onClick={() => {
            void discard.mutateAsync().then(() => navigate('/scan'));
          }}
          size="large"
          variant="ghost"
        >
          Odrzuć dokument
        </Button>
      </Section>

      <Sheet
        onOpenChange={(open) => {
          if (!open) setHeaderView(null);
        }}
        open={headerView !== null}
        title={headerView === 'merchant' ? 'Sprzedawca' : 'Dokument'}
      >
        {headerView === 'merchant' ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void patchHeader({ merchant: merchantDraft.trim() || null });
            }}
          >
            <TextField
              label="Sprzedawca"
              maxLength={120}
              onChange={setMerchantDraft}
              value={merchantDraft}
            />
            <Button loading={updateHeader.isPending} size="large" type="submit">
              Zapisz
            </Button>
          </form>
        ) : null}
        {headerView === 'date' ? (
          <DatePicker
            max={bounds.max}
            min={bounds.min}
            onBack={() => {
              setHeaderView(null);
            }}
            onSelect={(date) => {
              void patchHeader({ bookedOn: date });
            }}
            selected={bookedOn}
            today={today}
          />
        ) : null}
        {headerView === 'account' ? (
          <AccountPicker
            accounts={accounts.data ?? []}
            onBack={() => {
              setHeaderView(null);
            }}
            onManageAccounts={() => {
              void navigate('/accounts');
            }}
            onSelect={(id) => {
              void patchHeader({ accountId: id });
            }}
            selectedId={accountId}
            title="Konto"
          />
        ) : null}
        {headerView === 'category' ? (
          <CategoryPicker
            kind="expense"
            onBack={() => {
              setHeaderView(null);
            }}
            onSelect={(id) => {
              setCategoryId(id);
              setHeaderView(null);
            }}
            selectedId={categoryId}
          />
        ) : null}
      </Sheet>

      <ItemSheet
        documentId={document.id}
        onClose={() => {
          setItemTarget(null);
        }}
        target={itemTarget}
      />
    </main>
  );
}

/**
 * Ekran dokumentu — wybiera stan po statusie.
 *
 * @returns Element ekranu.
 */
export default function DocumentScreen(): ReactNode {
  const { documentId = '' } = useParams();
  const navigate = useNavigate();
  const { openNew } = useTransactionSheet();
  const query = useDocument(documentId);
  const reanalyze = useReanalyzeDocument(documentId);
  const remove = useDeleteDocument(documentId);
  const [actionError, setActionError] = useState<string | null>(null);

  const back = (
    <Button
      onClick={() => {
        void navigate('/scan');
      }}
      size="large"
      variant="ghost"
    >
      Wróć do skanu
    </Button>
  );

  if (query.isPending) {
    return (
      <main>
        <ReviewSkeleton />
      </main>
    );
  }
  if (query.isError) {
    const missing = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <main>
        {missing ? (
          <EmptyState
            action={back}
            description="Mógł zostać usunięty na innym urządzeniu."
            title="Nie ma takiego dokumentu"
          />
        ) : (
          <ErrorState
            details={errorDetails(query.error)}
            lastUpdatedAt={lastUpdatedLabel(query.dataUpdatedAt)}
            onRetry={() => {
              void query.refetch();
            }}
            retrying={query.isFetching}
            title="Nie udało się wczytać dokumentu"
          />
        )}
      </main>
    );
  }

  const document = query.data;
  const title = documentTitle(document.kind, document.summary?.merchant ?? null);
  const addManually = (): void => {
    openNew(
      'expense',
      document.summary?.totalMinor ? { amountMinor: document.summary.totalMinor } : {},
    );
  };

  if (isInFlight(document.status)) {
    return (
      <main>
        <h1 className="text-xl font-semibold">{title}</h1>
        <Section first>
          <DocumentPreview
            document={document}
            overlay={
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium shadow-sheet">
                  <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
                  Odczytuję pozycje…
                </span>
              </span>
            }
          />
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            Odczytuję pozycje… zwykle 5–15 sekund. Możesz wyjść — wynik poczeka na liście.
          </p>
          <div className="mt-4">{back}</div>
        </Section>
      </main>
    );
  }

  if (document.status === 'failed') {
    const budget = document.errorCode === 'AI_BUDGET_EXCEEDED';
    return (
      <main>
        <h1 className="text-xl font-semibold">{title}</h1>
        <Section first>
          <DocumentPreview document={document} />
          <div
            className="mt-4 flex flex-col gap-3 rounded-md border border-danger/40 bg-danger/10 p-3"
            role="alert"
          >
            <p className="text-sm">
              {document.errorMessage ?? 'Nie udało się odczytać dokumentu.'}
            </p>
          </div>
          {actionError === null ? null : (
            <p className="mt-3 text-sm text-danger" role="alert">
              {actionError}
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2">
            {budget ? null : (
              <Button
                loading={reanalyze.isPending}
                onClick={() => {
                  setActionError(null);
                  reanalyze.mutate(undefined, {
                    onError: (error) => {
                      setActionError(error.message);
                    },
                  });
                }}
                size="large"
              >
                Spróbuj ponownie
              </Button>
            )}
            <Button onClick={addManually} size="large" variant={budget ? 'primary' : 'ghost'}>
              Dodaj wydatek ręcznie
            </Button>
            <Button
              loading={remove.isPending}
              onClick={() => {
                void remove.mutateAsync().then(() => navigate('/scan'));
              }}
              size="large"
              variant="ghost"
            >
              Usuń dokument
            </Button>
          </div>
        </Section>
      </main>
    );
  }

  if (document.status === 'committed' || document.status === 'discarded') {
    const committed = document.status === 'committed';
    return (
      <main>
        <h1 className="text-xl font-semibold">{title}</h1>
        <Section first>
          <DocumentPreview document={document} />
        </Section>
        <EmptyState
          action={back}
          description={
            committed
              ? 'Transakcje z tego dokumentu są w historii z plakietką 📷.'
              : 'Nic z tego dokumentu nie trafiło do księgi.'
          }
          icon={
            committed ? (
              <CheckCircle2 aria-hidden="true" className="h-6 w-6 text-success" strokeWidth={1.5} />
            ) : (
              <ScanLine aria-hidden="true" className="h-6 w-6" strokeWidth={1.5} />
            )
          }
          title={committed ? 'Dokument zapisany' : 'Dokument odrzucony'}
        />
      </main>
    );
  }

  if (document.items.length === 0) {
    // Nieudany odczyt nie może być ślepym zaułkiem (08 §14): zdjęcie zostaje,
    // a formularz wydatku jest jedno dotknięcie dalej.
    return (
      <main>
        <h1 className="text-xl font-semibold">{title}</h1>
        <Section first>
          <DocumentPreview document={document} />
        </Section>
        <EmptyState
          action={
            <Button onClick={addManually} size="large">
              Wpisz kwotę ręcznie
            </Button>
          }
          description="Zdjęcie zostaje przy dokumencie — dotknij miniatury, żeby przepisać kwotę."
          title="Nie rozpoznano pozycji"
        />
      </main>
    );
  }

  return <DocumentReview document={document} />;
}
