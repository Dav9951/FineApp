import {
  formatMonth,
  todayInTimezone,
  type MonthSummaryDto,
  type PlannedExpenseDto,
  type RecurringOccurrenceDto,
  type TransactionType,
} from '@fineapp/shared';
import { AlertTriangle, CheckCircle2, Circle } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import {
  AmountInput,
  Button,
  ListRow,
  Money,
  Section,
  Sheet,
  useToast,
  type MoneyVariant,
} from '../../../components/ui/index.js';
import { useAuth } from '../../auth/auth-context.js';
import { usePayInstallment } from '../../liabilities/hooks/use-pay-installment.js';
import { PaySheet } from '../../planned-expenses/components/pay-sheet.js';
import {
  usePostOccurrence,
  useSkipOccurrence,
  useUnpostOccurrence,
} from '../../recurring/hooks/use-recurring.js';
import { showTodo, todoRows, type TodoRow } from '../todo-view.js';

/**
 * Sekcja „Do zrobienia w tym miesiącu" na dashboardzie
 * ([06 §3.1](../../../../../../plans/06-ui-views.md#31-dashboard-miesiąca--mmonth), `F4-7`,
 * ADR-050).
 *
 * Czekające pozycje cykliczne — w bieżącym miesiącu także zaległe z poprzedniego — i raty
 * zobowiązań bez reguły. „Zaksięguj" przy kwocie pewnej działa jednym dotknięciem
 * z „Cofnij" w toaście; przy szacunkowej otwiera arkusz z kwotą do potwierdzenia
 * (07 §6.5 — kwoty szacunkowej nie przyjmujemy bez pytania). Planowany wydatek w miesiącu
 * terminu ma „Zapłacone" — zawsze z arkuszem, bo jego kwota to szacunek (`F6-8`).
 */

/** Wariant kwoty dla rodzaju przepływu — wydatek z minusem, wpływ z plusem. */
const FLOW_MONEY: Readonly<Record<TransactionType, MoneyVariant>> = {
  expense: 'expense',
  income: 'income',
  transfer: 'neutral',
};

/**
 * Arkusz potwierdzenia kwoty szacunkowej — np. rachunek za prąd.
 *
 * Klucz idempotencji powstaje raz na otwarcie arkusza: ponowienie po zerwanym połączeniu
 * niesie ten sam, więc serwer nie zaksięguje rachunku dwa razy (ADR-037, ADR-046).
 *
 * @param props - Właściwości komponentu.
 * @param props.occurrence - Wystąpienie do zaksięgowania.
 * @param props.onDone - Zamknięcie po zapisie.
 * @returns Element formularza.
 */
function EstimateForm({
  occurrence,
  onDone,
}: {
  occurrence: RecurringOccurrenceDto;
  onDone: () => void;
}): ReactNode {
  const post = usePostOccurrence();
  const { show } = useToast();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [amountMinor, setAmountMinor] = useState(occurrence.plannedAmountMinor);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (amountMinor <= 0) {
      setError('Wpisz kwotę z rachunku');
      return;
    }
    if (occurrence.id === null) return;
    post.mutate(
      { occurrenceId: occurrence.id, body: { amountMinor }, idempotencyKey },
      {
        onSuccess: () => {
          onDone();
          show({ message: `Zaksięgowano „${occurrence.ruleName}"` });
        },
        onError: (failure) => {
          setError(failure.message);
        },
      },
    );
  };

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <p className="text-sm text-muted-foreground">
        Planowano <Money amountMinor={occurrence.plannedAmountMinor} size="sm" />. Wpisz kwotę z
        rachunku — tyle trafi do historii.
      </p>
      <AmountInput
        autoFocus
        defaultValueMinor={occurrence.plannedAmountMinor}
        error={error}
        label="Kwota z rachunku"
        onChange={(value) => {
          setAmountMinor(value);
          setError(undefined);
        }}
      />
      <Button loading={post.isPending} size="large" type="submit" variant="primary">
        Zaksięguj
      </Button>
    </form>
  );
}

/**
 * Znacznik stanu wiersza: ikona, nie sam kolor (15 §2.4).
 *
 * @param props - Właściwości komponentu.
 * @param props.overdue - Czy po terminie.
 * @returns Element ikony.
 */
function TodoIcon({ overdue }: { overdue: boolean }): ReactNode {
  return overdue ? (
    <AlertTriangle
      aria-label="po terminie"
      className="h-[17px] w-[17px] text-warning"
      strokeWidth={1.5}
    />
  ) : (
    <Circle aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={1.5} />
  );
}

/**
 * Sekcja „Do zrobienia".
 *
 * @param props - Właściwości komponentu.
 * @param props.summary - Podsumowanie miesiąca.
 * @returns Element sekcji albo nic, gdy nie ma czego pokazać.
 */
