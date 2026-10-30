import { monthKeyOf } from '@fineapp/shared';
import { ChevronLeft } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Money,
  Section,
  Skeleton,
  SkeletonList,
} from '../../../components/ui/index.js';
import { ApiRequestError, errorDetails } from '../../../lib/api-client.js';
import { formatDateOnly } from '../../../lib/format.js';
import { ACCOUNT_TYPE_LABEL, ALLOCATION_CLASS_SHORT_LABEL } from '../accounts-view.js';
import { useAccount, useDeleteAccount, useSetAccountArchived } from '../hooks/use-accounts.js';
import { AccountFormSheet } from './account-form-sheet.js';
import { lastUpdatedLabel } from './accounts-screen.js';

/**
 * Szczegóły konta — `/accounts/:id` ([06 §3.7](../../../../../../plans/06-ui-views.md#37-konta--accounts)).
 *
 * Saldo, dane konta, edycja, archiwizacja i usunięcie. Historia transakcji konta to
 * odnośnik do ekranu historii z filtrem konta (`F2-8`, ADR-038) — ta sama lista, te same
 * gesty, bez drugiej kopii ekranu. Wykres 12 miesięcy czeka na trasę API (ADR-036, `Z-19`).
 */

/**
 * Powrót do listy kont — zawsze widoczny, bo szczegóły otwiera się z listy.
 *
 * @returns Element odnośnika.
 */
function BackToAccounts(): ReactNode {
  return (
    <Link
      className="-ml-2 inline-flex min-h-touch items-center gap-1 px-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      to="/accounts"
    >
      <ChevronLeft aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
      Konta
    </Link>
  );
}

/**
 * Ekran szczegółów konta.
 *
 * @returns Element ekranu.
 */
export default function AccountDetailScreen(): ReactNode {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const account = useAccount(id);
  const archive = useSetAccountArchived();
  const remove = useDeleteAccount();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  if (account.isPending) {
    return (
      <main aria-busy="true" aria-label="Wczytywanie konta">
        <BackToAccounts />
        <Skeleton className="mt-2 h-7 w-40" />
        <Section first>
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-2 h-4 w-32" />
        </Section>
        <Section>
          <SkeletonList caption={false} rows={4} />
        </Section>
      </main>
    );
  }

  if (account.isError) {
    const notFound = account.error instanceof ApiRequestError && account.error.status === 404;
    return (
      <main>
        <BackToAccounts />
        {notFound ? (
          <EmptyState
            action={
              <Button
                onClick={() => {
                  void navigate('/accounts');
                }}
                size="large"
                variant="primary"
              >
                Wróć do kont
              </Button>
            }
            description="Mogło zostać usunięte na innym urządzeniu."
            title="Nie ma takiego konta"
          />
        ) : (
          <ErrorState
            details={errorDetails(account.error)}
            lastUpdatedAt={lastUpdatedLabel(account.dataUpdatedAt)}
            onRetry={() => {
              void account.refetch();
            }}
            retrying={account.isFetching}
            title="Nie udało się wczytać konta"
          />
        )}
      </main>
    );
  }

  const data = account.data;
  const busy = archive.isPending || remove.isPending;

  const toggleArchived = (): void => {
    setActionError(undefined);
    archive.mutate(
      { accountId: data.id, archived: !data.isArchived },
      {
        onError: (error) => {
          setActionError(error.message);
        },
      },
    );
  };

  const deleteAccount = (): void => {
    setActionError(undefined);
    remove.mutate(data.id, {
      onSuccess: () => {
        void navigate('/accounts', { replace: true });
      },
      onError: (error) => {
        // 409: konto ma transakcje (I-10) — komunikat serwera podpowiada archiwizację.
        setActionError(error.message);
        setConfirmDelete(false);
      },
    });
  };

  return (
    <main>
      <BackToAccounts />
      <header className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="break-words text-xl font-semibold">{data.name}</h1>
        {data.isArchived ? <Badge tone="neutral">w archiwum</Badge> : null}
      </header>

      <Section
        action={
          <Button asChild size="small" variant="link">
            <Link to={`/m/${monthKeyOf(data.balanceAsOf)}/transactions?accountId=${data.id}`}>
              Historia
            </Link>
          </Button>
        }
        first
      >
        <Money amountMinor={data.balanceMinor} size="amount" />
        <p className="mt-1 text-meta text-muted-foreground">
          saldo na {formatDateOnly(data.balanceAsOf)}
        </p>
      </Section>

      <Section title="Konto">
        <div className="[&>*:first-child]:border-t-0">
          <Field label="Rodzaj" value={ACCOUNT_TYPE_LABEL[data.type]} />
          <Field
            hint="Do której puli celów liczy się przelew na to konto"
            label="Pula"
            value={ALLOCATION_CLASS_SHORT_LABEL[data.allocationClass]}
          />
          {data.institution === null ? null : <Field label="Bank" value={data.institution} />}
          <Field
            hint={`na ${formatDateOnly(data.openingBalanceOn)}`}
            label="Saldo początkowe"
            value={<Money amountMinor={data.openingBalanceMinor} size="sm" />}
          />
          <Field label="Majątek netto" value={data.includeInNetWorth ? 'wliczane' : 'pomijane'} />
        </div>
      </Section>

      <Section title="Działania">
        <div className="flex flex-col gap-2">
          <Button
            onClick={() => {
              setEditOpen(true);
            }}
            size="large"
            variant="primary"
          >
            Edytuj
          </Button>
          <Button
            disabled={busy}
            loading={archive.isPending}
            onClick={toggleArchived}
            size="large"
            variant="ghost"
          >
            {data.isArchived ? 'Przywróć z archiwum' : 'Archiwizuj'}
          </Button>
          <p className="text-caption text-muted-foreground">
            {data.isArchived
              ? 'Przywrócone konto znów pojawi się przy nowych transakcjach.'
              : 'Konto z archiwum znika z wyboru przy nowych transakcjach. Historia i salda zostają.'}
          </p>

          {confirmDelete ? (
            <div
              className="mt-2 rounded-sm border-l-[3px] border-danger bg-danger/10 p-3"
              role="group"
              aria-label="Potwierdzenie usunięcia"
            >
              <p className="text-sm">
                Usunąć konto „{data.name}”? Tego nie da się cofnąć. Konta z transakcjami nie da się
                usunąć — tylko zarchiwizować.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  className="flex-1"
                  disabled={busy}
                  loading={remove.isPending}
                  onClick={deleteAccount}
                  variant="danger"
                >
                  Usuń na zawsze
                </Button>
                <Button
                  className="flex-1"
                  disabled={busy}
                  onClick={() => {
                    setConfirmDelete(false);
                  }}
                  variant="ghost"
                >
                  Anuluj
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="text-danger"
              disabled={busy}
              onClick={() => {
                setActionError(undefined);
                setConfirmDelete(true);
              }}
              size="large"
              variant="link"
            >
              Usuń konto
            </Button>
          )}

          {actionError === undefined ? null : (
            <p className="text-sm text-danger" role="alert">
              {actionError}
            </p>
          )}
        </div>
      </Section>

      <AccountFormSheet account={data} onOpenChange={setEditOpen} open={editOpen} />
    </main>
  );
}
