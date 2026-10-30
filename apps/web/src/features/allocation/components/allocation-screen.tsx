import {
  formatMonth,
  monthKeyOf,
  shiftMonth,
  todayInTimezone,
  type AllocationStatusDto,
  type MonthKey,
} from '@fineapp/shared';
import { AlertTriangle, Check, PieChart } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { TrendChart } from '../../../components/charts/trend-chart.js';
import {
  Button,
  ErrorState,
  Money,
  OptionGrid,
  ProgressBar,
  Section,
  Skeleton,
  useToast,
} from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { cn } from '../../../lib/cn.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { useAuth } from '../../auth/auth-context.js';
import { percentOneDecimal } from '../../goals/goals-view.js';
import { useTransactionSheet } from '../../transactions/components/transaction-sheet.js';
import {
  ALLOCATION_KIND_LABEL,
  ALLOCATION_POOL,
  lineVerdict,
  SHARE_STEP_BPS,
  sharesChanged,
  sharesFrom,
  sharesPreview,
  topUpPreset,
  percentTick,
  trendChartPoints,
  trendPoints,
  withdrawalNotice,
  type AllocationShares,
} from '../allocation-view.js';
import {
  useAllocationStatus,
  useAllocationTrend,
  usePutAllocationTarget,
} from '../hooks/use-allocation.js';

/**
 * Ekran rozkładu docelowego — `/allocation`
 * ([06 §3.6](../../../../../../plans/06-ui-views.md#36-rozkład-docelowy--allocation), `F5-7`).
 *
 * Trzy części: **założenia** (suwaki procentu z kwotą z bieżących wpływów i wierszem
 * „Na życie zostaje"), **wykonanie** bieżącego miesiąca netto z „Przelej teraz" i **trend**
 * sześciu miesięcy. Zapis rozkładu jest wersjonowany od miesiąca — poprzednie miesiące
 * zachowują swój plan (wymaganie #8, ADR-053).
 */

/** Pola udziałów w kolejności suwaków. */
const SHARE_FIELDS = [
  { key: 'savingsPercentBps', kind: 'savings' },
  { key: 'investmentPercentBps', kind: 'investment' },
  { key: 'debtPercentBps', kind: 'debt_repayment' },
] as const;

/** Klasa tonu oceny. */
const TONE_CLASS = {
  success: 'text-success',
  warning: 'text-warning',
  muted: 'text-muted-foreground',
} as const;

/**
 * Szkielet ekranu.
 *
 * @returns Element szkieletu.
 */
function AllocationSkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Wczytywanie rozkładu">
      <Section first title="Założenia">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mt-3 h-10 w-full" />
        <Skeleton className="mt-3 h-10 w-full" />
      </Section>
      <Section title="Wykonanie">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="mt-3 h-12 w-full" />
      </Section>
    </div>
  );
}

/**
 * Założenia: suwaki, kwoty, suma, „Na życie zostaje", zapis od miesiąca.
 *
 * @param props - Właściwości komponentu.
 * @param props.status - Stan bieżącego miesiąca (plan i podstawa).
 * @param props.month - Bieżący miesiąc.
 * @returns Element sekcji.
 */
