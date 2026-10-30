import { todayInTimezone, type LiabilityDto } from '@fineapp/shared';
import { AlertTriangle, Check, CreditCard, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  Money,
  ProgressBar,
  Section,
  Skeleton,
} from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useAuth } from '../../auth/auth-context.js';
import { useLiabilities } from '../hooks/use-liabilities.js';
import { usePayInstallment, type PayInstallment } from '../hooks/use-pay-installment.js';
import {
  canPayNow,
  finalPaymentLabel,
  installmentsLabel,
  installmentStatus,
  LIABILITY_KIND_ICON,
  liabilityTotals,
  type InstallmentStatus,
} from '../liabilities-view.js';
import { LiabilityFormSheet } from './liability-form-sheet.js';

/**
 * Ekran zobowiązań — `/liabilities`
 * ([06 §3.8](../../../../../../plans/06-ui-views.md#38-zobowiązania--liabilities), `F4-6`).
 *
 * „Razem do spłaty" i „Miesięcznie" na górze, niżej karta na zobowiązanie: ile zostało,
 * pasek spłaty w kolorze długu, rata, liczba rat i ostatnia rata, a pod spodem stan raty
 * w tym miesiącu z „Zaksięguj" jednym dotknięciem. Zamknięte — skromnie, na dole.
 */

/**
 * Szkielet ekranu.
 *
 * @returns Element szkieletu.
 */
function LiabilitiesSkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Wczytywanie zobowiązań">
      <Section first title="Razem do spłaty">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-2 h-4 w-32" />
      </Section>
      <Section>
        <Skeleton className="h-36 w-full" />
        <Skeleton className="mt-3 h-36 w-full" />
      </Section>
    </div>
  );
}

/**
 * Linia stanu raty z ikoną — stan niesie ikona i tekst, nie sam kolor (15 §2.4).
 *
 * @param props - Właściwości komponentu.
 * @param props.status - Stan raty.
 * @returns Element linii.
 */
function StatusLine({ status }: { status: InstallmentStatus }): ReactNode {
  if (status.kind === 'paid' || status.kind === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-success">
        <Check aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
        {status.label}
      </span>
    );
  }
  if (status.kind === 'overdue') {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-warning">
        <AlertTriangle aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
        {status.label}
      </span>
    );
  }
  return <span className="text-sm text-muted-foreground">{status.label}</span>;
}

/**
 * Karta aktywnego zobowiązania.
 *
 * Nazwa jest odnośnikiem do szczegółów, a „Zaksięguj" osobnym przyciskiem obok — nie
 * zagnieżdżamy kontrolki w kontrolce.
 *
 * @param props - Właściwości komponentu.
 * @param props.liability - Zobowiązanie.
 * @param props.today - Dzisiejsza data.
 * @param props.payment - Księgowanie raty.
 * @returns Element karty.
 */
