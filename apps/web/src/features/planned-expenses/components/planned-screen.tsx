import {
  formatMonth,
  monthKeyOf,
  todayInTimezone,
  type LiquidityWarningDto,
  type PlannedExpenseDto,
} from '@fineapp/shared';
import { AlertTriangle, CalendarClock, Plus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Money,
  ProgressBar,
  Section,
  Skeleton,
} from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useAuth } from '../../auth/auth-context.js';
import {
  PLANNED_HORIZON_MONTHS,
  usePlannedExpenses,
  usePlannedUpcoming,
} from '../hooks/use-planned-expenses.js';
import type { PlannedPreset } from '../planned-form-state.js';
import {
  coveragePercent,
  groupByDueMonth,
  plannedSummary,
  warningAction,
} from '../planned-view.js';
import { PaySheet } from './pay-sheet.js';
import { PlannedCard } from './planned-card.js';
import { PlannedFormSheet } from './planned-form-sheet.js';
import { SetAsideSheet, type SetAsideTarget } from './set-aside-sheet.js';

/**
 * Ekran planowanych wydatków — `/planned`
 * ([06 §3.10](../../../../../../plans/06-ui-views.md#310-planowane-wydatki--planned), `F6-6`).
 *
 * Nad kartami podsumowanie sześciu miesięcy (ile wypada, ile odłożone, ile odkładać
 * miesięcznie) i ostrzeżenia prognozy — z przyciskiem, gdy jeden wydatek da się naprawić
 * jednym ruchem. Karty w grupach po miesiącu terminu, bo to suma miesiąca obciąża budżet.
 */

/** Stan nawigacji: wydatek z `/planned/:id` albo wartości z góry z pozycji cyklicznej. */
interface PlannedLocationState {
  readonly plannedId?: string;
  readonly preset?: PlannedPreset;
}

/**
 * Stan nawigacji zawężony z `unknown`.
 *
 * @param state - `location.state`.
 * @returns Identyfikator i wartości z góry, jeśli są.
 */
function locationStateOf(state: unknown): PlannedLocationState {
  if (typeof state !== 'object' || state === null) return {};
  const value = state as Record<string, unknown>;
  const preset =
    typeof value.preset === 'object' && value.preset !== null
      ? (value.preset as PlannedPreset)
      : undefined;
  return {
    ...(typeof value.plannedId === 'string' ? { plannedId: value.plannedId } : {}),
    ...(preset === undefined ? {} : { preset }),
  };
}

/**
 * Szkielet ekranu — podsumowanie i dwie karty.
 *
 * @returns Element szkieletu.
 */
function PlannedSkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Wczytywanie planowanych wydatków">
      <Section first title={`Najbliższe ${String(PLANNED_HORIZON_MONTHS)} miesięcy`}>
        <Skeleton className="h-5 w-full" />
        <Skeleton className="mt-2 h-5 w-3/4" />
        <Skeleton className="mt-3 h-2 w-full" />
      </Section>
      <Section>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="mt-3 h-40 w-full" />
      </Section>
    </div>
  );
}

/**
 * Wiersz podsumowania: etykieta po lewej, kwota po prawej.
 *
 * @param props - Właściwości komponentu.
 * @param props.label - Etykieta.
 * @param props.amountMinor - Kwota.
 * @returns Element wiersza.
 */
function SummaryRow({ label, amountMinor }: { label: string; amountMinor: number }): ReactNode {
  return (
    <p className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Money amountMinor={amountMinor} size="sm" />
    </p>
  );
}

/**
 * Ekran planowanych wydatków.
 *
 * @returns Element ekranu.
 */