function TargetsSection({
  status,
  month,
}: {
  status: AllocationStatusDto;
  month: MonthKey;
}): ReactNode {
  const saved = sharesFrom(status);
  const [shares, setShares] = useState<AllocationShares>(saved);
  const [from, setFrom] = useState<MonthKey>(month);
  const put = usePutAllocationTarget();
  const { show } = useToast();
  const preview = sharesPreview(shares, status.incomeBaseMinor);
  const amounts = {
    savingsPercentBps: preview.savingsMinor,
    investmentPercentBps: preview.investmentMinor,
    debtPercentBps: preview.debtMinor,
  };
  const next = shiftMonth(month, 1);

  const save = (): void => {
    put.mutate(
      { effectiveFromMonth: from, ...shares },
      {
        onSuccess: ({ meta }) => {
          show({
            message:
              meta.warning === 'ALLOCATION_EXCEEDS_INCOME'
                ? 'Zapisano — plan przekracza wpływy'
                : `Zapisano rozkład od ${formatMonth(from)}`,
          });
        },
        onError: (error) => {
          show({ message: error.message });
        },
      },
    );
  };

  return (
    <Section
      action={
        <span className="text-caption text-muted-foreground">
          {status.effectiveFromMonth === null
            ? 'nie ustawiono'
            : `obowiązują od: ${formatMonth(status.effectiveFromMonth)}`}
        </span>
      }
      first
      title="Założenia"
    >
      <ul className="flex flex-col gap-3">
        {SHARE_FIELDS.map(({ key, kind }) => (
          <li className="flex flex-col gap-1" key={key}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <label htmlFor={`share-${key}`}>{ALLOCATION_KIND_LABEL[kind]}</label>
              <span className="flex items-baseline gap-2">
                <span className="font-numeric font-semibold tabular-nums">
                  {percentOneDecimal(shares[key])}
                </span>
                <Money amountMinor={amounts[key]} size="sm" variant="compact" />
              </span>
            </div>
            <input
              className="h-touch w-full accent-primary"
              aria-label={ALLOCATION_KIND_LABEL[kind]}
              aria-valuetext={percentOneDecimal(shares[key])}
              id={`share-${key}`}
              max={10_000}
              min={0}
              onChange={(event) => {
                setShares((current) => ({ ...current, [key]: Number(event.target.value) }));
              }}
              step={SHARE_STEP_BPS}
              type="range"
              value={shares[key]}
            />
          </li>
        ))}
      </ul>
      <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm">
        <div className="flex justify-between gap-2">
          <dt>Razem</dt>
          <dd className="flex gap-2">
            <span className="font-numeric tabular-nums">{percentOneDecimal(preview.totalBps)}</span>
            <Money amountMinor={preview.totalMinor} size="sm" variant="compact" />
          </dd>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground">
          <dt>Na życie zostaje</dt>
          <dd className="flex gap-2">
            <span className="font-numeric tabular-nums">
              {percentOneDecimal(preview.remainingBps)}
            </span>
            <Money amountMinor={preview.remainingMinor} size="sm" variant="compact" />
          </dd>
        </div>
      </dl>
      <p className="mt-1 text-caption text-muted-foreground">
        Kwoty z wpływów {formatMonth(month)}:{' '}
        <Money amountMinor={status.incomeBaseMinor} size="meta" />
        {status.isPartialMonth ? ' — miesiąc trwa, mogą jeszcze urosnąć' : ''}
      </p>
      {preview.remainingBps < 0 ? (
        <p className="mt-2 flex items-start gap-1 text-sm text-warning" role="note">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
          Plan przekracza wpływy — zapiszesz go, ale na życie nie zostanie nic.
        </p>
      ) : null}

      <OptionGrid
        className="mt-3"
        legend="Obowiązuje od"
        onChange={setFrom}
        options={[
          { value: month, label: formatMonth(month) },
          { value: next, label: formatMonth(next) },
        ]}
        value={from}
      />
      <Button
        className="mt-3"
        disabled={!sharesChanged(shares, saved) && status.effectiveFromMonth !== null}
        loading={put.isPending}
        onClick={save}
        size="large"
        variant="primary"
      >
        Zapisz
      </Button>
    </Section>
  );
}

/**
 * Wykonanie miesiąca: linie z paskami, niedobór z „Przelej teraz".
 *
 * @param props - Właściwości komponentu.
 * @param props.status - Stan miesiąca.
 * @returns Element sekcji.
 */
