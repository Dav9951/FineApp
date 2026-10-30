import type { MonthSummaryDto } from '@fineapp/shared';
import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Button, Money, ProgressRing, Section } from '../../../components/ui/index.js';
import { percentOneDecimal } from '../../goals/goals-view.js';
import { useTransactionSheet } from '../../transactions/components/transaction-sheet.js';
import {
  ALLOCATION_KIND_LABEL,
  ALLOCATION_POOL,
  topUpPreset,
  withdrawalNotice,
} from '../allocation-view.js';

/**
 * Kafel „Cele procentowe" na ekranie miesiąca
 * ([06 §3.1](../../../../../../plans/06-ui-views.md#31-miesiąc-dashboard--mmonth), `F5-8`) —
 * bezpośrednia realizacja wymagania #8.
 *
 * Pierścień na pulę: wypełnienie i liczba to realizacja planu, znacznik `○`/`●` — czy plan
 * wykonany (kształt, nie tylko kolor). Pod spodem `2 000 / 2 360 zł` i udział we wpływach.
 * Niedobór pokazuje kwotę i **„Uzupełnij"**, które otwiera przelew z tą kwotą wpisaną
 * z góry — domknięcie planu to jedno dotknięcie.
 */

/**
 * Kafel celów procentowych.
 *
 * @param props - Właściwości komponentu.
 * @param props.summary - Podsumowanie miesiąca z sekcją `allocation`.
 * @returns Element sekcji.
 */
export function AllocationTile({ summary }: { summary: MonthSummaryDto }): ReactNode {
  const { openNew } = useTransactionSheet();
  const { allocation } = summary;
  const action = (
    <Button asChild size="small" variant="link">
      <Link to="/allocation">ustaw</Link>
    </Button>
  );

  if (allocation.effectiveFromMonth === null) {
    return (
      <Section action={action} title="Cele procentowe">
        <p className="text-sm text-muted-foreground">
          Ustal, jaki procent wpływów odkładasz i inwestujesz — tutaj zobaczysz, czy plan miesiąca
          jest wykonany.
        </p>
      </Section>
    );
  }

  const notice = withdrawalNotice(allocation.lines);
  const noIncome = allocation.incomeBaseMinor === 0;
  const shortfall = allocation.totals.shortfallMinor;
  return (
    <Section action={action} title="Cele procentowe">
      <ul className="flex flex-wrap justify-around gap-4">
        {allocation.lines.map((line) => (
          <li className="flex flex-col items-center gap-1 text-center" key={line.kind}>
            <ProgressRing
              achieved={line.status === 'met' || line.status === 'ahead'}
              caption={
                <>
                  <Money
                    amountMinor={line.actualAmountMinor}
                    size="meta"
                    unit={false}
                    variant={line.actualAmountMinor < 0 ? 'expense' : 'compact'}
                  />
                  {' / '}
                  <Money amountMinor={line.targetAmountMinor} size="meta" variant="compact" />
                </>
              }
              pool={ALLOCATION_POOL[line.kind]}
              valueBps={line.fulfillmentBps}
            />
            <span className="text-sm">{ALLOCATION_KIND_LABEL[line.kind]}</span>
            <span className="text-caption text-muted-foreground">
              {noIncome
                ? `— z ${percentOneDecimal(line.targetPercentBps)} wpływów`
                : `${percentOneDecimal(line.actualPercentBps)} z ${percentOneDecimal(line.targetPercentBps)} wpływów`}
            </span>
          </li>
        ))}
      </ul>

      {notice === null ? null : (
        <p className="mt-3 flex items-start gap-1 text-sm text-warning">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
          {notice}
        </p>
      )}
      {shortfall > 0 && !summary.isFuture ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-l-[3px] border-warning bg-warning/10 p-3">
          <p className="flex items-start gap-1 text-sm">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-warning"
              strokeWidth={1.5}
            />
            <span>
              Brakuje <Money amountMinor={shortfall} size="sm" /> do planu miesiąca
            </span>
          </p>
          {summary.isCurrent ? (
            <Button
              onClick={() => {
                openNew('transfer', topUpPreset(allocation, summary.accounts));
              }}
              size="small"
              variant="soft"
            >
              Uzupełnij
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="mt-3 text-caption text-muted-foreground">
        ⓘ Wykonanie netto: wpłaty minus wypłaty
        {allocation.isPartialMonth && !noIncome ? ' · na podstawie dotychczasowych wpływów' : ''}
      </p>
    </Section>
  );
}
