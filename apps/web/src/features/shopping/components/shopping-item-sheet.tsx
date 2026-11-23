import {
  SHOPPING_SECTION_LABELS,
  SHOPPING_UNIT_LABELS,
  ShoppingSectionSchema,
  ShoppingUnitSchema,
  type ShoppingItemDto,
  type ShoppingSection,
  type ShoppingUnit,
  type UpdateShoppingItemRequest,
} from '@fineapp/shared';
import { useState, type FormEvent, type ReactNode } from 'react';

import {
  Button,
  Sheet,
  Switch,
  TextField,
  useToast,
  SHEET_ACTIONS,
} from '../../../components/ui/index.js';
import { newClientId } from '../../../lib/client-id.js';
import { cn } from '../../../lib/cn.js';
import {
  useItemChange,
  useShoppingLists,
  useUpdateProduct,
  useUpsertProduct,
} from '../hooks/use-shopping.js';
import { parseQuantityInput, quantityInputValue } from '../shopping-view.js';

/**
 * Arkusz pozycji listy zakupów (06 §3.15): nazwa, ilość z jednostką („Bez ilości" czyści
 * obie), notatka, dział, „Zawsze w domu", przeniesienie na inną listę, usunięcie.
 *
 * Usunięcie bez potwierdzenia — toast ma „Cofnij" (dopisuje pozycję od nowa).
 */

/** Właściwości arkusza pozycji. */
export interface ShoppingItemSheetProps {
  /** Pozycja; `null` — arkusz zamknięty. */
  readonly item: ShoppingItemDto | null;
  readonly onClose: () => void;
}

/**
 * Arkusz pozycji.
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Pozycja albo `null`.
 * @param props.onClose - Zamknięcie.
 * @returns Element arkusza.
 */
export function ShoppingItemSheet({ item, onClose }: ShoppingItemSheetProps): ReactNode {
  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={item !== null}
      title={item?.name ?? 'Pozycja'}
    >
      {item === null ? null : <ItemForm item={item} key={item.id} onDone={onClose} />}
    </Sheet>
  );
}

/**
 * Treść arkusza — montowana od nowa dla każdej pozycji.
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Pozycja.
 * @param props.onDone - Zamknięcie arkusza.
 * @returns Element formularza.
 */
