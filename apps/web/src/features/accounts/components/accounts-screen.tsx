import type { AccountBalanceDto, AccountDto } from '@fineapp/shared';
import { Landmark, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  Money,
  Section,
  Skeleton,
  SkeletonList,
} from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import {
  ACCOUNT_TYPE_ICON,
  ACCOUNT_TYPE_LABEL,
  ALLOCATION_CLASS_MONEY,
  archivedOutsideBalances,
  assetsMinor,
  groupBalances,
} from '../accounts-view.js';
import { useAccountBalances, useAccountList } from '../hooks/use-accounts.js';
import { AccountFormSheet } from './account-form-sheet.js';

/**
 * Ekran kont — `/accounts` ([06 §3.7](../../../../../../plans/06-ui-views.md#37-konta--accounts)).
 *
 * Majątek netto na górze, pod nim konta pogrupowane po **puli**, nie po rodzaju. Cztery
 * stany (15 §2.8): szkielet w kształcie docelowej treści, pusto z jedną akcją, błąd bez
 * starych kwot, treść.
 */

/**
 * Godzina ostatniej udanej aktualizacji — do stanu błędu.
 *
 * @param updatedAt - Znacznik z zapytania; `0`, gdy nigdy się nie udało.
 * @returns Godzina `HH:MM` albo `undefined`.
 */
export function lastUpdatedLabel(updatedAt: number): string | undefined {
  if (updatedAt === 0) return undefined;
  return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(updatedAt);
}

/**
 * Szkielet ekranu — ten sam układ co treść, żeby po wczytaniu nic nie przeskoczyło.
 *
 * @returns Element szkieletu.
 */
function AccountsSkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Wczytywanie kont">
      <Section first title="Majątek netto">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-2 h-4 w-56" />
      </Section>
      <Section title="Na bieżące wydatki">
        <SkeletonList rows={2} />
      </Section>
      <Section title="Oszczędności">
        <SkeletonList rows={2} />
      </Section>
    </div>
  );
}

/**
 * Podpis wiersza konta: instytucja, ruch w tym miesiącu, archiwum.
 *
 * Ruch w miesiącu to kontekst salda (06 §1.4 — „liczba zawsze z kontekstem"). Zerowy
 * jest pomijany: „w tym miesiącu 0,00 zł" przy każdym uśpionym koncie to szum.
 *
 * @param props - Właściwości komponentu.
 * @param props.balance - Saldo konta.
 * @param props.institution - Nazwa banku albo `null`.
 * @returns Element podpisu.
 */
function AccountCaption({
  balance,
  institution,
}: {
  balance: AccountBalanceDto;
  institution: string | null;
}): ReactNode {
  const change = balance.changeInMonthMinor;
  const parts: ReactNode[] = [];
  if (balance.isArchived)
    parts.push(
      <Badge key="archived" tone="neutral">
        w archiwum
      </Badge>,
    );
  if (institution) parts.push(<span key="institution">{institution}</span>);
  if (change !== 0) {
    parts.push(
      <span key="change">
        w tym miesiącu{' '}
        <Money
          amountMinor={Math.abs(change)}
          size="meta"
          variant={change > 0 ? 'income' : 'expense'}
        />
      </span>,
    );
  }
  if (parts.length === 0) parts.push(<span key="type">{ACCOUNT_TYPE_LABEL[balance.type]}</span>);

  return (
    <span className="inline-flex items-center gap-1">
      {parts.map((part, index) => (
        <span className="inline-flex items-center gap-1" key={index}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {part}
        </span>
      ))}
    </span>
  );
}

/**
 * Ikona rodzaju konta w wierszu listy.
 *
 * @param props - Właściwości komponentu.
 * @param props.type - Rodzaj konta.
 * @returns Element ikony.
 */
function TypeIcon({ type }: { type: AccountDto['type'] }): ReactNode {
  const Icon = ACCOUNT_TYPE_ICON[type];
  return <Icon aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={1.5} />;
}

/**
 * Ekran kont.
 *
 * @returns Element ekranu.
 */
