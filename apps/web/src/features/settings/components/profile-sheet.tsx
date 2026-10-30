import { DISPLAY_NAME_MAX, UpdateProfileRequestSchema, type UserDto } from '@fineapp/shared';
import { useState, type FormEvent, type ReactNode } from 'react';

import { Button, Sheet, TextField } from '../../../components/ui/index.js';
import { useUpdateProfile } from '../hooks/use-settings.js';

/**
 * Arkusz własnego profilu — nazwa wyświetlana
 * ([06 §3.12](../../../../../../plans/06-ui-views.md#312-ustawienia--settings)).
 *
 * Z nazwy powstają inicjały autora w historii (06 §3.2). Kolor awatara API przyjmuje,
 * ale ekran go nie oferuje: paleta awatarów nie ma jeszcze tokenów (15 §3), a surowe
 * kolory w interfejsie są zabronione (`Z-43`).
 */

/** Właściwości treści formularza. */
interface ProfileFormProps {
  user: UserDto;
  onSaved: () => void;
}

/**
 * Formularz profilu.
 *
 * @param props - Właściwości komponentu.
 * @param props.user - Zalogowana osoba.
 * @param props.onSaved - Wywoływane po zapisie.
 * @returns Element formularza.
 */
function ProfileForm({ user, onSaved }: ProfileFormProps): ReactNode {
  const [name, setName] = useState(user.displayName);
  const [error, setError] = useState<string | undefined>(undefined);
  const update = useUpdateProfile();

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parsed = UpdateProfileRequestSchema.safeParse({ displayName: name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    if (parsed.data.displayName === user.displayName) {
      onSaved();
      return;
    }
    update.mutate(parsed.data, {
      onSuccess: onSaved,
      onError: (failure) => {
        setError(failure.message);
      },
    });
  };

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={handleSubmit}>
      <TextField
        autoComplete="name"
        error={error}
        hint="Z niej powstają inicjały przy Twoich transakcjach."
        label="Imię lub nazwa"
        maxLength={DISPLAY_NAME_MAX}
        onChange={(value) => {
          setName(value);
          setError(undefined);
        }}
        value={name}
      />
      <Button loading={update.isPending} size="large" type="submit" variant="primary">
        Zapisz
      </Button>
    </form>
  );
}

/** Właściwości arkusza profilu. */
export interface ProfileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserDto;
}

/**
 * Arkusz profilu.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.user - Zalogowana osoba.
 * @returns Element arkusza.
 */
export function ProfileSheet({ open, onOpenChange, user }: ProfileSheetProps): ReactNode {
  return (
    <Sheet onOpenChange={onOpenChange} open={open} title="Twój profil">
      {open ? (
        <ProfileForm
          onSaved={() => {
            onOpenChange(false);
          }}
          user={user}
        />
      ) : null}
    </Sheet>
  );
}
