import { monthKeyOf, todayInTimezone, type GoalDto, type GoalKind } from '@fineapp/shared';
import { Check, Plus, Target } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Money,
  Section,
  Skeleton,
  Tabs,
} from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useAuth } from '../../auth/auth-context.js';
import { GOAL_KIND_LABEL, goalsOfKind, monthTotals } from '../goals-view.js';
import { useGoals } from '../hooks/use-goals.js';
import { ContributionSheet } from './contribution-sheet.js';
import { GoalCard } from './goal-card.js';
import { GoalFormSheet } from './goal-form-sheet.js';

/**
 * Ekran celów — `/goals`
 * ([06 §3.5](../../../../../../plans/06-ui-views.md#35-cele--goals), `F5-5`).
 *
 * Zakładki „Oszczędności" i „Inwestycje" (wymagania #6 i #7), nad kartami „W tym miesiącu:
 * zaplanowano · wpłacono". Karta: postęp, plan w obu stronach przelicznika, stan wpłaty
 * w miesiącu z „Wpłać" i prognoza z konkretną liczbą, gdy tempo nie wystarcza.
 */

/** Stan nawigacji z `/goals/:id`. */
interface GoalsLocationState {
  readonly goalId?: string;
}

/**
 * Identyfikator celu ze stanu nawigacji.
 *
 * @param state - `location.state`.
 * @returns Identyfikator albo `undefined`.
 */
function goalIdFrom(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null || !('goalId' in state)) return undefined;
  const { goalId } = state as GoalsLocationState;
  return typeof goalId === 'string' ? goalId : undefined;
}

/**
 * Szkielet ekranu — linia podsumowania i dwie karty.
 *
 * @returns Element szkieletu.
 */
function GoalsSkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Wczytywanie celów">
      <Section first title="W tym miesiącu">
        <Skeleton className="h-5 w-56" />
      </Section>
      <Section>
        <Skeleton className="h-44 w-full" />
        <Skeleton className="mt-3 h-44 w-full" />
      </Section>
    </div>
  );
}

/**
 * Ekran celów.
 *
 * @returns Element ekranu.
 */
export default function GoalsScreen(): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const { household } = useAuth();
  const month = monthKeyOf(
    todayInTimezone(household?.timezone ?? 'Europe/Warsaw'),
    household?.monthStartDay ?? 1,
  );
  const goals = useGoals(month);
  const [kind, setKind] = useState<GoalKind>('savings');
  const [sheet, setSheet] = useState<{ open: boolean; goal?: GoalDto }>({ open: false });
  const [contributing, setContributing] = useState<GoalDto | null>(null);

  // Wejście z `/goals/:id`: arkusz tego celu, raz, gdy lista dojdzie.
  const requestedId = goalIdFrom(location.state);
  const loaded = goals.data?.data;
  useEffect(() => {
    if (requestedId === undefined || loaded === undefined) return;
    const goal = loaded.find((item) => item.id === requestedId);
    if (goal !== undefined) {
      setKind(goal.kind);
      setSheet({ open: true, goal });
    }
    void navigate('.', { replace: true, state: null });
  }, [requestedId, loaded, navigate]);

  const openNew = (): void => {
    setSheet({ open: true });
  };
  const openEdit = (goal: GoalDto): void => {
    setSheet({ open: true, goal });
  };

  /**
   * Treść zakładki jednego rodzaju.
   *
   * @param tabKind - Rodzaj zakładki.
   * @returns Element treści.
   */
  const tabContent = (tabKind: GoalKind): ReactNode => {
    if (goals.data === undefined) return null;
    const list = goalsOfKind(goals.data.data, tabKind);
    if (list.length === 0) {
      return (
        <EmptyState
          action={
            <Button onClick={openNew} size="large" variant="primary">
              Dodaj cel
            </Button>
          }
          description={
            tabKind === 'savings'
              ? 'Wkład własny, poduszka, wakacje — ustaw kwotę i miesięczną wpłatę. Aplikacja policzy, kiedy dojdziesz do celu.'
              : 'IKE, emerytura, portfel — ustaw miesięczną wpłatę jako kwotę albo procent wpływów.'
          }
          icon={<Target aria-hidden="true" className="h-7 w-7" strokeWidth={1.5} />}
          title={
            tabKind === 'savings' ? 'Brak celów oszczędnościowych' : 'Brak celów inwestycyjnych'
          }
        />
      );
    }
    const totals = monthTotals(list);
    const met = totals.plannedMinor > 0 && totals.contributedMinor >= totals.plannedMinor;
    return (
      <>
        <Section first title="W tym miesiącu">
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <span>
              Zaplanowano <Money amountMinor={totals.plannedMinor} size="sm" variant="compact" />
            </span>
            <span aria-hidden="true">·</span>
            <span>
              wpłacono <Money amountMinor={totals.contributedMinor} size="sm" variant="compact" />
            </span>
            {met ? (
              <Check
                aria-label="plan wykonany"
                className="h-4 w-4 text-success"
                strokeWidth={1.5}
              />
            ) : null}
          </p>
        </Section>
        <Section>
          <ul className="flex flex-col gap-3">
            {list.map((goal) => (
              <li key={goal.id}>
                <GoalCard
                  goal={goal}
                  month={month}
                  onContribute={setContributing}
                  onEdit={openEdit}
                />
              </li>
            ))}
          </ul>
        </Section>
      </>
    );
  };

  let content: ReactNode;
  if (goals.isPending) {
    content = <GoalsSkeleton />;
  } else if (goals.isError) {
    content = (
      <ErrorState
        details={errorDetails(goals.error)}
        lastUpdatedAt={lastUpdatedLabel(goals.dataUpdatedAt)}
        onRetry={() => {
          void goals.refetch();
        }}
        retrying={goals.isFetching}
        title="Nie udało się wczytać celów"
      />
    );
  } else {
    content = (
      <Tabs
        className="mt-3"
        items={(['savings', 'investment'] as const).map((value) => ({
          value,
          label: GOAL_KIND_LABEL[value],
          content: tabContent(value),
        }))}
        onValueChange={(value) => {
          setKind(value === 'investment' ? 'investment' : 'savings');
        }}
        value={kind}
      />
    );
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Cele</h1>
        <IconButton label="Dodaj cel" onClick={openNew}>
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </IconButton>
      </header>
      {content}
      <GoalFormSheet
        goal={sheet.goal}
        kind={kind}
        onOpenChange={(open) => {
          setSheet((current) => ({ ...current, open }));
        }}
        open={sheet.open}
      />
      <ContributionSheet
        goal={contributing}
        onClose={() => {
          setContributing(null);
        }}
      />
    </main>
  );
}
