import type { ReactNode } from 'react';

import { Button, Sheet } from '../../../components/ui/index.js';

/**
 * Potwierdzenie usunięcia listy — jedyna nieodwracalna operacja list zakupów
 * (15 §4: przycisk `danger` zawsze z potwierdzeniem).
 */

/** Właściwości arkusza potwierdzenia. */
export interface ShoppingConfirmSheetProps {
  /** Nazwa listy do usunięcia; `null` — arkusz zamknięty. */
  readonly listName: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/**
 * Arkusz „Usunąć listę?".
 *
 * @param props - Właściwości komponentu.
 * @param props.listName - Nazwa listy albo `null`.
 * @param props.onCancel - Rezygnacja.
 * @param props.onConfirm - Potwierdzenie.
 * @returns Element arkusza.
 */
export function ShoppingConfirmSheet({
  listName,
  onCancel,
  onConfirm,
}: ShoppingConfirmSheetProps): ReactNode {
  return (
    <Sheet
      description="Pozycje listy znikną razem z nią. Tego nie da się cofnąć."
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      open={listName !== null}
      title={`Usunąć „${listName ?? ''}”?`}
    >
      <div className="flex flex-col gap-2">
        <Button onClick={onConfirm} size="large" variant="danger">
          Usuń listę
        </Button>
        <Button onClick={onCancel} size="large" variant="ghost">
          Zostaw
        </Button>
      </div>
    </Sheet>
  );
}
