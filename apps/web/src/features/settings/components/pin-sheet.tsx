import { useState, type FormEvent, type ReactNode } from 'react';

import { Button, Sheet, TextField } from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { pluralPl } from '../../../lib/format.js';
import { useChangePin } from '../hooks/use-settings.js';
import { pinFormErrors, type PinFormErrors, type PinFormState } from '../settings-view.js';

/**
 * Arkusz zmiany PIN-u ([09 §2.3](../../../../../../plans/09-security-auth.md)).
 *
 * Pola są maskowane, a klawiatura numeryczna. Reguły słabych PIN-ów sprawdzamy przed
 * wysłaniem tą samą funkcją co serwer — odrzucenie „123456” po stronie API kosztowałoby
 * pełne haszowanie argon2 i dawało komunikat dopiero po sekundzie.
 */

const EMPTY: PinFormState = { currentPin: '', newPin: '', confirmPin: '' };

/** Właściwości treści formularza. */
interface PinFormProps {
  onDone: (loggedOut: number) => void;
}

/**
 * Formularz PIN-u.
 *
 * @param props - Właściwości komponentu.
 * @param props.onDone - Wywoływane po zmianie z liczbą wylogowanych urządzeń.
 * @returns Element formularza.
 */
function PinForm({ onDone }: PinFormProps): ReactNode {
  const [state, setState] = useState<PinFormState>(EMPTY);
  const [errors, setErrors] = useState<PinFormErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const change = useChangePin();

  const set = (field: keyof PinFormState, value: string): void => {
    // Tylko cyfry — klawiatura numeryczna na desktopie nie istnieje.
    setState((current) => ({ ...current, [field]: value.replace(/\D/g, '').slice(0, 8) }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    const found = pinFormErrors(state);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    change.mutate(
      { currentPin: state.currentPin, newPin: state.newPin },
      {
        onSuccess: (ack) => {
          onDone(ack.affected);
        },
        onError: (error) => {
          if (error instanceof ApiRequestError && error.status === 401) {
            setErrors({ currentPin: error.message });
            return;
          }
          const fields = error instanceof ApiRequestError ? error.fieldErrors() : {};
          if (fields.newPin !== undefined) setErrors({ newPin: fields.newPin });
          else setFormError(error.message);
        },
      },
    );
  };

  const field = (key: keyof PinFormState, label: string, hint?: string): ReactNode => (
    <TextField
      autoComplete={key === 'currentPin' ? 'current-password' : 'new-password'}
      error={errors[key]}
      hint={hint}
      inputMode="numeric"
      label={label}
      maxLength={8}
      onChange={(value) => {
        set(key, value);
      }}
      type="password"
      value={state[key]}
    />
  );

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={handleSubmit}>
      {field('currentPin', 'Obecny PIN')}
      {field('newPin', 'Nowy PIN', '6–8 cyfr, bez ciągów w rodzaju 123456 i powtórzeń.')}
      {field('confirmPin', 'Powtórz nowy PIN')}
      <p className="text-caption text-muted-foreground">
        Po zmianie pozostałe urządzenia zostaną wylogowane.
      </p>
      {formError === undefined ? null : (
        <p className="text-sm text-danger" role="alert">
          {formError}
        </p>
      )}
      <Button loading={change.isPending} size="large" type="submit" variant="primary">
        Zmień PIN
      </Button>
    </form>
  );
}

/**
 * Komunikat po zmianie PIN-u.
 *
 * @param loggedOut - Liczba wylogowanych urządzeń.
 * @returns Tekst do pokazania na ekranie.
 */
export function pinChangedMessage(loggedOut: number): string {
  if (loggedOut === 0) return 'PIN zmieniony.';
  return `PIN zmieniony. Wylogowano ${String(loggedOut)} ${pluralPl(
    loggedOut,
    'inne urządzenie',
    'inne urządzenia',
    'innych urządzeń',
  )}.`;
}

/** Właściwości arkusza PIN-u. */
export interface PinSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wywoływane po zmianie — ekran pokazuje potwierdzenie. */
  onChanged: (message: string) => void;
}

/**
 * Arkusz zmiany PIN-u.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.onChanged - Wywoływane po zmianie.
 * @returns Element arkusza.
 */
export function PinSheet({ open, onOpenChange, onChanged }: PinSheetProps): ReactNode {
  return (
    <Sheet onOpenChange={onOpenChange} open={open} title="Zmiana PIN-u">
      {open ? (
        <PinForm
          onDone={(loggedOut) => {
            onChanged(pinChangedMessage(loggedOut));
            onOpenChange(false);
          }}
        />
      ) : null}
    </Sheet>
  );
}
