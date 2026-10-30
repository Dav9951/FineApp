import { formatMonth, type GoalDto, type MonthKey } from '@fineapp/shared';
import { AlertTriangle, Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge, Button, Card, Money, ProgressBar } from '../../../components/ui/index.js';
import { inMonth } from '../../../lib/format.js';
import {
  deadlineWarning,
  goalIcon,
  goalMonthState,
  percentOneDecimal,
  percentWhole,
  projectionLine,
} from '../goals-view.js';

/**
 * Karta celu na ekranie `/goals`
 * ([06 §3.5](../../../../../../plans/06-ui-views.md#35-cele--goals), `F5-5`).
 *
 * Kolejność linii odpowiada pytaniom: ile mam → jaki jest plan → czy w tym miesiącu
 * wpłaciłem → kiedy dojdę. Ocena siedzi w etykietach z glifem, pasek niesie kolor puli
 * (15 §5 „Pasek postępu z celem").
 */

/** Klasa glifu w linii stanu. */
const GLYPH = 'mt-0.5 h-4 w-4 shrink-0';

/**
 * Linia planu: „Plan: 2 000 zł/mies. = 17,0% wpływów" albo „Plan: 10,0% wpływów = 1 180 zł".
 *
 * @param props - Właściwości komponentu.
 * @param props.goal - Cel.
 * @returns Element linii.
 */
function PlanLine({ goal }: { goal: GoalDto }): ReactNode {
  const { mode, plannedAmountMinor, plannedPercentBps } = goal.contribution;
  if (mode === 'none' || plannedAmountMinor === null || plannedPercentBps === null) {
    return <p className="text-meta text-muted-foreground">Bez planu wpłat</p>;
  }
  if (mode === 'fixed') {
    return (
      <p className="text-meta text-muted-foreground">
        Plan: <Money amountMinor={plannedAmountMinor} size="meta" variant="compact" />
        /mies. = {percentOneDecimal(plannedPercentBps)} wpływów
      </p>
    );
  }
  return (
    <p className="text-meta text-muted-foreground">
      Plan: {percentOneDecimal(plannedPercentBps)} wpływów ={' '}
      <Money amountMinor={plannedAmountMinor} size="meta" variant="compact" />
    </p>
  );
}

/** Właściwości karty celu. */
export interface GoalCardProps {
  goal: GoalDto;
  /** Miesiąc planu — do etykiety „Wpłacono we wrześniu". */
  month: MonthKey;
  onEdit: (goal: GoalDto) => void;
  onContribute: (goal: GoalDto) => void;
}

/**
 * Karta celu.
 *
 * @param props - Właściwości komponentu.
 * @param props.goal - Cel.
 * @param props.month - Miesiąc planu.
 * @param props.onEdit - Otwarcie formularza celu.
 * @param props.onContribute - Otwarcie arkusza wpłaty.
 * @returns Element karty.
 */
export function GoalCard({ goal, month, onEdit, onContribute }: GoalCardProps): ReactNode {
  const Icon = goalIcon(goal);
  const state = goalMonthState(goal.contribution);
  const projection = projectionLine(goal);
  const warning = deadlineWarning(goal);
  const active = goal.status === 'active';
  const canContribute = goal.status !== 'archived';

  return (
    <Card className="flex flex-col gap-2">
      <button
        className="-m-1 flex min-h-touch items-center gap-2 rounded p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          onEdit(goal);
        }}
        type="button"
      >
        <Icon
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
        />
        <span className="min-w-0 flex-1 truncate text-base font-medium">{goal.name}</span>
        {goal.status === 'paused' ? <Badge tone="neutral">wstrzymany</Badge> : null}
        {goal.status === 'archived' ? <Badge tone="neutral">archiwum</Badge> : null}
      </button>

      <p className="flex items-baseline justify-between gap-2 text-sm">
        <span>
          <Money
            amountMinor={goal.currentAmountMinor}
            size="sm"
            unit={goal.targetAmountMinor === null}
          />
          {goal.targetAmountMinor === null ? null : (
            <>
              {' z '}
              <Money amountMinor={goal.targetAmountMinor} size="sm" />
            </>
          )}
        </span>
        {goal.progressBps === null ? null : (
          <span className="font-numeric font-semibold tabular-nums">
            {percentWhole(goal.progressBps)}
          </span>
        )}
      </p>
      {goal.progressBps === null ? null : (
        <ProgressBar pool={goal.kind} valueBps={goal.progressBps} />
      )}

      <PlanLine goal={goal} />

      {active && state === 'met' ? (
        <p className="flex items-start gap-1 text-sm text-success">
          <Check aria-hidden="true" className={GLYPH} strokeWidth={1.5} />
          Wpłacono {inMonth(month)}
        </p>
      ) : null}
      {active && state === 'partial' ? (
        <p className="text-sm text-muted-foreground">
          Wpłacono{' '}
          <Money
            amountMinor={goal.contribution.contributedThisMonthMinor}
            size="sm"
            variant="compact"
          />{' '}
          z{' '}
          <Money
            amountMinor={goal.contribution.plannedAmountMinor ?? 0}
            size="sm"
            variant="compact"
          />{' '}
          {inMonth(month)}
        </p>
      ) : null}
      {active && state === 'missing' ? (
        <p className="flex items-start gap-1 text-sm text-warning">
          <AlertTriangle aria-hidden="true" className={GLYPH} strokeWidth={1.5} />
          Brak wpłaty {inMonth(month)}
        </p>
      ) : null}
      {state === 'withdrawn' ? (
        <p className="flex items-start gap-1 text-sm text-warning">
          <AlertTriangle aria-hidden="true" className={GLYPH} strokeWidth={1.5} />
          {`${inMonth(month).replace(/^w/u, 'W')} z celu wypłacono więcej, niż wpłacono`}
        </p>
      ) : null}

      {projection.kind === 'achieved' ? (
        <p className="flex items-start gap-1 text-sm text-success">
          <Check aria-hidden="true" className={GLYPH} strokeWidth={1.5} />
          Cel osiągnięty
        </p>
      ) : null}
      {active && projection.kind === 'pace' ? (
        <p className="text-meta text-muted-foreground">
          Przy tym tempie: {formatMonth(projection.month)}
        </p>
      ) : null}
      {active && projection.kind === 'never' ? (
        <p className="text-meta text-muted-foreground">
          Przy obecnym tempie cel nie zostanie osiągnięty
        </p>
      ) : null}
      {active && warning !== null ? (
        <p className="flex items-start gap-1 text-sm text-warning">
          <AlertTriangle aria-hidden="true" className={GLYPH} strokeWidth={1.5} />
          <span>
            Cel na {formatMonth(warning.targetMonth)} → potrzeba{' '}
            <Money amountMinor={warning.requiredMinor} size="sm" variant="compact" />
            /mies.
          </span>
        </p>
      ) : null}

      {canContribute ? (
        <div className="flex justify-end border-t border-border pt-2">
          <Button
            onClick={() => {
              onContribute(goal);
            }}
            size="small"
            variant="soft"
          >
            Wpłać
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
