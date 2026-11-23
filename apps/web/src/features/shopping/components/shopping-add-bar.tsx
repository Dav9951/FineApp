import {
  formatShoppingQuantity,
  normalizeShoppingName,
  parseQuickAdd,
  SHOPPING_SECTION_LABELS,
  type ShoppingProductDto,
} from '@fineapp/shared';
import { Plus } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { IconButton } from '../../../components/ui/index.js';
import { cn } from '../../../lib/cn.js';
import { newClientId } from '../../../lib/client-id.js';
import { useFrequent, useItemChange, useSuggestions } from '../hooks/use-shopping.js';

/**
 * Pole „Dodaj produkt…" (06 §3.15): rozpoznaje ilość na żywo (07 §14.4), podpowiada ze
 * słownika, pusty z fokusem pokazuje „Często kupowane". Enter zapisuje i zostawia fokus —
 * kilka produktów pod rząd bez dotykania niczego innego.
 */

/** Właściwości pola dodawania. */
export interface ShoppingAddBarProps {
  readonly listId: string;
  /** Wyłączone, gdy lista jest w archiwum. */
  readonly disabled?: boolean;
  /** Ustawia fokus od razu (arkusz szybkiego dopisania z FAB). */
  readonly autoFocus?: boolean;
  readonly className?: string;
  /** Po dopisaniu — np. zamknięcie arkusza. */
  readonly onAdded?: (name: string) => void;
}

/**
 * Pole dopisywania pozycji.
 *
 * @param props - Właściwości komponentu.
 * @param props.listId - Lista.
 * @param props.disabled - Pole wyłączone.
 * @param props.autoFocus - Fokus od razu.
 * @param props.className - Dodatkowe klasy.
 * @param props.onAdded - Wywołanie po dopisaniu.
 * @returns Element pola.
 */
export function ShoppingAddBar({
  listId,
  disabled = false,
  autoFocus = false,
  className,
  onAdded,
}: ShoppingAddBarProps): ReactNode {
  const inputId = useId();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const change = useItemChange(listId);
  const parsed = parseQuickAdd(text);
  const prefix = parsed === null ? '' : normalizeShoppingName(parsed.name);
  const suggestions = useSuggestions(prefix);
  const frequent = useFrequent(listId);

  const add = (name: string, quantity = parsed): void => {
    const body = {
      id: newClientId(),
      name,
      ...(quantity?.quantityMilli == null || quantity.unit === null
        ? {}
        : { quantityMilli: quantity.quantityMilli, unit: quantity.unit }),
    };
    setText('');
    void change({ kind: 'add', body });
    onAdded?.(name);
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (parsed === null || disabled) return;
    add(parsed.name);
  };

  const hints = (suggestions.data ?? []).filter(
    (product) => normalizeShoppingName(product.name) !== prefix,
  );
  const preview =
    parsed !== null && parsed.quantityMilli !== null
      ? `→ ${parsed.name} · ${formatShoppingQuantity(parsed)}`
      : null;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {focused && text === '' && (frequent.data ?? []).length > 0 ? (
        <section aria-label="Często kupowane">
          <ul className="flex flex-wrap gap-2">
            {(frequent.data ?? []).map((product) => (
              <li key={product.id}>
                <ProductChip
                  onPick={() => {
                    add(product.name, null);
                  }}
                  product={product}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {text !== '' && hints.length > 0 ? (
        <ul
          aria-label="Podpowiedzi"
          className="flex flex-col rounded-md border border-border bg-card"
        >
          {hints.map((product) => (
            <li key={product.id}>
              <button
                className="flex min-h-touch w-full items-center justify-between gap-2 px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
                onMouseDown={(event) => {
                  // Bez tego pole traci fokus przed kliknięciem i lista znika.
                  event.preventDefault();
                }}
                onClick={() => {
                  add(product.name);
                }}
                type="button"
              >
                <span className="truncate">{product.name}</span>
                <span className="shrink-0 text-caption text-muted-foreground">
                  {SHOPPING_SECTION_LABELS[product.section]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="flex items-center gap-2" onSubmit={submit}>
        <label className="sr-only" htmlFor={inputId}>
          Dodaj produkt
        </label>
        <input
          autoComplete="off"
          autoFocus={autoFocus}
          className="min-h-touch min-w-0 flex-1 rounded-sm border border-input bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          disabled={disabled}
          enterKeyHint="done"
          id={inputId}
          maxLength={90}
          onBlur={() => {
            setFocused(false);
          }}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onFocus={() => {
            setFocused(true);
          }}
          placeholder="Dodaj produkt…"
          value={text}
        />
        <IconButton disabled={disabled || parsed === null} label="Dodaj" type="submit">
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </IconButton>
      </form>
      {preview === null ? null : (
        <p aria-live="polite" className="text-caption text-muted-foreground">
          {preview}
        </p>
      )}
    </div>
  );
}

/**
 * Żeton „często kupowanego" produktu.
 *
 * @param props - Właściwości komponentu.
 * @param props.product - Produkt.
 * @param props.onPick - Wybór.
 * @returns Element żetonu.
 */
function ProductChip({
  product,
  onPick,
}: {
  readonly product: ShoppingProductDto;
  readonly onPick: () => void;
}): ReactNode {
  return (
    <button
      className="min-h-touch rounded-full border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onPick}
      type="button"
    >
      + {product.name}
    </button>
  );
}
