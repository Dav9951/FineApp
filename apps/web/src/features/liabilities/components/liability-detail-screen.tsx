import {
  parseAmountToMinor,
  RebaseLiabilityRequestSchema,
  todayInTimezone,
  type LiabilityDetailDto,
} from '@fineapp/shared';
import { ChevronLeft } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  ListRow,
  Money,
  ProgressBar,
  Section,
  Sheet,
  Skeleton,
  SkeletonList,
  TextField,
} from '../../../components/ui/index.js';
import { ApiRequestError, errorDetails } from '../../../lib/api-client.js';
import { formatDateOnly, formatDateShort } from '../../../lib/format.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useAuth } from '../../auth/auth-context.js';
import {
  useDeleteLiability,
  useLiability,
  useLiabilitySchedule,
  useRebaseLiability,
  useUpdateLiability,
} from '../hooks/use-liabilities.js';
import { usePayInstallment } from '../hooks/use-pay-installment.js';
import {
  canPayNow,
  installmentsLabel,
  installmentStatus,
  LIABILITY_KIND_LABEL,
} from '../liabilities-view.js';
import { LiabilityFormSheet } from './liability-form-sheet.js';

/**
 * Szczegóły zobowiązania — `/liabilities/:id`
 * ([06 §3.8](../../../../../../plans/06-ui-views.md#38-zobowiązania--liabilities), `F4-6`).
 *
 * Stan, warunki, zaksięgowane raty, prognozowany harmonogram i działania: edycja, korekta
 * z wyciągu (07 §5.2), zamknięcie i usunięcie.
 */

/** Ile rat harmonogramu pokazać od razu — dalsze streszcza jedna linia. */
const SCHEDULE_PREVIEW = 6;

/**
 * Powrót do listy zobowiązań.
 *
 * @returns Element odnośnika.
 */
function BackToLiabilities(): ReactNode {
  return (
    <Link
      className="-ml-2 inline-flex min-h-touch items-center gap-1 px-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      to="/liabilities"
    >
      <ChevronLeft aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
      Zobowiązania
    </Link>
  );
}

/**
 * Formularz korekty z wyciągu — nowy punkt odniesienia bez ruszania historii (07 §5.2).
 *
 * @param props - Właściwości komponentu.
 * @param props.liability - Zobowiązanie.
 * @param props.today - Dzisiejsza data.
 * @param props.onDone - Zakończenie po zapisie.
 * @returns Element formularza.
 */
function RebaseForm({
  liability,
  today,
  onDone,
}: {
  liability: LiabilityDetailDto;
  today: string;
  onDone: () => void;
}): ReactNode {
  const rebase = useRebaseLiability();
  const [amountText, setAmountText] = useState('');
  const [asOf, setAsOf] = useState(today);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    const remainingMinor = parseAmountToMinor(amountText.trim());
    if (remainingMinor === null || remainingMinor < 0) {
      setErrors({ remainingMinor: 'Wpisz kwotę z wyciągu, np. 298 400,00' });
      return;
    }
    const parsed = RebaseLiabilityRequestSchema.safeParse({ remainingMinor, asOf, note });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    rebase.mutate(
      { liabilityId: liability.id, body: { remainingMinor, asOf, note } },
      {
        onSuccess: onDone,
        onError: (error) => {
          setFormError(error.message);
          if (error instanceof ApiRequestError) setErrors(error.fieldErrors());
        },
      },
    );
  };

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <p className="text-sm text-muted-foreground">
        Bank dolicza odsetki, więc po czasie „pozostało" w aplikacji rozjeżdża się z wyciągiem.
        Wpisz kwotę z wyciągu — historia rat zostaje bez zmian.
      </p>
      <TextField
        autoFocus
        error={errors.remainingMinor}
        inputMode="decimal"
        label="Pozostało według wyciągu (zł)"
        onChange={(value) => {
          setAmountText(value);
          setErrors({});
        }}
        value={amountText}
      />
      <TextField error={errors.asOf} label="Na dzień" onChange={setAsOf} type="date" value={asOf} />
      <TextField
        error={errors.note}
        label="Notatka"
        maxLength={200}
        onChange={setNote}
        placeholder="np. wyciąg za sierpień"
        value={note}
      />
      {formError === undefined ? null : (
        <p className="text-sm text-danger" role="alert">
          {formError}
        </p>
      )}
      <Button loading={rebase.isPending} size="large" type="submit" variant="primary">
        Zapisz stan
      </Button>
    </form>
  );
}