function ExecutionSection({ status }: { status: AllocationStatusDto }): ReactNode {
  const { openNew } = useTransactionSheet();
  const accounts = useAccountList(false);
  const notice = withdrawalNotice(status.lines);
  const baseZero = status.incomeBaseMinor === 0;
  return (
    <Section title={`${formatMonth(status.month)} — wykonanie`}>
      <ul className="flex flex-col gap-4">
        {status.lines.map((line) => {
          const verdict = lineVerdict(line);
          return (
            <li className="flex flex-col gap-1" key={line.kind}>
              <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                <span className="font-medium">{ALLOCATION_KIND_LABEL[line.kind]}</span>
                <span className="text-muted-foreground">
                  plan <Money amountMinor={line.targetAmountMinor} size="sm" variant="compact" /> ·
                  jest{' '}
                  <Money
                    amountMinor={line.actualAmountMinor}
                    size="sm"
                    variant={line.actualAmountMinor < 0 ? 'expense' : 'compact'}
                  />
                </span>
              </p>
              <ProgressBar pool={ALLOCATION_POOL[line.kind]} valueBps={line.fulfillmentBps} />
              <p className="flex items-center justify-between gap-2 text-caption">
                <span className="font-numeric tabular-nums">
                  {baseZero ? '—' : `${percentOneDecimal(line.actualPercentBps)} wpływów`}
                </span>
                <span className={cn('flex items-center gap-1', TONE_CLASS[verdict.tone])}>
                  {verdict.tone === 'success' ? (
                    <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
                  ) : null}
                  {verdict.label}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
      {notice === null ? null : (
        <p className="mt-3 flex items-start gap-1 text-sm text-warning">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
          {notice}
        </p>
      )}
      {status.totals.shortfallMinor > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-l-[3px] border-warning bg-warning/10 p-3">
          <p className="flex items-start gap-1 text-sm">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-warning"
              strokeWidth={1.5}
            />
            <span>
              Do domknięcia planu brakuje{' '}
              <Money amountMinor={status.totals.shortfallMinor} size="sm" />
            </span>
          </p>
          <Button
            onClick={() => {
              openNew(
                'transfer',
                topUpPreset(
                  status,
                  (accounts.data ?? []).map((account) => ({ ...account, accountId: account.id })),
                ),
              );
            }}
            size="small"
            variant="soft"
          >
            Przelej teraz
          </Button>
        </div>
      ) : null}
      <p className="mt-3 text-caption text-muted-foreground">
        ⓘ Wykonanie netto: wpłaty minus wypłaty.
      </p>
    </Section>
  );
}

/**
 * Trend: łączna realizacja planu w sześciu miesiącach (06 §3.6) — wykres liniowy
 * wykonania na tle planu (`F8-5`), a pod nim te same liczby jako lista (widok tabeli
 * dla czytnika ekranu i dla tych, którzy wolą liczby od linii).
 *
 * @param props - Właściwości komponentu.
 * @param props.month - Ostatni miesiąc trendu.
 * @returns Element sekcji.
 */
function TrendSection({ month }: { month: MonthKey }): ReactNode {
  const trend = useAllocationTrend(month);
  if (trend.data === undefined) return null;
  const points = trendPoints(trend.data);
  return (
    <Section title="Trend">
      <TrendChart
        format={percentOneDecimal}
        formatTick={percentTick}
        label={`Udział odkładanych kwot we wpływach w ostatnich ${String(points.length)} miesiącach — wykonanie na tle planu`}
        points={trendChartPoints(points)}
      />
      <details className="mt-4">
        <summary className="flex min-h-touch cursor-pointer items-center text-sm font-medium">
          Miesiąc po miesiącu
        </summary>
        <ul className="flex flex-col gap-3 pb-2">
          {points.map((point) => (
            <li className="flex flex-col gap-1" key={point.month}>
              <p className="flex justify-between gap-2 text-sm">
                <span>{formatMonth(point.month)}</span>
                <span className="font-numeric tabular-nums text-muted-foreground">
                  {point.targetBps === 0
                    ? 'bez planu'
                    : `${point.hasIncome ? percentOneDecimal(point.actualBps) : '—'} z ${percentOneDecimal(point.targetBps)}`}
                </span>
              </p>
              <ProgressBar
                label={`Realizacja planu — ${formatMonth(point.month)}`}
                pool="savings"
                valueBps={point.fulfillmentBps}
              />
            </li>
          ))}
        </ul>
      </details>
    </Section>
  );
}

/**
 * Ekran rozkładu docelowego.
 *
 * @returns Element ekranu.
 */
export default function AllocationScreen(): ReactNode {
  const { household } = useAuth();
  const month = monthKeyOf(
    todayInTimezone(household?.timezone ?? 'Europe/Warsaw'),
    household?.monthStartDay ?? 1,
  );
  const status = useAllocationStatus(month);

  let content: ReactNode;
  if (status.isPending) {
    content = <AllocationSkeleton />;
  } else if (status.isError) {
    content = (
      <ErrorState
        details={errorDetails(status.error)}
        lastUpdatedAt={lastUpdatedLabel(status.dataUpdatedAt)}
        onRetry={() => {
          void status.refetch();
        }}
        retrying={status.isFetching}
        title="Nie udało się wczytać rozkładu"
      />
    );
  } else {
    content = (
      <>
        {status.data.effectiveFromMonth === null ? (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            <PieChart aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
            Ustal, jaki procent wpływów odkładasz i inwestujesz — ekran miesiąca pokaże, ile jeszcze
            brakuje do planu.
          </p>
        ) : null}
        {/* Klucz: po zapisie nowej wersji suwaki startują od zapisanych wartości. */}
        <TargetsSection
          key={status.data.effectiveFromMonth ?? 'none'}
          month={month}
          status={status.data}
        />
        <ExecutionSection status={status.data} />
        <TrendSection month={month} />
      </>
    );
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Rozkład docelowy</h1>
      </header>
      {content}
    </main>
  );
}
