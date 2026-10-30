import type { MonthSummaryDto } from '@fineapp/shared';
import { AlertTriangle, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Button, Money, ProgressBar, Section } from '../../../components/ui/index.js';
import { inMonth } from '../../../lib/format.js';
import { goalIcon, goalMonthState, percentWhole } from '../goals-view.js';

/**
 * Sekcja „Cele" na ekranie miesiąca
 * ([06 §3.1](../../../../../../plans/06-ui-views.md#31-miesiąc-dashboard--mmonth), `F5-8`).
 *
 * Do trzech aktywnych celów w kolejności priorytetu: kwota względem docelowej, pasek
 * w kolorze puli i etykieta stanu wpłaty w oglądanym miesiącu (15 §5 — etykieta niesie
 * ocenę, pasek niesie pulę). Bez celów sekcji nie ma.
 */

/** Ile celów mieści kafel. */
const TILE_LIMIT = 3;

/**
 * Kafel celów.
 *
 * @param props - Właściwości komponentu.
 * @param props.summary - Podsumowanie miesiąca z sekcją `goals`.
 * @returns Element sekcji albo `null`.
 */
export function GoalsTile({ summary }: { summary: MonthSummaryDto }): ReactNode {
  if (summary.goals.length === 0) return null;
  return (
    <Section
      action={
        <Button asChild size="small" variant="link">
          <Link to="/goals">wszystkie</Link>
        </Button>
      }
      title="Cele"
    >
      <ul className="flex flex-col gap-3">
        {summary.goals.slice(0, TILE_LIMIT).map((goal) => {
          const Icon = goalIcon(goal);
          const state = goalMonthState(goal.contribution);
          return (
            <li className="flex flex-col gap-1" key={goal.id}>
              <p className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Icon
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                  <span className="truncate font-medium">{goal.name}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span>
                    <Money
                      amountMinor={goal.currentAmountMinor}
                      size="meta"
                      unit={goal.targetAmountMinor === null}
                      variant="compact"
                    />
                    {goal.targetAmountMinor === null ? null : (
                      <>
                        /
                        <Money amountMinor={goal.targetAmountMinor} size="meta" variant="compact" />
                      </>
                    )}
                  </span>
                  {goal.progressBps === null ? null : (
                    <span className="font-numeric font-semibold tabular-nums">
                      {percentWhole(goal.progressBps)}
                    </span>
                  )}
                </span>
              </p>
              {goal.progressBps === null ? null : (
                <ProgressBar pool={goal.kind} valueBps={goal.progressBps} />
              )}
              {state === 'met' ? (
                <p className="flex items-center gap-1 text-caption text-success">
                  <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
                  wpłacono {inMonth(summary.month)}
                </p>
              ) : null}
              {state === 'missing' || state === 'withdrawn' ? (
                <p className="flex items-center gap-1 text-caption text-warning">
                  <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {state === 'missing' ? 'brak wpłaty' : 'wypłaty ponad wpłaty'}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