export default function PlannedScreen(): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const { household } = useAuth();
  const currentMonth = monthKeyOf(
    todayInTimezone(household?.timezone ?? 'Europe/Warsaw'),
    household?.monthStartDay ?? 1,
  );
  const list = usePlannedExpenses();
  const upcoming = usePlannedUpcoming();
  const [form, setForm] = useState<{
    open: boolean;
    item?: PlannedExpenseDto;
    preset?: PlannedPreset;
  }>({ open: false });
  const [setAside, setSetAside] = useState<SetAsideTarget | null>(null);
  const [paying, setPaying] = useState<PlannedExpenseDto | null>(null);

  // Wejście z `/planned/:id` albo „Utwórz tam zamiast tego" (`F6-9`): arkusz, raz.
  const requested = locationStateOf(location.state);
  const loaded = list.data;
  useEffect(() => {
    if (requested.preset !== undefined) {
      setForm({ open: true, preset: requested.preset });
      void navigate('.', { replace: true, state: null });
      return;
    }
    if (requested.plannedId === undefined || loaded === undefined) return;
    const item = loaded.find((entry) => entry.id === requested.plannedId);
    if (item !== undefined) setForm({ open: true, item });
    void navigate('.', { replace: true, state: null });
  }, [requested.plannedId, requested.preset, loaded, navigate]);

  const openNew = (): void => {
    setForm({ open: true });
  };
  const openEdit = (item: PlannedExpenseDto): void => {
    setForm({ open: true, item });
  };

  /**
   * Działanie przy ostrzeżeniu — na wydatku, którego dotyczy.
   *
   * @param warning - Ostrzeżenie.
   * @returns Przycisk albo nic.
   */
  const warningButton = (warning: LiquidityWarningDto): ReactNode => {
    const action = warningAction(warning);
    const item = list.data?.find((entry) => entry.id === warning.plannedExpenseId);
    if (action === null || item === undefined) return null;
    return (
      <Button
        className="self-end"
        onClick={() => {
          if (action === 'set-aside') setSetAside({ item, amountMinor: warning.gapMinor });
          else openEdit(item);
        }}
        size="small"
        variant="soft"
      >
        {action === 'set-aside' ? 'Odłóż zaległe' : 'Włącz odkładanie'}
      </Button>
    );
  };

  let content: ReactNode;
  if (list.isPending || upcoming.isPending) {
    content = <PlannedSkeleton />;
  } else if (list.isError || upcoming.isError) {
    const failed = list.isError ? list : upcoming;
    content = (
      <ErrorState
        details={errorDetails(failed.error)}
        lastUpdatedAt={lastUpdatedLabel(list.dataUpdatedAt)}
        onRetry={() => {
          void list.refetch();
          void upcoming.refetch();
        }}
        retrying={list.isFetching || upcoming.isFetching}
        title="Nie udało się wczytać planowanych wydatków"
      />
    );
  } else if (list.data.length === 0) {
    content = (
      <EmptyState
        action={
          <Button onClick={openNew} size="large" variant="primary">
            Dodaj wydatek
          </Button>
        }
        description="OC, przegląd auta, wakacje, prezenty — wpisz, ile i kiedy. Aplikacja policzy, ile odkładać co miesiąc, żeby w terminie pieniądze czekały."
        icon={<CalendarClock aria-hidden="true" className="h-7 w-7" strokeWidth={1.5} />}
        title="Brak planowanych wydatków"
      />
    );
  } else {
    const summary = plannedSummary(upcoming.data.meta);
    const warnings = upcoming.data.meta.liquidityWarnings;
    content = (
      <>
        <Section first title={`Najbliższe ${String(PLANNED_HORIZON_MONTHS)} miesięcy`}>
          <div className="flex flex-col gap-1">
            <SummaryRow amountMinor={summary.upcomingMinor} label="Wypada" />
            <SummaryRow amountMinor={summary.setAsideMinor} label="Odłożone" />
            <SummaryRow amountMinor={summary.monthlyMinor} label="Odkładaj miesięcznie" />
          </div>
          {summary.upcomingMinor > 0 ? (
            <div className="mt-3 flex items-center gap-3">
              <ProgressBar className="flex-1" pool="savings" valueBps={summary.coverageBps} />
              <span className="shrink-0 text-meta text-muted-foreground">
                {coveragePercent(summary.coverageBps)} pokrycia
              </span>
            </div>
          ) : null}
        </Section>

        {warnings.length === 0 ? null : (
          <Section>
            <ul className="flex flex-col gap-3">
              {warnings.map((warning) => (
                <li
                  className="flex flex-col gap-1"
                  key={`${warning.code}:${warning.month}:${warning.plannedExpenseId ?? ''}`}
                >
                  <p className="flex items-start gap-2 text-sm text-warning">
                    <AlertTriangle
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0"
                      strokeWidth={1.5}
                    />
                    <span>{warning.message}</span>
                  </p>
                  {warningButton(warning)}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {groupByDueMonth(list.data).map((group) => (
          <Section
            action={<Money amountMinor={group.totalMinor} size="sm" />}
            key={group.month}
            title={formatMonth(group.month)}
          >
            <ul className="flex flex-col gap-3">
              {group.items.map((item) => (
                <li key={item.id}>
                  <PlannedCard
                    currentMonth={currentMonth}
                    item={item}
                    onEdit={openEdit}
                    onPay={setPaying}
                    onSetAside={(target) => {
                      setSetAside({ item: target });
                    }}
                  />
                </li>
              ))}
            </ul>
          </Section>
        ))}
      </>
    );
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Planowane wydatki</h1>
        <IconButton label="Dodaj planowany wydatek" onClick={openNew}>
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </IconButton>
      </header>
      {content}
      <PlannedFormSheet
        item={form.item}
        onOpenChange={(open) => {
          setForm((current) => ({ ...current, open }));
        }}
        open={form.open}
        preset={form.preset}
      />
      <SetAsideSheet
        onClose={() => {
          setSetAside(null);
        }}
        target={setAside}
      />
      <PaySheet
        item={paying}
        onClose={() => {
          setPaying(null);
        }}
      />
    </main>
  );
}
