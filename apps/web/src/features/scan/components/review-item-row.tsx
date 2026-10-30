import type { DocumentItemDto } from '@fineapp/shared';
import { AlertTriangle, ChevronRight, CircleHelp, Plus } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge, Button, Checkbox, Money } from '../../../components/ui/index.js';
import { cn } from '../../../lib/cn.js';
import { formatDateShort } from '../../../lib/format.js';
import { confidenceLabel, isUncertain } from '../scan-view.js';

/**
 * Wiersz pozycji w przeglądzie dokumentu
 * ([06 §3.4.C](../../../../../../plans/06-ui-views.md#34-skanowanie--scan), makieta
 * `design/mockups/receipt-review.html`).
 *
 * Pozycja niepewna (< 60%) ma znacznik i wyróżnione tło, propozycja nowej kategorii —
 * „Dodaj" i „Wybierz inną" jednym dotknięciem (wymaganie #5), możliwy duplikat z wyciągu —
 * plakietkę (08 §10). Pole wyboru obejmuje nazwę i kwotę; akcje leżą pod nim, żeby
 * dotknięcie przycisku nie odznaczało pozycji.
 */

/**
 * Linia pod nazwą jako cel dotyku: 44 px obszaru, wygląd podpisu (ujemny margines jak
 * w `Button size="small" variant="link"`).
 */
const LINE_BUTTON =
  '-my-2 flex min-h-touch w-full items-center gap-1 text-left text-caption ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Właściwości wiersza pozycji. */
export interface ReviewItemRowProps {
  readonly item: DocumentItemDto;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  /** Nazwa kategorii albo `null`, gdy brak. */
  readonly categoryName: string | null;
  /** Wyciąg: data operacji w podpisie. */
  readonly statement: boolean;
  /** Tryb `split` albo `by_category` — kategorie pozycji trafią do transakcji, więc akcje są widoczne. */
  readonly perItem: boolean;
  /** Propozycja nowej kategorii przyjęta „Dodaj". */
  readonly proposalAccepted: boolean;
  readonly onAcceptProposal: () => void;
  readonly onUndoProposal: () => void;
  /** Wybór kategorii („Wybierz inną" przy propozycji). */
  readonly onChangeCategory: () => void;
  /** Korekta opisu, kwoty i kategorii — dotknięcie linii kategorii. */
  readonly onEdit: () => void;
}

/**
 * Wiersz pozycji.
 *
 * @param props - Właściwości komponentu.
 * @returns Element wiersza.
 */
export function ReviewItemRow(props: ReviewItemRowProps): ReactNode {
  const { item, categoryName, statement, perItem } = props;
  const uncertain = isUncertain(item);
  const proposal = item.suggestedCategoryId === null ? item.suggestedCategoryName : null;
  const percent = confidenceLabel(item.confidence);
  const name =
    item.quantity !== null && item.quantity > 1
      ? `${item.description} × ${String(item.quantity)}`
      : item.description;
  const captionParts = [
    statement && item.bookedOn !== null ? formatDateShort(item.bookedOn) : null,
    statement ? item.rawText : null,
  ].filter((part): part is string => part !== null && part !== '');

  let categoryLine: ReactNode;
  if (proposal !== null && !props.proposalAccepted) {
    categoryLine = (
      <button className={`${LINE_BUTTON} text-warning`} onClick={props.onEdit} type="button">
        <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="min-w-0 flex-1">
          Nowa kategoria: <strong>„{proposal}”</strong>
        </span>
      </button>
    );
  } else if (proposal !== null) {
    categoryLine = (
      <button className={`${LINE_BUTTON} text-success`} onClick={props.onEdit} type="button">
        <Plus aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="min-w-0 flex-1">„{proposal}” — zostanie dodana przy zapisie</span>
      </button>
    );
  } else {
    // Linia kategorii jest celem dotyku korekty pozycji — bez osobnego „popraw" w każdym
    // wierszu. Ujemny margines jak w małym odnośniku `Button`: obszar 44 px, wygląd podpisu.
    categoryLine = (
      <button
        aria-label={`Popraw pozycję: ${item.description}`}
        className={`${LINE_BUTTON} justify-between text-muted-foreground`}
        onClick={props.onEdit}
        type="button"
      >
        <span className="truncate">{categoryName ?? 'Bez kategorii'}</span>
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
          {percent === null || uncertain ? null : percent}
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
        </span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        'border-t border-border py-2',
        (uncertain || (proposal !== null && !props.proposalAccepted)) && '-mx-4 bg-warning/10 px-4',
      )}
    >
      <Checkbox checked={props.checked} onCheckedChange={props.onCheckedChange}>
        <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
          <span className="min-w-0 text-sm font-medium">{name}</span>
          <Money
            amountMinor={item.amountMinor}
            size="sm"
            variant={item.direction === 'outflow' ? 'expense' : 'income'}
          />
        </span>
      </Checkbox>
      <div className="flex flex-col gap-1 pl-8">
        {captionParts.length > 0 ? (
          <p className="truncate text-caption text-muted-foreground">{captionParts.join(' · ')}</p>
        ) : null}
        {item.duplicateOfTransactionId === null ? null : (
          <Badge className="self-start" tone="warning">
            Możliwy duplikat
          </Badge>
        )}
        {uncertain ? (
          <p className="flex items-center gap-1 text-caption text-warning">
            <CircleHelp aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            Niepewne dopasowanie · <strong>{percent}</strong>
          </p>
        ) : null}
        {categoryLine}
        {perItem && proposal !== null ? (
          <div className="flex flex-wrap gap-2">
            {props.proposalAccepted ? (
              <Button onClick={props.onUndoProposal} size="small" variant="link">
                Cofnij
              </Button>
            ) : (
              <>
                <Button onClick={props.onAcceptProposal} size="small" variant="primary">
                  Dodaj
                </Button>
                <Button onClick={props.onChangeCategory} size="small" variant="ghost">
                  Wybierz inną
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