function LiabilityCard({
  liability,
  today,
  payment,
}: {
  liability: LiabilityDto;
  today: string;
  payment: PayInstallment;
}): ReactNode {
  const Icon = LIABILITY_KIND_ICON[liability.kind];
  const status = installmentStatus(liability, today);
  const final = finalPaymentLabel(liability.projectedFinalPaymentOn);
  const percent = (liability.progressBps / 100).toLocaleString('pl-PL', {
    maximumFractionDigits: 1,
  });
  return (
    <Card className="flex flex-col gap-2">
      <Link
        className="-m-1 flex min-h-touch items-center gap-2 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        to={`/liabilities/${liability.id}`}
      >
        <Icon
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
        />
        <span className="min-w-0 truncate text-base font-medium">
          {liability.name}
          {liability.creditor === null ? null : (
            <span className="text-muted-foreground"> · {liability.creditor}</span>
          )}
        </span>
      </Link>
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">Zostało</span>
        <Money amountMinor={liability.remainingMinor} size="lg" variant="debt" />
      </p>
      <div>
        <ProgressBar pool="debt" valueBps={liability.progressBps} />
        {/* Nie `note` paska — ten jest na ostrzeżenia o tempie i ma ich kolor. */}
        <p className="mt-1 text-caption text-muted-foreground">{percent}% spłacone</p>
      </div>
      <p className="text-meta text-muted-foreground">
        Rata <Money amountMinor={liability.monthlyPaymentMinor} size="meta" unit={false} />
        {liability.installmentsRemaining > 0
          ? ` · ${installmentsLabel(liability.installmentsRemaining)}`
          : null}
        {final === null ? null : ` · ${final}`}
      </p>
      <div className="flex min-h-touch items-center justify-between gap-2 border-t border-border pt-2">
        <StatusLine status={status} />
        {canPayNow(status) ? (
          <Button
            loading={payment.pendingId === liability.id}
            onClick={() => {
              payment.pay(liability);
            }}
            size="small"
            variant="soft"
          >
            Zaksięguj
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Ekran zobowiązań.
 *
 * @returns Element ekranu.
 */
export default function LiabilitiesScreen(): ReactNode {
  const { household } = useAuth();
  const today = todayInTimezone(household?.timezone ?? 'Europe/Warsaw');
  const liabilities = useLiabilities();
  const payment = usePayInstallment();
  const [formOpen, setFormOpen] = useState(false);

  const openForm = (): void => {
    setFormOpen(true);
  };

  let content: ReactNode;
  if (liabilities.isPending) {
    content = <LiabilitiesSkeleton />;
  } else if (liabilities.isError) {
    content = (
      <ErrorState
        details={errorDetails(liabilities.error)}
        lastUpdatedAt={lastUpdatedLabel(liabilities.dataUpdatedAt)}
        onRetry={() => {
          void liabilities.refetch();
        }}
        retrying={liabilities.isFetching}
        title="Nie udało się wczytać zobowiązań"
      />
    );
  } else if (liabilities.data.length === 0) {
    content = (
      <EmptyState
        action={
          <Button onClick={openForm} size="large" variant="primary">
            Dodaj zobowiązanie
          </Button>
        }
        description="Kredyt, raty za telefon, karta kredytowa — wpisz, ile zostało i jaka jest rata. Aplikacja policzy, kiedy skończysz spłacać."
        icon={<CreditCard aria-hidden="true" className="h-7 w-7" strokeWidth={1.5} />}
        title="Nie masz zobowiązań"
      />
    );
  } else {
    const totals = liabilityTotals(liabilities.data);
    const active = liabilities.data.filter((item) => item.isActive);
    const closed = liabilities.data.filter((item) => !item.isActive);
    content = (
      <>
        <Section first title="Razem do spłaty">
          <Money amountMinor={totals.remainingMinor} size="amount" variant="debt" />
          <p className="mt-1 text-meta text-muted-foreground">
            miesięcznie <Money amountMinor={totals.monthlyMinor} size="meta" />
          </p>
        </Section>

        {active.length === 0 ? null : (
          <Section title="Spłacane">
            <ul className="flex flex-col gap-3">
              {active.map((liability) => (
                <li key={liability.id}>
                  <LiabilityCard liability={liability} payment={payment} today={today} />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {closed.length === 0 ? null : (
          <Section title="Zamknięte">
            <ul>
              {closed.map((liability, index) => {
                const Icon = LIABILITY_KIND_ICON[liability.kind];
                return (
                  <li key={liability.id}>
                    <Link to={`/liabilities/${liability.id}`}>
                      <ListRow
                        amount={<Money amountMinor={liability.remainingMinor} size="sm" />}
                        caption={liability.creditor ?? undefined}
                        first={index === 0}
                        icon={
                          <Icon
                            aria-hidden="true"
                            className="h-[17px] w-[17px]"
                            strokeWidth={1.5}
                          />
                        }
                        name={liability.name}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
      </>
    );
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Zobowiązania</h1>
        <IconButton label="Dodaj zobowiązanie" onClick={openForm}>
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </IconButton>
      </header>
      {content}
      <LiabilityFormSheet onOpenChange={setFormOpen} open={formOpen} />
    </main>
  );
}
