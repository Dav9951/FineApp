import { Pencil, Trash2 } from 'lucide-react';
import { useRef, useState, type PointerEvent, type ReactNode } from 'react';

import { cn } from '../../../lib/cn.js';

/**
 * Wiersz z gestem w bok (06 §3.2, 15 §4.8): w lewo — usuń, w prawo — edytuj.
 *
 * **Gest jest skrótem, nie jedyną drogą** (15 §2.7): dotknięcie wiersza otwiera arkusz
 * z edycją i przyciskiem „Usuń transakcję". Dlatego wiersz bez obsługi gestów (np. na
 * desktopie myszą) nadal robi wszystko, co trzeba.
 *
 * Kierunek rozstrzyga pierwsze 10 px ruchu: przeważa pion — oddajemy gest przewijaniu
 * (`touch-action: pan-y`), przeważa poziom — przejmujemy wskaźnik. Bez tego progu
 * każde lekko ukośne przewinięcie listy przesuwałoby wiersze.
 */

/** Ile pikseli trzeba przesunąć, żeby akcja się wykonała. */
export const SWIPE_THRESHOLD_PX = 80;

/** Dalej wiersz nie jedzie — pokazuje, że próg minął, i nie ucieka z ekranu. */
const MAX_OFFSET_PX = 112;

/** Ruch, po którym rozstrzygamy kierunek gestu. */
const DECIDE_PX = 10;

/** Właściwości wiersza z gestem. */
export interface SwipeRowProps {
  children: ReactNode;
  /** Przesunięcie w lewo za próg. */
  onSwipeLeft?: () => void;
  /** Przesunięcie w prawo za próg. */
  onSwipeRight?: () => void;
  /** Wyłącza gest (np. transakcja w koszu). */
  disabled?: boolean;
}

/** Stan śledzonego gestu. */
interface Drag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  /** `undefined` — jeszcze nie wiadomo; `false` — przewijanie, gest porzucony. */
  horizontal: boolean | undefined;
}

/**
 * Wiersz listy z gestem w bok.
 *
 * @param props - Właściwości komponentu.
 * @param props.children - Wiersz (zwykle `<ListRow>`).
 * @param props.onSwipeLeft - Akcja po przesunięciu w lewo.
 * @param props.onSwipeRight - Akcja po przesunięciu w prawo.
 * @param props.disabled - Czy gest jest wyłączony.
 * @returns Element wiersza.
 */
export function SwipeRow({
  children,
  onSwipeLeft,
  onSwipeRight,
  disabled = false,
}: SwipeRowProps): ReactNode {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  // Po geście przeglądarka i tak wyśle `click` do wiersza — bez tej flagi przesunięcie
  // w lewo usuwałoby transakcję i jednocześnie otwierało jej edycję.
  const swiped = useRef(false);

  const clamp = (dx: number): number => {
    const min = onSwipeLeft ? -MAX_OFFSET_PX : 0;
    const max = onSwipeRight ? MAX_OFFSET_PX : 0;
    return Math.min(max, Math.max(min, dx));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled || !event.isPrimary) return;
    swiped.current = false;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      horizontal: undefined,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId || current.horizontal === false) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (current.horizontal === undefined) {
      if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
      current.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!current.horizontal) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    setOffset(clamp(dx));
  };

  const finish = (event: PointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (current.horizontal !== true) return;
    swiped.current = true;
    setDragging(false);
    setOffset(0);
    if (cancelled) return;
    const dx = clamp(event.clientX - current.startX);
    if (dx <= -SWIPE_THRESHOLD_PX) onSwipeLeft?.();
    else if (dx >= SWIPE_THRESHOLD_PX) onSwipeRight?.();
  };

  const past = Math.abs(offset) >= SWIPE_THRESHOLD_PX;

  return (
    <div className="relative overflow-hidden">
      {/* Tło z akcją, odsłaniane przez przesuwany wiersz. Ikona z podpisem — nie sam kolor
          (15 §2.4); aria-hidden, bo dla czytnika ekranu drogą jest arkusz. */}
      {offset !== 0 ? (
        <div
          aria-hidden="true"
          className={cn(
            'absolute inset-0 flex items-center px-4 text-sm font-medium',
            offset < 0
              ? cn('justify-end', past ? 'bg-danger text-background' : 'bg-muted text-danger')
              : cn(
                  'justify-start',
                  past ? 'bg-primary text-primary-foreground' : 'bg-muted text-primary',
                ),
          )}
        >
          {offset < 0 ? (
            <span className="inline-flex items-center gap-2">
              <Trash2 className="h-5 w-5" strokeWidth={1.5} />
              Usuń
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <Pencil className="h-5 w-5" strokeWidth={1.5} />
              Edytuj
            </span>
          )}
        </div>
      ) : null}
      <div
        className={cn(
          'relative touch-pan-y bg-background',
          dragging ? '' : 'transition-transform duration-200 ease-out',
        )}
        onClickCapture={(event) => {
          if (!swiped.current) return;
          swiped.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerCancel={(event) => {
          finish(event, true);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => {
          finish(event, false);
        }}
        style={offset === 0 ? undefined : { transform: `translateX(${String(offset)}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
