import {
  parseAmountToMinor,
  type DocumentItemDto,
  type UpdateDocumentItemRequest,
} from '@fineapp/shared';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { Button, Field, Sheet, TextField } from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { useCategoryTree } from '../../categories/hooks/use-categories.js';
import { CategoryPicker } from '../../transactions/components/transaction-pickers.js';
import { categoryLabel } from '../../transactions/transaction-view.js';
import { useUpdateDocumentItem } from '../hooks/use-documents.js';

/**
 * Arkusz korekty pozycji: opis, kwota, kategoria (04 §13 `PATCH /items/:itemId`).
 *
 * „Wybierz inną" i „zmień kategorię" otwierają arkusz od razu na wyborze kategorii —
 * to jedyne, co wtedy trzeba poprawić. Rodzaj kategorii wynika z kierunku pozycji:
 * obciążenie — wydatek, uznanie — przychód.
 */

/** Pozycja otwarta w arkuszu. */
export interface ItemSheetTarget {
  readonly item: DocumentItemDto;
  readonly view: 'edit' | 'category';
}

/**
 * Kwota pozycji jako tekst pola: `12,50`.
 *
 * @param amountMinor - Kwota w groszach.
 * @returns Tekst.
 */
function amountText(amountMinor: number): string {
  return `${String(Math.trunc(amountMinor / 100))},${String(amountMinor % 100).padStart(2, '0')}`;
}

/**
 * Arkusz pozycji.
 *
 * @param props - Właściwości komponentu.
 * @param props.documentId - Dokument.
 * @param props.target - Pozycja i widok albo `null` (zamknięty).
 * @param props.onClose - Zamknięcie.
 * @returns Element arkusza.
 */
export function ItemSheet({
  documentId,
  target,
  onClose,
}: {
  documentId: string;
  target: ItemSheetTarget | null;
  onClose: () => void;
}): ReactNode {
  const update = useUpdateDocumentItem(documentId);
  const kind = target?.item.direction === 'inflow' ? 'income' : 'expense';
  const tree = useCategoryTree(kind, target !== null);
  const [view, setView] = useState<'edit' | 'category'>('edit');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target === null) return;
    setView(target.view);
    setDescription(target.item.description);
    setAmount(amountText(target.item.amountMinor));
    setError(null);
  }, [target]);

  if (target === null) {
    return (
      <Sheet onOpenChange={onClose} open={false} title="Pozycja">
        {null}
      </Sheet>
    );
  }
  const { item } = target;

  /**
   * Zapisuje zmiany i zamyka arkusz.
   *
   * @param body - Zmienione pola.
   */
  const save = async (body: UpdateDocumentItemRequest): Promise<void> => {
    setError(null);
    try {
      await update.mutateAsync({ itemId: item.id, body });
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Nie udało się zapisać zmiany.');
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const amountMinor = parseAmountToMinor(amount.trim());
    if (amountMinor === null || amountMinor <= 0) {
      setError('Kwota musi być większa od zera.');
      return;
    }
    const body: UpdateDocumentItemRequest = {
      ...(description.trim() !== item.description ? { description: description.trim() } : {}),
      ...(amountMinor !== item.amountMinor ? { amountMinor } : {}),
    };
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    void save(body);
  };

  const categoryName =
    item.suggestedCategoryId === null
      ? item.suggestedCategoryName === null
        ? 'Bez kategorii'
        : `Nowa: ${item.suggestedCategoryName}`
      : (categoryLabel(tree.data ?? [], item.suggestedCategoryId) ?? '…');

  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
      title={view === 'category' ? 'Kategoria pozycji' : 'Popraw pozycję'}
    >
      {view === 'category' ? (
        <CategoryPicker
          kind={kind}
          onBack={() => {
            if (target.view === 'category') onClose();
            else setView('edit');
          }}
          onSelect={(categoryId) => {
            void save({ suggestedCategoryId: categoryId });
          }}
          selectedId={item.suggestedCategoryId}
        />
      ) : (
        <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
          <TextField label="Opis" maxLength={200} onChange={setDescription} value={description} />
          <TextField
            hint={item.direction === 'inflow' ? 'Rabat albo zwrot — pomniejsza sumę.' : undefined}
            inputMode="decimal"
            label="Kwota (zł)"
            onChange={setAmount}
            value={amount}
          />
          <Field
            label="Kategoria"
            onOpen={() => {
              setView('category');
            }}
            value={categoryName}
          />
          {error === null ? null : (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <Button loading={update.isPending} size="large" type="submit">
            Zapisz
          </Button>
        </form>
      )}
    </Sheet>
  );
}