function ItemForm({
  item,
  onDone,
}: {
  readonly item: ShoppingItemDto;
  readonly onDone: () => void;
}): ReactNode {
  const toast = useToast();
  const change = useItemChange(item.listId);
  const lists = useShoppingLists();
  const upsertProduct = useUpsertProduct();
  const updateProduct = useUpdateProduct();
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(quantityInputValue(item.quantityMilli));
  const [unit, setUnit] = useState<ShoppingUnit>(item.unit ?? 'pcs');
  const [note, setNote] = useState(item.note ?? '');
  const [section, setSection] = useState<ShoppingSection>(item.section);
  const [errors, setErrors] = useState<{ name?: string; quantity?: string }>({});
  // Własny stan przełącznika: pozycja w propsach to migawka z chwili otwarcia arkusza.
  const [staple, setStaple] = useState(item.isStaple);

  const others = (lists.data ?? []).filter((list) => list.id !== item.listId);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const milli = parseQuantityInput(quantity);
    const nextErrors = {
      ...(name.trim() === '' ? { name: 'Podaj nazwę' } : {}),
      ...(milli === undefined ? { quantity: 'Ilość od 0,001 do 1000' } : {}),
    };
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || milli === undefined) return;

    const body: UpdateShoppingItemRequest = {};
    if (name.trim() !== item.name) body.name = name.trim();
    const nextUnit = milli === null ? null : unit;
    if (milli !== item.quantityMilli || nextUnit !== item.unit) {
      body.quantityMilli = milli;
      body.unit = nextUnit;
    }
    const nextNote = note.trim() === '' ? null : note.trim();
    if (nextNote !== item.note) body.note = nextNote;
    if (section !== item.section) body.section = section;
    if (Object.keys(body).length > 0) void change({ kind: 'update', itemId: item.id, body });
    onDone();
  };

  const toggleStaple = (isStaple: boolean): void => {
    setStaple(isStaple);
    const onError = (failure: Error): void => {
      setStaple(!isStaple);
      toast.show({ message: failure.message });
    };
    if (item.productId === null) {
      upsertProduct.mutate({ name: item.name, section: item.section, isStaple }, { onError });
    } else {
      updateProduct.mutate({ productId: item.productId, body: { isStaple } }, { onError });
    }
  };

  const remove = (): void => {
    void change({ kind: 'delete', itemId: item.id });
    onDone();
    toast.show({
      message: `Usunięto „${item.name}”.`,
      action: {
        label: 'Cofnij',
        onAction: () => {
          void change({
            kind: 'add',
            // Nowy identyfikator: stary jest już kluczem idempotencji pierwszego dopisania.
            body: {
              id: newClientId(),
              name: item.name,
              section: item.section,
              ...(item.quantityMilli === null || item.unit === null
                ? {}
                : { quantityMilli: item.quantityMilli, unit: item.unit }),
              ...(item.note === null ? {} : { note: item.note }),
            },
          });
        },
      },
    });
  };

  const move = (listId: string, listName: string): void => {
    void change({ kind: 'update', itemId: item.id, body: { listId } });
    onDone();
    toast.show({ message: `Przeniesiono „${item.name}” na listę „${listName}”.` });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <TextField error={errors.name} label="Nazwa" maxLength={80} onChange={setName} value={name} />
      <div className="flex flex-col gap-2">
        <TextField
          error={errors.quantity}
          hint="Puste pole — bez ilości"
          inputMode="decimal"
          label="Ilość"
          onChange={setQuantity}
          placeholder="np. 2 albo 1,5"
          value={quantity}
        />
        <Chips
          label="Jednostka"
          onPick={(value) => {
            setUnit(value);
          }}
          options={ShoppingUnitSchema.options.map((value) => ({
            value,
            label: SHOPPING_UNIT_LABELS[value],
          }))}
          selected={unit}
        />
      </div>
      <TextField
        label="Notatka"
        maxLength={120}
        onChange={setNote}
        placeholder="np. bez laktozy"
        value={note}
      />
      <Chips
        label="Dział"
        onPick={setSection}
        options={ShoppingSectionSchema.options.map((value) => ({
          value,
          label: SHOPPING_SECTION_LABELS[value],
        }))}
        selected={section}
      />
      <div className="flex min-h-touch items-center justify-between gap-3">
        <span className="text-sm">
          Zawsze w domu
          <span className="block text-caption text-muted-foreground">
            Przy przepisie trafi do „Już mam”.
          </span>
        </span>
        <Switch checked={staple} label="Zawsze w domu" onCheckedChange={toggleStaple} />
      </div>
      {others.length > 0 ? (
        <section aria-label="Przenieś na inną listę" className="flex flex-col gap-2">
          <h3 className="text-sm text-muted-foreground">Przenieś na…</h3>
          <div className="flex flex-wrap gap-2">
            {others.map((list) => (
              <Button
                key={list.id}
                onClick={() => {
                  move(list.id, list.name);
                }}
                size="small"
                type="button"
                variant="ghost"
              >
                {list.name}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
      {/* Zawsze widoczne, bez przewijania (ADR-105). */}
      <div className={cn(SHEET_ACTIONS, 'flex gap-3')}>
        <Button className="flex-1" onClick={remove} size="large" type="button" variant="ghost">
          Usuń z listy
        </Button>
        <Button className="flex-1" size="large" type="submit">
          Zapisz
        </Button>
      </div>
    </form>
  );
}

/** Opcja w rzędzie żetonów. */
interface ChipOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/**
 * Rząd żetonów jednokrotnego wyboru (dział, jednostka).
 *
 * @param props - Właściwości komponentu.
 * @param props.label - Opis grupy.
 * @param props.options - Opcje.
 * @param props.selected - Wybrana wartość.
 * @param props.onPick - Wybór.
 * @returns Element grupy.
 */
function Chips<T extends string>({
  label,
  options,
  selected,
  onPick,
}: {
  readonly label: string;
  readonly options: readonly ChipOption<T>[];
  readonly selected: T;
  readonly onPick: (value: T) => void;
}): ReactNode {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            aria-pressed={option.value === selected}
            className={cn(
              'min-h-touch rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              option.value === selected
                ? 'border-primary bg-muted text-primary'
                : 'border-border bg-card text-foreground',
            )}
            key={option.value}
            onClick={() => {
              onPick(option.value);
            }}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
