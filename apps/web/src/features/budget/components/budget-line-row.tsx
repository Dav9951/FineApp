import type { BudgetLineDto } from '@fineapp/shared';
import {
  CalendarClock,
  CreditCard,
  Pencil,
  PiggyBank,
  Repeat,
  Sigma,
  Target,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { Button, ListRow, Money } from '../../../components/ui/index.js';
import { cn } from '../../../lib/cn.js';
import {
  LINE_KIND_LABEL,
  lineCaption,
  lineKind,
  lineMoneyVariant,
  progressText,
  sourceNote,
  sourceNoteText,
  type LineKind,
  type LineProgress,
} from '../budget-view.js';

/**
 * Wiersz linii szkicu budżetu
 * ([06 §3.14](../../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth)).
 *
 * Ikona mówi, skąd linia przyszła, a tekst dla czytnika powtarza to słowami — ikona nie
 * jest jedynym nośnikiem (15 §2). Pod wierszem notka o źródle z jedną akcją:
 * „Przyjmij" przy zmianie w źródle, „Zostaw jako własną" przy źródle usuniętym.
 */

/** Ikony pochodzenia linii (15 §6 — lucide, obrys 1,5). */
const KIND_ICON: Record<LineKind, LucideIcon> = {
  recurring: Repeat,
  planned: CalendarClock,
  set_aside: PiggyBank,
  goal: Target,
  liability: CreditCard,
  average: Sigma,
  manual: Pencil,
};

/** Kolor paska wykonania — pula linii, nie ocena (15 §4, jak `ProgressBar`). */
const PROGRESS_FILL: Record<LineProgress['flow'], string> = {
  income: 'bg-income',
  expense: 'bg-expense',
  savings: 'bg-savings',
  investment: 'bg-investment',
};

/**
 * Wykonanie pod linią: zdanie i cienki pasek (06 §3.14, `F9-9`).
 *
 * @param props - Właściwości komponentu.
 * @param props.progress - Wykonanie linii albo grupy.
 * @returns Element wykonania.
 */
function LineProgressNote({ progress }: { progress: LineProgress }): ReactNode {
  const text = progressText(progress);
  const warn = progress.overMinor > 0 && progress.overIsWarning;
  return (
    <div className="-mt-1 flex flex-col gap-1 pb-2 pl-11">
      <p className={warn ? 'text-caption text-warning' : 'text-caption text-muted-foreground'}>
        {progress.label === null ? null : <>{progress.label}: </>}
        {text.verb} <Money amountMinor={progress.actualMinor} size="meta" unit={false} />
        {text.rest === null ? null : (
          <>
            {' · '}
            {text.rest.label} <Money amountMinor={text.rest.amountMinor} size="meta" unit={false} />
          </>
        )}
      </p>
      {progress.plannedMinor > 0 ? (
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${warn ? 'bg-warning' : PROGRESS_FILL[progress.flow]}`}
            style={{
              width: `${String(Math.max(0, Math.min(progress.fulfillmentBps, 10_000)) / 100)}%`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Właściwości wiersza linii. */
export interface BudgetLineRowProps {
  line: BudgetLineDto;
  /** Pierwszy wiersz sekcji — bez górnej linii. */
  first?: boolean;
  /** „Przyjmij" — tylko w szkicu edytowalnym. */
  onAcceptSource?: (line: BudgetLineDto) => void;
  /** „Zostaw jako własną" — tylko w szkicu edytowalnym. */
  onDetach?: (line: BudgetLineDto) => void;
  /** Dotknięcie wiersza — arkusz linii (`F9-7`). */
  onOpen?: (line: BudgetLineDto) => void;
  /** Akcja w toku — przyciski przygaszone. */
  busy?: boolean;
  /** Wykonanie (miesiąc bieżący i miniony, `F9-9`). */
  progress?: LineProgress | undefined;
  /** Uchwyt przeciągania po prawej (tryb „Układaj", ADR-081). */
  handle?: ReactNode;
  /** Element listy dla biblioteki przeciągania. */
  containerRef?: (element: HTMLLIElement | null) => void;
  /** Przesunięcie w trakcie przeciągania. */
  style?: CSSProperties;
  /** Wiersz właśnie przeciągany — uniesiony nad listą. */
  dragging?: boolean;
}

/**
 * Wiersz linii szkicu.
 *
 * @param props - Właściwości komponentu.
 * @param props.line - Linia.
 * @param props.first - Czy pierwszy w sekcji.
 * @param props.onAcceptSource - „Przyjmij".
 * @param props.onDetach - „Zostaw jako własną".
 * @param props.onOpen - Dotknięcie wiersza.
 * @param props.busy - Akcja w toku.
 * @param props.progress - Wykonanie linii.
 * @param props.handle - Uchwyt przeciągania.
 * @param props.containerRef - Element listy dla biblioteki przeciągania.
 * @param props.style - Przesunięcie w trakcie przeciągania.
 * @param props.dragging - Wiersz przeciągany.
 * @returns Element wiersza.
 */
export function BudgetLineRow({
  line,
  first = false,
  onAcceptSource,
  onDetach,
  onOpen,
  busy = false,
  progress,
  handle,
  containerRef,
  style,
  dragging = false,
}: BudgetLineRowProps): ReactNode {
  const kind = lineKind(line);
  const Icon = KIND_ICON[kind];
  const note = sourceNote(line);
  const caption = lineCaption(line);
  return (
    <li
      className={cn(
        'group/row relative',
        first ? '' : 'border-t border-border',
        dragging ? 'z-10 rounded-md bg-card shadow-sheet' : '',
      )}
      ref={containerRef}
      style={style}
    >
      <div className="flex items-center">
        <div className="min-w-0 flex-1">
          <ListRow
            amount={
              <Money
                amountMinor={line.amountMinor}
                size="sm"
                variant={lineMoneyVariant(line.flow)}
              />
            }
            caption={caption ?? undefined}
            first
            icon={<Icon aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />}
            name={
              <>
                {line.name}
                <span className="sr-only">, {LINE_KIND_LABEL[kind]}</span>
              </>
            }
            {...(onOpen === undefined
              ? {}
              : {
                  onClick: () => {
                    onOpen(line);
                  },
                })}
          />
        </div>
        {handle}
      </div>
      {progress === undefined ? null : <LineProgressNote progress={progress} />}
      {note === null ? null : (
        <div className="-mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pb-2 pl-11">
          <span
            className={
              note.kind === 'changed' || note.kind === 'missing'
                ? 'text-caption text-warning'
                : 'text-caption text-muted-foreground'
            }
          >
            {sourceNoteText(note, line.origin)}
          </span>
          {note.kind === 'changed' && onAcceptSource !== undefined ? (
            <Button
              disabled={busy}
              onClick={() => {
                onAcceptSource(line);
              }}
              size="small"
              variant="soft"
            >
              Przyjmij
            </Button>
          ) : null}
          {note.kind === 'missing' && onDetach !== undefined ? (
            <Button
              disabled={busy}
              onClick={() => {
                onDetach(line);
              }}
              size="small"
              variant="soft"
            >
              Zostaw jako własną
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}
