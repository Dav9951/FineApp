import { useState, type FormEvent, type ReactNode } from 'react';

import { Button, Sheet, TextField } from '../../../components/ui/index.js';

/**
 * Arkusz z jedną nazwą — nowa lista, zmiana nazwy, kopia listy (06 §3.15).
 */

/** Właściwości arkusza nazwy. */
export interface ShoppingNameSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly submitLabel: string;
  readonly initialName: string;
  /** Zapis; obietnica odrzucona — komunikat pod polem. */
  readonly onSubmit: (name: string) => Promise<unknown>;
}

/**
 * Arkusz nazwy listy.
 *
 * @param props - Właściwości komponentu.
 * @returns Element arkusza.
 */
export function ShoppingNameSheet(props: ShoppingNameSheetProps): ReactNode {
  return (
    <Sheet onOpenChange={props.onOpenChange} open={props.open} title={props.title}>
      {props.open ? <NameForm {...props} /> : null}
    </Sheet>
  );
}

/**
 * Treść arkusza — montowana od nowa przy każdym otwarciu.
 *
 * @param props - Właściwości komponentu.
 * @param props.initialName - Nazwa startowa.
 * @param props.submitLabel - Etykieta przycisku.
 * @param props.onSubmit - Zapis.
 * @param props.onOpenChange - Zamknięcie.
 * @returns Element formularza.
 */
function NameForm({
  initialName,
  submitLabel,
  onSubmit,
  onOpenChange,
}: ShoppingNameSheetProps): ReactNode {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('Podaj nazwę listy');
      return;
    }
    setSaving(true);
    onSubmit(trimmed)
      .then(() => {
        onOpenChange(false);
      })
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <TextField
        autoFocus
        error={error}
        label="Nazwa listy"
        maxLength={60}
        onChange={setName}
        placeholder="np. Decathlon"
        value={name}
      />
      <Button loading={saving} size="large" type="submit">
        {submitLabel}
      </Button>
    </form>
  );
}
