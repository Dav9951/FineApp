import type { MonthKey, PlannedExpenseDto } from '@fineapp/shared';
import { AlertTriangle, CalendarClock, Check, Circle, Repeat } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge, Button, Card, Money, ProgressBar } from '../../../components/ui/index.js';
import {
  canSetAsideNow,
  coveragePercent,
  dueCaption,
  fundingState,
  monthName,
  PRIORITY_LABEL,
} from '../planned-view.js';

/**
 * Karta planowanego wydatku na ekranie `/planned`
 * ([06 §3.10](../../../../../../plans/06-ui-views.md#310-planowane-wydatki--planned), `F6-6`).
 *
 * Kolejność linii odpowiada pytaniom: co i kiedy → ile już mam → ile odkładać → czy w tym
 * miesiącu odłożyłem. Ocena siedzi w etykietach z glifem (15 §2.4), pasek niesie kolor
 * oszczędności — odkładanie to oszczędzanie z datą.
 */

/** Klasa glifu w linii stanu. */
const GLYPH = 'mt-0.5 h-4 w-4 shrink-0';

/** Właściwości karty. */
export interface PlannedCardProps {
  item: PlannedExpenseDto;
  /** Bieżący miesiąc — „Wpłata za wrzesień" i „Zapłacone" w miesiącu terminu. */
  currentMonth: MonthKey;
  onEdit: (item: PlannedExpenseDto) => void;
  onSetAside: (item: PlannedExpenseDto) => void;
  onPay: (item: PlannedExpenseDto) => void;
}

/**
 * Karta wydatku.
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Wydatek.
 * @param props.currentMonth - Bieżący miesiąc.
 * @param props.onEdit - Otwarcie formularza (także „Włącz odkładanie").
 * @param props.onSetAside - Otwarcie arkusza „Odłóż teraz".
 * @param props.onPay - Otwarcie arkusza „Zapłacone".
 * @returns Element karty.
 */
export function PlannedCard({
  item,
  currentMonth,
  onEdit,
  onSetAside,
  onPay,
}: PlannedCardProps): ReactNode {
  const funding = fundingState(item);
  const { setAside } = item;
  const payable = item.status === 'ready' && item.dueMonth <= currentMonth;
  const overdue = item.monthsUntilDue < 0;

  return (
    <Card className="flex flex-col gap-2">
      <button
        className="-m-1 flex min-h-touch items-center gap-2 rounded p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          onEdit(item);
        }}
        type="button"
      >
        <CalendarClock
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
        />
        <span className="min-w-0 flex-1 truncate text-base font-medium">{item.name}</span>
        {item.repeatsYearly ? (
          <span className="flex shrink-0 items-center gap-1 text-caption text-muted-foreground">
            <Repeat aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
            co rok
          </span>
        ) : null}
      </button>

      <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span>
          {item.amountIsEstimate ? <span aria-label="około">~</span> : null}
          <Money amountMinor={item.estimatedAmountMinor} size="sm" />
          <span className="text-muted-foreground">
            {' · '}
            <span className={overdue ? 'text-warning' : undefined}>{dueCaption(item)}</span>
          </span>
        </span>
        <Badge tone={item.priority === 'must' ? 'warning' : 'neutral'}>
          {PRIORITY_LABEL[item.priority]}
        </Badge>
      </p>

      {funding === 'off' ? null : (
        <>
          <p className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              Odłożone <Money amountMinor={setAside.accumulatedMinor} size="sm" variant="compact" />{' '}
              / <Money amountMinor={item.estimatedAmountMinor} size="sm" variant="compact" />
            </span>
            <span className="flex items-center gap-1 font-numeric font-semibold tabular-nums">
              {funding === 'covered' ? (
                <Check aria-hidden="true" className="h-4 w-4 text-success" strokeWidth={1.5} />
              ) : null}
              {coveragePercent(setAside.coverageBps)}
            </span>
          </p>
          <ProgressBar pool="savings" valueBps={setAside.coverageBps} />
        </>
      )}

      {funding === 'funding' ? (
        <p className="text-meta text-muted-foreground">
          Odkładaj <Money amountMinor={setAside.monthlyRequiredMinor} size="meta" />
          /mies.
        </p>
      ) : null}
      {funding === 'funding' && !setAside.isOnTrack ? (
        <p className="flex items-start gap-1 text-sm text-warning">
          <AlertTriangle aria-hidden="true" className={GLYPH} strokeWidth={1.5} />
          Odkładanie jest opóźnione
        </p>
      ) : null}

      {funding === 'off' ? (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
          <span className="text-sm text-muted-foreground">Bez odkładania</span>
          {payable ? null : (
            <Button
              onClick={() => {
                onEdit(item);
              }}
              size="small"
              variant="soft"
            >
              Włącz odkładanie
            </Button>
          )}
        </div>
      ) : null}

      {funding === 'funding' && !payable ? (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
          {setAside.paidThisMonth ? (
            <span className="flex items-center gap-1 text-sm text-success">
              <Check aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
              Wpłata za {monthName(currentMonth)}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Circle aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
              Wpłata za {monthName(currentMonth)}
            </span>
          )}
          {canSetAsideNow(item) ? (
            <Button
              onClick={() => {
                onSetAside(item);
              }}
              size="small"
              variant="soft"
            >
              Odłóż teraz
            </Button>
          ) : null}
        </div>
      ) : null}

      {payable ? (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
          <span className="text-sm text-muted-foreground">
            {overdue ? 'Po terminie — zapłacone?' : 'Termin w tym miesiącu'}
          </span>
          <Button
            onClick={() => {
              onPay(item);
            }}
            size="small"
            variant="soft"
          >
            Zapłacone
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
