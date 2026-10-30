import type { MonthSummaryDto } from '@fineapp/shared';
import { AlertTriangle, CalendarClock, Check, Circle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Button, Money, Section } from '../../../components/ui/index.js';
import {
  canSetAsideNow,
  coveragePercent,
  dueDistanceLabel,
  fundingState,
  monthName,
} from '../planned-view.js';
import { SetAsideSheet, type SetAsideTarget } from './set-aside-sheet.js';

/**
 * Sekcja „Nadchodzące" na ekranie miesiąca
 * ([06 §3.10](../../../../../../plans/06-ui-views.md#310-planowane-wydatki--planned), `F6-8`).
 *
 * Między „Do zrobienia" a „Na co idą pieniądze": do trzech najbliższych wydatków z pokryciem
 * i ratą, pod nimi ostrzeżenia prognozy. „Odłóż" tylko w miesiącu bieżącym — przelew
 * w podglądzie przyszłości albo przeszłości miałby datę, której nikt się nie spodziewa.
 * Bez planowanych wydatków sekcji nie ma: pusty kafel na głównym ekranie byłby szumem.
 */

/**
 * Kafel „Nadchodzące".
 *
 * @param props - Właściwości komponentu.
 * @param props.summary - Podsumowanie miesiąca z sekcją `plannedExpenses`.
 * @returns Element sekcji albo `null`.
 */
export function UpcomingTile({ summary }: { summary: MonthSummaryDto }): ReactNode {
  const [target, setTarget] = useState<SetAsideTarget | null>(null);
  const section = summary.plannedExpenses;
  if (section.items.length === 0) return null;

  return (
    <Section
      action={
        <Button asChild size="small" variant="link">
          <Link to="/planned">wszystkie</Link>
        </Button>
      }
      title="Nadchodzące"
    >
      <ul className="flex flex-col gap-3">
        {section.items.map((item) => {
          const funding = fundingState(item);
          return (
            <li className="flex flex-col gap-1" key={item.id}>
              <p className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <CalendarClock
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                  <span className="truncate font-medium">{item.name}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <Money amountMinor={item.estimatedAmountMinor} size="meta" variant="compact" />
                  <span className="text-caption text-muted-foreground">
                    {dueDistanceLabel(item.monthsUntilDue)}
                  </span>
                </span>
              </p>
              <p className="flex items-center gap-1 pl-6 text-caption text-muted-foreground">
                {funding === 'covered' ? (
                  <>
                    odłożone 100%
                    <Check
                      aria-label="pokryte"
                      className="h-3.5 w-3.5 text-success"
                      strokeWidth={1.5}
                    />
                  </>
                ) : funding === 'funding' ? (
                  <span>
                    odłożone {coveragePercent(item.setAside.coverageBps)} · odkładaj{' '}
                    <Money
                      amountMinor={item.setAside.monthlyRequiredMinor}
                      size="meta"
                      variant="compact"
                    />
                    /mies.
                  </span>
                ) : (
                  'bez odkładania'
                )}
              </p>
              {summary.isCurrent && canSetAsideNow(item) ? (
                <div className="flex items-center justify-between gap-2 pl-6">
                  <span className="flex items-center gap-1 text-caption text-muted-foreground">
                    <Circle aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {monthName(summary.month)}
                  </span>
                  <Button
                    onClick={() => {
                      setTarget({ item });
                    }}
                    size="small"
                    variant="soft"
                  >
                    Odłóż{' '}
                    <Money
                      amountMinor={item.setAside.monthlyRequiredMinor}
                      size="sm"
                      variant="compact"
                    />
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {section.warnings.length === 0 ? null : (
        <ul className="mt-3 flex flex-col gap-1">
          {section.warnings.map((warning) => (
            <li
              className="flex items-start gap-1 text-sm text-warning"
              key={`${warning.code}:${warning.month}:${warning.plannedExpenseId ?? ''}`}
            >
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0"
                strokeWidth={1.5}
              />
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      )}
      <SetAsideSheet
        onClose={() => {
          setTarget(null);
        }}
        target={target}
      />
    </Section>
  );
}