export function TodoSection({ summary }: { summary: MonthSummaryDto }): ReactNode {
  const { household } = useAuth();
  const today = todayInTimezone(household?.timezone ?? 'Europe/Warsaw');
  const { show } = useToast();
  const post = usePostOccurrence();
  const unpost = useUnpostOccurrence();
  const skip = useSkipOccurrence();
  const payment = usePayInstallment();
  const [estimate, setEstimate] = useState<RecurringOccurrenceDto | undefined>(undefined);
  const [paying, setPaying] = useState<PlannedExpenseDto | null>(null);

  const rows = todoRows(summary, today);
  if (!showTodo(summary, rows)) return null;

  const busyId = post.isPending
    ? post.variables.occurrenceId
    : skip.isPending
      ? skip.variables.occurrenceId
      : undefined;

  const postNow = (occurrence: RecurringOccurrenceDto): void => {
    if (occurrence.id === null) return;
    if (occurrence.amountIsEstimate) {
      setEstimate(occurrence);
      return;
    }
    const occurrenceId = occurrence.id;
    post.mutate(
      { occurrenceId, body: {}, idempotencyKey: crypto.randomUUID() },
      {
        onSuccess: () => {
          show({
            message: `Zaksięgowano „${occurrence.ruleName}"`,
            action: {
              label: 'Cofnij',
              onAction: () => {
                unpost.mutate(occurrenceId);
              },
            },
          });
        },
        onError: (error) => {
          show({ message: error.message });
        },
      },
    );
  };

  const skipNow = (occurrence: RecurringOccurrenceDto): void => {
    if (occurrence.id === null) return;
    skip.mutate(
      { occurrenceId: occurrence.id, monthKey: occurrence.monthKey },
      {
        onSuccess: () => {
          show({ message: `Pominięto „${occurrence.ruleName}" w tym miesiącu` });
        },
        onError: (error) => {
          show({ message: error.message });
        },
      },
    );
  };

  const title = summary.isFuture
    ? `Zaplanowane — ${formatMonth(summary.month)}`
    : summary.isCurrent
      ? 'Do zrobienia w tym miesiącu'
      : 'Do zrobienia';

  const renderActions = (row: TodoRow): ReactNode => {
    if (!row.actionable) return null;
    if (row.kind === 'planned') {
      return (
        <Button
          className="col-start-2"
          onClick={() => {
            setPaying(row.planned);
          }}
          variant="soft"
        >
          Zapłacone
        </Button>
      );
    }
    if (row.kind === 'liability') {
      return (
        // Druga kolumna: „Zaksięguj" stoi w każdym wierszu w tym samym miejscu.
        <Button
          className="col-start-2"
          loading={payment.pendingId === row.liability.id}
          onClick={() => {
            payment.pay(row.liability);
          }}
          variant="soft"
        >
          Zaksięguj
        </Button>
      );
    }
    const busy = busyId === row.occurrence.id;
    return (
      <>
        <Button
          disabled={busy}
          onClick={() => {
            skipNow(row.occurrence);
          }}
          variant="ghost"
        >
          Pomiń
        </Button>
        <Button
          loading={busy && post.isPending}
          onClick={() => {
            postNow(row.occurrence);
          }}
          variant="soft"
        >
          Zaksięguj
        </Button>
      </>
    );
  };

  return (
    <Section
      action={
        rows.length === 0 ? undefined : (
          <span className="text-sm text-muted-foreground">{rows.length}</span>
        )
      }
      title={title}
    >
      {summary.recurring.plannedTotalMinor > 0 && !summary.isFuture ? (
        <p className="mb-2 text-meta text-muted-foreground">
          zaksięgowano <Money amountMinor={summary.recurring.postedTotalMinor} size="meta" /> z
          planu <Money amountMinor={summary.recurring.plannedTotalMinor} size="meta" />
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
          Wszystko na ten miesiąc zrobione.
        </p>
      ) : (
        <ul>
          {rows.map((row, index) => (
            <li className={index === 0 ? undefined : 'border-t border-border'} key={row.key}>
              <ListRow
                amount={
                  <Money
                    amountMinor={row.amountMinor}
                    size="sm"
                    variant={
                      row.kind === 'occurrence' ? FLOW_MONEY[row.occurrence.flow] : 'expense'
                    }
                  />
                }
                caption={row.caption}
                first
                icon={<TodoIcon overdue={row.overdue} />}
                name={row.name}
                wrapCaption
              />
              {row.actionable ? (
                // Pod kolumną tekstu (ikona 32 + odstęp 12 = 44 px), pełne 44 px przycisku
                // i 12 px do linii podziału — przyciski nie kleją się do sąsiedniego wiersza.
                <div className="grid grid-cols-2 gap-2 pb-3 pl-11 pt-1">{renderActions(row)}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* Przycisk w wariancie odnośnika: cel dotykowy 44 px, nie wysokość linii tekstu. */}
      <Button asChild className="mt-1 px-0" size="small" variant="link">
        <Link to="/recurring">Wszystkie pozycje cykliczne</Link>
      </Button>

      <Sheet
        onOpenChange={(open) => {
          if (!open) setEstimate(undefined);
        }}
        open={estimate !== undefined}
        title={estimate === undefined ? 'Zaksięguj' : `Zaksięguj „${estimate.ruleName}"`}
      >
        {estimate === undefined ? null : (
          <EstimateForm
            key={estimate.id ?? ''}
            occurrence={estimate}
            onDone={() => {
              setEstimate(undefined);
            }}
          />
        )}
      </Sheet>
      <PaySheet
        item={paying}
        onClose={() => {
          setPaying(null);
        }}
      />
    </Section>
  );
}