export default function AccountsScreen(): ReactNode {
  const navigate = useNavigate();
  const balances = useAccountBalances();
  // Lista z archiwum: instytucje do podpisów i konta z archiwum z zerowym saldem.
  const list = useAccountList(true);
  const [formOpen, setFormOpen] = useState(false);

  const openForm = (): void => {
    setFormOpen(true);
  };
  const openAccount = (accountId: string): void => {
    void navigate(`/accounts/${accountId}`);
  };

  let content: ReactNode;
  if (balances.isPending || list.isPending) {
    content = <AccountsSkeleton />;
  } else if (balances.isError || list.isError) {
    const failed = balances.isError ? balances : list;
    content = (
      <ErrorState
        details={errorDetails(failed.error)}
        lastUpdatedAt={lastUpdatedLabel(balances.dataUpdatedAt)}
        onRetry={() => {
          void balances.refetch();
          void list.refetch();
        }}
        retrying={balances.isFetching || list.isFetching}
        title="Nie udało się wczytać kont"
      />
    );
  } else {
    const { accounts, meta } = balances.data;
    const institutions = new Map(list.data.map((account) => [account.id, account.institution]));
    const groups = groupBalances(accounts, meta);
    const archivedOnly = archivedOutsideBalances(list.data, accounts);

    content = (
      <>
        {groups.length === 0 ? (
          <EmptyState
            action={
              <Button onClick={openForm} size="large" variant="primary">
                Dodaj konto
              </Button>
            }
            description="Konto to miejsce, w którym leżą pieniądze: rachunek, gotówka, lokata. Bez niego nie da się niczego zaksięgować."
            icon={<Landmark aria-hidden="true" className="h-7 w-7" strokeWidth={1.5} />}
            title="Nie masz jeszcze kont"
          />
        ) : (
          <>
            <Section first title="Majątek netto">
              <Money amountMinor={meta.netWorthMinor} size="amount" />
              <p className="mt-1 text-meta text-muted-foreground">
                aktywa <Money amountMinor={assetsMinor(meta)} size="meta" unit={false} />
                {' − zobowiązania '}
                <Money amountMinor={meta.liabilitiesRemainingMinor} size="meta" unit={false} />
              </p>
            </Section>

            {groups.map((group) => (
              <Section
                action={
                  <Money
                    amountMinor={group.totalMinor}
                    size="sm"
                    variant={ALLOCATION_CLASS_MONEY[group.allocationClass]}
                  />
                }
                key={group.allocationClass}
                title={group.label}
              >
                <ul>
                  {group.accounts.map((balance, index) => (
                    <li key={balance.accountId}>
                      <ListRow
                        amount={<Money amountMinor={balance.balanceMinor} />}
                        caption={
                          <AccountCaption
                            balance={balance}
                            institution={institutions.get(balance.accountId) ?? null}
                          />
                        }
                        first={index === 0}
                        icon={<TypeIcon type={balance.type} />}
                        name={balance.name}
                        onClick={() => {
                          openAccount(balance.accountId);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </Section>
            ))}
          </>
        )}

        {archivedOnly.length > 0 ? (
          <Section title="Archiwum">
            <ul>
              {archivedOnly.map((account, index) => (
                <li key={account.id}>
                  <ListRow
                    caption={account.institution ?? ACCOUNT_TYPE_LABEL[account.type]}
                    first={index === 0}
                    icon={<TypeIcon type={account.type} />}
                    name={account.name}
                    onClick={() => {
                      openAccount(account.id);
                    }}
                  />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </>
    );
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Konta</h1>
        <IconButton label="Dodaj konto" onClick={openForm}>
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </IconButton>
      </header>
      {content}
      {/* Po zapisie zostajemy na liście: nowe konto od razu widać w jego grupie, a przejście
          do szczegółów w chwili zamykania arkusza ścigałoby się z jego obsługą „wstecz". */}
      <AccountFormSheet onOpenChange={setFormOpen} open={formOpen} />
    </main>
  );
}