/**
 * Ekran szczegółów zobowiązania.
 *
 * @returns Element ekranu.
 */
export default function LiabilityDetailScreen(): ReactNode {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { household } = useAuth();
  const today = todayInTimezone(household?.timezone ?? 'Europe/Warsaw');
  const liability = useLiability(id);
  const schedule = useLiabilitySchedule(id);
  const payment = usePayInstallment();
  const update = useUpdateLiability();
  const remove = useDeleteLiability();
  const [editOpen, setEditOpen] = useState(false);
  const [rebaseOpen, setRebaseOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  if (liability.isPending) {
    return (
      <main aria-busy="true" aria-label="Wczytywanie zobowiązania">
        <BackToLiabilities />
        <Skeleton className="mt-2 h-7 w-48" />
        <Section first>
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-3 h-2 w-full" />
        </Section>
        <Section>
          <SkeletonList caption={false} rows={5} />
        </Section>
      </main>
    );
  }

  if (liability.isError) {
    const notFound = liability.error instanceof ApiRequestError && liability.error.status === 404;
    return (
      <main>
        <BackToLiabilities />
        {notFound ? (
          <EmptyState
            action={
              <Button
                onClick={() => {
                  void navigate('/liabilities');
                }}
                size="large"
                variant="primary"
              >
                Wróć do zobowiązań
              </Button>
            }
            description="Mogło zostać usunięte na innym urządzeniu."
            title="Nie ma takiego zobowiązania"
          />
        ) : (
          <ErrorState
            details={errorDetails(liability.error)}
            lastUpdatedAt={lastUpdatedLabel(liability.dataUpdatedAt)}
            onRetry={() => {
              void liability.refetch();
            }}
            retrying={liability.isFetching}
            title="Nie udało się wczytać zobowiązania"
          />
        )}
      </main>
    );
  }

  const data = liability.data;
  const status = installmentStatus(data, today);
  const percent = (data.progressBps / 100).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
  const busy = update.isPending || remove.isPending;
  const rows = schedule.data ?? [];
  const shown = rows.slice(0, SCHEDULE_PREVIEW);
  const rest = rows.length - shown.length;

  const setActive = (isActive: boolean): void => {
    setActionError(undefined);
    update.mutate(
      { liabilityId: data.id, body: { isActive } },
      {
        onError: (error) => {
          setActionError(error.message);
        },
      },
    );
  };

  return (
    <main>
      <BackToLiabilities />
      <header className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="break-words text-xl font-semibold">{data.name}</h1>
        {data.isActive ? null : <Badge tone="neutral">zamknięte</Badge>}
      </header>

      <Section first>
        <p className="text-meta text-muted-foreground">Zostało do spłaty</p>
        <Money amountMinor={data.remainingMinor} size="amount" variant="debt" />
        <div className="mt-3">
          <ProgressBar pool="debt" valueBps={data.progressBps} />
          <p className="mt-1 text-caption text-muted-foreground">
            {percent}% spłacone · spłacono{' '}
            <Money amountMinor={data.paidSoFarMinor} size="meta" unit={false} /> od{' '}
            {formatDateOnly(data.balanceAsOf)}
          </p>
        </div>
        <div className="mt-3 flex min-h-touch items-center justify-between gap-2">
          <span className="text-sm">{status.label}</span>
          {canPayNow(status) ? (
            <Button
              loading={payment.pendingId === data.id}
              onClick={() => {
                payment.pay(data);
              }}
              size="small"
              variant="soft"
            >
              Zaksięguj ratę
            </Button>
          ) : null}
        </div>
      </Section>

      <Section title="Warunki">
        <div className="[&>*:first-child]:border-t-0">
          <Field label="Rodzaj" value={LIABILITY_KIND_LABEL[data.kind]} />
          {data.creditor === null ? null : <Field label="Wierzyciel" value={data.creditor} />}
          <Field label="Rata" value={<Money amountMinor={data.monthlyPaymentMinor} size="sm" />} />
          <Field
            label="Pozostało rat"
            value={
              data.installmentsRemaining === 0 ? '—' : installmentsLabel(data.installmentsRemaining)
            }
          />
          {data.projectedFinalPaymentOn === null ? null : (
            <Field label="Ostatnia rata" value={formatDateOnly(data.projectedFinalPaymentOn)} />
          )}
          <Field
            label="Dzień płatności"
            value={data.paymentDay === null ? 'nieznany' : `${String(data.paymentDay)}. dnia`}
          />
          <Field
            hint={`stan na ${formatDateOnly(data.balanceAsOf)}`}
            label="Punkt odniesienia"
            value={<Money amountMinor={data.openingBalanceMinor} size="sm" />}
          />
          {data.recurringRuleId === null ? null : (
            <Field
              label="Pozycja cykliczna"
              onOpen={() => {
                void navigate(`/recurring/${data.recurringRuleId ?? ''}`);
              }}
              value="rata co miesiąc"
            />
          )}
        </div>
      </Section>

      <Section title="Zaksięgowane raty">
        {data.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nie ma jeszcze rat. Zaksięgowana rata zmniejsza „Zostało do spłaty".
          </p>
        ) : (
          <ul>
            {data.payments.map((payment, index) => (
              <li key={payment.id}>
                <ListRow
                  amount={<Money amountMinor={payment.amountMinor} size="sm" variant="expense" />}
                  caption={payment.accountName ?? undefined}
                  first={index === 0}
                  name={formatDateShort(payment.bookedOn)}
                  onClick={() => {
                    void navigate(`/t/${payment.id}`);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {shown.length === 0 ? null : (
        <Section title="Harmonogram">
          <ul>
            {shown.map((item, index) => (
              <li key={item.number}>
                <ListRow
                  amount={<Money amountMinor={item.amountMinor} size="sm" />}
                  caption={
                    <span>
                      zostanie{' '}
                      <Money amountMinor={item.remainingAfterMinor} size="meta" unit={false} />
                    </span>
                  }
                  first={index === 0}
                  name={formatDateOnly(item.dueOn)}
                />
              </li>
            ))}
          </ul>
          {rest > 0 ? (
            <p className="mt-2 text-caption text-muted-foreground">
              i {installmentsLabel(rest)} dalej. Prognoza bez odsetek — rata w całości zmniejsza
              pozostałą kwotę.
            </p>
          ) : null}
        </Section>
      )}

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
            onClick={() => {
              setRebaseOpen(true);
            }}
            size="large"
            variant="ghost"
          >
            Zaktualizuj stan z wyciągu
          </Button>
          <Button
            disabled={busy}
            loading={update.isPending}
            onClick={() => {
              setActive(!data.isActive);
            }}
            size="large"
            variant="ghost"
          >
            {data.isActive ? 'Zamknij — spłacone' : 'Otwórz ponownie'}
          </Button>
          <p className="text-caption text-muted-foreground">
            {data.isActive
              ? 'Zamknięcie wstrzymuje pozycję cykliczną raty. Historia zostaje.'
              : 'Pozycji cyklicznej raty nie wznawiamy — zrób to na ekranie pozycji cyklicznych.'}
          </p>

          {confirmDelete ? (
            <div
              aria-label="Potwierdzenie usunięcia"
              className="mt-2 rounded-sm border-l-[3px] border-danger bg-danger/10 p-3"
              role="group"
            >
              <p className="text-sm">
                Usunąć „{data.name}”? Zaksięgowane raty zostaną w historii jako zwykłe wydatki, a
                pozycja cykliczna raty zostanie wstrzymana.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  className="flex-1"
                  disabled={busy}
                  loading={remove.isPending}
                  onClick={() => {
                    setActionError(undefined);
                    remove.mutate(data.id, {
                      onSuccess: () => {
                        void navigate('/liabilities', { replace: true });
                      },
                      onError: (error) => {
                        setConfirmDelete(false);
                        setActionError(error.message);
                      },
                    });
                  }}
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
              Usuń zobowiązanie
            </Button>
          )}

          {actionError === undefined ? null : (
            <p className="text-sm text-danger" role="alert">
              {actionError}
            </p>
          )}
        </div>
      </Section>

      <LiabilityFormSheet liability={data} onOpenChange={setEditOpen} open={editOpen} />
      <Sheet onOpenChange={setRebaseOpen} open={rebaseOpen} title="Stan z wyciągu">
        {rebaseOpen ? (
          <RebaseForm
            liability={data}
            onDone={() => {
              setRebaseOpen(false);
            }}
            today={today}
          />
        ) : null}
      </Sheet>
    </main>
  );
}
