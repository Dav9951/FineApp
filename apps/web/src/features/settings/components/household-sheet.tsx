import { todayInTimezone, type HouseholdDto } from '@fineapp/shared';
import { useState, type FormEvent, type ReactNode } from 'react';

import { Button, OptionGrid, Sheet, TextField } from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { useUpdateHousehold } from '../hooks/use-settings.js';
import {
  backPostingLabel,
  backPostingOptions,
  deviceTimeZone,
  householdFormFrom,
  limitChangeNote,
  postingFromLabel,
  toHouseholdPatch,
  type HouseholdFormErrors,
  type HouseholdFormState,
} from '../settings-view.js';

/**
 * Arkusz ustawień gospodarstwa: nazwa, strefa czasowa, limit księgowania wstecz
 * ([06 §3.12](../../../../../../plans/06-ui-views.md#312-ustawienia--settings)).
 *
 * Waluty i dnia startu miesiąca tu nie ma — w v1 są stałe (ADR-006, ADR-007), więc
 * ekran pokazuje je tylko do odczytu. Skutek zmiany limitu widać **przed** zapisem:
 * obniżenie zamyka miesiące, a tego nie cofa się bez pamiętania, co się zmieniło.
 */

/** Właściwości treści formularza. */
interface HouseholdFormProps {
  household: HouseholdDto;
  onSaved: () => void;
}

/**
 * Formularz gospodarstwa — montowany od nowa przy każdym otwarciu arkusza.
 *
 * @param props - Właściwości komponentu.
 * @param props.household - Zapisane ustawienia.
 * @param props.onSaved - Wywoływane po zapisie.
 * @returns Element formularza.
 */
function HouseholdForm({ household, onSaved }: HouseholdFormProps): ReactNode {
  const [state, setState] = useState<HouseholdFormState>(() => householdFormFrom(household));
  const [errors, setErrors] = useState<HouseholdFormErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const update = useUpdateHousehold();
  const today = todayInTimezone(household.timezone);
  const device = deviceTimeZone();

  const set = <K extends keyof HouseholdFormState>(
    field: K,
    value: HouseholdFormState[K],
  ): void => {
    setState((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    const result = toHouseholdPatch(household, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (Object.keys(result.body).length === 0) {
      onSaved();
      return;
    }
    update.mutate(result.body, {
      onSuccess: onSaved,
      onError: (error) => {
        setFormError(error.message);
        if (error instanceof ApiRequestError) {
          const fields = error.fieldErrors();
          setErrors({
            name: fields.name,
            timezone: fields.timezone,
            backPostingLimitMonths: fields.backPostingLimitMonths,
          });
        }
      },
    });
  };

  const note = limitChangeNote(
    today,
    household.backPostingLimitMonths,
    state.backPostingLimitMonths,
  );

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={handleSubmit}>
      <TextField
        error={errors.name}
        label="Nazwa gospodarstwa"
        maxLength={60}
        onChange={(value) => {
          set('name', value);
        }}
        value={state.name}
      />

      <div className="flex flex-col gap-2">
        <TextField
          error={errors.timezone}
          hint="Od strefy zależy, kiedy zaczyna się „dziś” i nowy miesiąc."
          label="Strefa czasowa"
          onChange={(value) => {
            set('timezone', value);
          }}
          placeholder="Europe/Warsaw"
          value={state.timezone}
        />
        {device !== undefined && device !== state.timezone ? (
          <Button
            className="self-start"
            onClick={() => {
              set('timezone', device);
            }}
            size="small"
            type="button"
            variant="link"
          >
            Użyj strefy tego urządzenia ({device})
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <OptionGrid
          legend="Księgowanie wstecz"
          onChange={(value) => {
            set('backPostingLimitMonths', Number(value));
          }}
          options={backPostingOptions(household.backPostingLimitMonths).map((limit) => ({
            value: String(limit),
            label: limit === 0 ? 'Brak' : String(limit),
          }))}
          value={String(state.backPostingLimitMonths)}
        />
        <p className="text-caption text-muted-foreground">
          Księgowanie {postingFromLabel(today, state.backPostingLimitMonths)} (
          {backPostingLabel(state.backPostingLimitMonths)}). Starsze miesiące są zamknięte: ich kwot
          nie da się zmienić, tylko opisy.
        </p>
        {note === undefined ? null : (
          <p className="text-caption text-warning" role="status">
            {note}
          </p>
        )}
        {errors.backPostingLimitMonths === undefined ? null : (
          <p className="text-caption text-danger" role="alert">
            {errors.backPostingLimitMonths}
          </p>
        )}
      </div>

      {formError === undefined ? null : (
        <p className="text-sm text-danger" role="alert">
          {formError}
        </p>
      )}

      <Button loading={update.isPending} size="large" type="submit" variant="primary">
        Zapisz zmiany
      </Button>
    </form>
  );
}

/** Właściwości arkusza gospodarstwa. */
export interface HouseholdSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  household: HouseholdDto;
}

/**
 * Arkusz z formularzem gospodarstwa.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.household - Zapisane ustawienia.
 * @returns Element arkusza.
 */
export function HouseholdSheet({ open, onOpenChange, household }: HouseholdSheetProps): ReactNode {
  return (
    <Sheet onOpenChange={onOpenChange} open={open} title="Gospodarstwo">
      {open ? (
        <HouseholdForm
          household={household}
          onSaved={() => {
            onOpenChange(false);
          }}
        />
      ) : null}
    </Sheet>
  );
}
