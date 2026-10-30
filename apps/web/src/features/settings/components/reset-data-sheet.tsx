import type { ResetDataResult } from '@fineapp/shared';
import { useState, type FormEvent, type ReactNode } from 'react';

import { Button, Sheet, TextField } from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { pluralPl } from '../../../lib/format.js';
import { useResetData } from '../hooks/use-settings.js';

/**
 * Arkusz usunięcia wszystkich danych gospodarstwa
 * ([ADR-072](../../../../../../plans/14-decisions-log.md#adr-072), 06 §3.12).
 *
 * Operacja nieodwracalna, więc dwa kroki: wiersz w ustawieniach tylko otwiera arkusz,
 * a jedyny przycisk `danger` siedzi tu, za PIN-em. Arkusz mówi wprost, co zostaje —
 * „wszystkie dane" bez tej listy brzmi, jakby znikały też konta logowania.
 */

/**
 * Komunikat po usunięciu danych.
 *
 * @param result - Liczby usuniętych wierszy.
 * @returns Tekst do pokazania na ekranie ustawień.
 */
export function resetDoneMessage(result: ResetDataResult): string {
  const { transactions, accounts } = result.deleted;
  if (transactions === 0 && accounts === 0) return 'Dane usunięte — nie było czego usuwać.';
  return `Dane usunięte: ${String(transactions)} ${pluralPl(
    transactions,
    'transakcja',
    'transakcje',
    'transakcji',
  )}, ${String(accounts)} ${pluralPl(accounts, 'konto', 'konta', 'kont')}.`;
}

/** Właściwości formularza. */
interface ResetFormProps {
  onDone: (result: ResetDataResult) => void;
}

/**
 * Formularz potwierdzenia PIN-em.
 *
 * @param props - Właściwości komponentu.
 * @param props.onDone - Wywoływane po usunięciu z liczbami usuniętych wierszy.
 * @returns Element formularza.
 */
function ResetForm({ onDone }: ResetFormProps): ReactNode {
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const reset = useResetData();

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    if (pin.length < 6) {
      setPinError('Podaj swój PIN (6–8 cyfr).');
      return;
    }
    reset.mutate(
      { pin },
      {
        onSuccess: onDone,
        onError: (error) => {
          if (error instanceof ApiRequestError && error.status === 401) {
            setPinError(error.message);
            return;
          }
          setFormError(error.message);
        },
      },
    );
  };

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2 text-sm">
        <p>
          Znikną konta, transakcje (także z kosza), cele, zobowiązania, pozycje stałe, planowane
          wydatki, plany budżetu, rozkład procentowy, źródła przychodu, własne kategorie i
          zeskanowane dokumenty razem ze zdjęciami.
        </p>
        <p className="text-muted-foreground">
          Zostają domownicy i ich PIN-y, ustawienia gospodarstwa i kategorie domyślne.
        </p>
        <p className="font-medium text-danger">
          Tego nie da się cofnąć. Jeśli chcesz zachować dane, najpierw pobierz kopię JSON.
        </p>
      </div>
      <TextField
        autoComplete="current-password"
        error={pinError}
        inputMode="numeric"
        label="Twój PIN"
        maxLength={8}
        onChange={(value) => {
          setPin(value.replace(/\D/g, '').slice(0, 8));
          setPinError(undefined);
        }}
        type="password"
        value={pin}
      />
      {formError === undefined ? null : (
        <p className="text-sm text-danger" role="alert">
          {formError}
        </p>
      )}
      <Button loading={reset.isPending} size="large" type="submit" variant="danger">
        Usuń wszystkie dane
      </Button>
    </form>
  );
}

/** Właściwości arkusza. */
export interface ResetDataSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wywoływane po usunięciu — ekran pokazuje potwierdzenie. */
  onDone: (message: string) => void;
}

/**
 * Arkusz usunięcia wszystkich danych.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.onDone - Wywoływane po usunięciu.
 * @returns Element arkusza.
 */
export function ResetDataSheet({ open, onOpenChange, onDone }: ResetDataSheetProps): ReactNode {
  return (
    <Sheet onOpenChange={onOpenChange} open={open} title="Usunąć wszystkie dane?">
      {open ? (
        <ResetForm
          onDone={(result) => {
            onDone(resetDoneMessage(result));
            onOpenChange(false);
          }}
        />
      ) : null}
    </Sheet>
  );
}
