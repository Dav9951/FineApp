import {
  IncomeSourceKindSchema,
  type HouseholdMemberDto,
  type IncomeSourceDto,
} from '@fineapp/shared';
import { useState, type FormEvent, type ReactNode } from 'react';

import {
  Button,
  OptionGrid,
  Section,
  Sheet,
  Switch,
  TextField,
} from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { INCOME_SOURCE_KIND_LABEL } from '../../transactions/transaction-view.js';
import {
  useCreateIncomeSource,
  useDeleteIncomeSource,
  useSetIncomeSourceArchived,
  useUpdateIncomeSource,
} from '../hooks/use-income-sources.js';
import {
  emptyIncomeSourceForm,
  incomeSourceFormFrom,
  SHARED_OWNER,
  toCreateIncomeSource,
  toUpdateIncomeSource,
  withKind,
  type IncomeSourceFormErrors,
  type IncomeSourceFormState,
} from '../income-sources-view.js';

/**
 * Formularz źródła przychodu w arkuszu — nazwa, rodzaj, czyje, udział w podstawie celów;
 * przy edycji także archiwizacja i usunięcie.
 *
 * „Działania" stoją **za** `<form>`: przycisk bez `type` w formularzu wysyła go, więc
 * „Usuń" zapisywałby i zamykał arkusz zamiast pytać o potwierdzenie.
 */

const KIND_OPTIONS = IncomeSourceKindSchema.options.map((kind) => ({
  value: kind,
  label: INCOME_SOURCE_KIND_LABEL[kind],
}));

/** Właściwości treści formularza. */
interface IncomeSourceFormProps {
  source?: IncomeSourceDto;
  members: readonly HouseholdMemberDto[];
  onDone: () => void;
}

/**
 * Treść formularza.
 *
 * @param props - Właściwości komponentu.
 * @param props.source - Źródło do edycji; brak — nowe.
 * @param props.members - Domownicy do wyboru „czyje".
 * @param props.onDone - Wywoływane po zapisie, archiwizacji albo usunięciu.
 * @returns Element formularza.
 */
function IncomeSourceForm({ source, members, onDone }: IncomeSourceFormProps): ReactNode {
  const isNew = source === undefined;
  const [state, setState] = useState<IncomeSourceFormState>(() =>
    source === undefined ? emptyIncomeSourceForm() : incomeSourceFormFrom(source),
  );
  const [errors, setErrors] = useState<IncomeSourceFormErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const create = useCreateIncomeSource();
  const update = useUpdateIncomeSource();
  const archive = useSetIncomeSourceArchived();
  const remove = useDeleteIncomeSource();
  const busy = create.isPending || update.isPending || archive.isPending || remove.isPending;

  const onError = (error: Error): void => {
    setFormError(error.message);
    if (error instanceof ApiRequestError) {
      const name = error.fieldErrors().name;
      if (name !== undefined) setErrors({ name });
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    if (source === undefined) {
      const result = toCreateIncomeSource(state);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      create.mutate(result.body, { onSuccess: onDone, onError });
      return;
    }
    const result = toUpdateIncomeSource(source, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (Object.keys(result.body).length === 0) {
      onDone();
      return;
    }
    update.mutate({ id: source.id, body: result.body }, { onSuccess: onDone, onError });
  };

  const ownerOptions = [
    { value: SHARED_OWNER, label: 'Wspólne' },
    ...members.map((member) => ({ value: member.id, label: member.displayName })),
  ];

  return (
    <>
      <form className="flex flex-col gap-5" noValidate onSubmit={handleSubmit}>
        <TextField
          autoFocus={isNew}
          error={errors.name}
          label="Nazwa"
          maxLength={60}
          onChange={(value) => {
            setState((current) => ({ ...current, name: value }));
            setErrors({});
          }}
          placeholder="np. Pensja Adama"
          value={state.name}
        />

        <OptionGrid
          legend="Rodzaj"
          onChange={(kind) => {
            setState((current) => withKind(current, kind, isNew));
          }}
          options={KIND_OPTIONS}
          value={state.kind}
        />

        <OptionGrid
          legend="Czyje"
          onChange={(owner) => {
            setState((current) => ({ ...current, owner }));
          }}
          options={ownerOptions}
          value={state.owner}
        />

        <div className="flex min-h-touch items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-sm">Liczy się do celów procentowych</span>
            <span className="text-caption text-muted-foreground">
              Wyłącz dla zwrotów i przepływów, które nie są dochodem — nie zawyżą wtedy kwot „10% na
              oszczędności".
            </span>
          </span>
          <Switch
            checked={state.countsTowardAllocation}
            label="Liczy się do celów procentowych"
            onCheckedChange={(checked) => {
              setState((current) => ({ ...current, countsTowardAllocation: checked }));
            }}
          />
        </div>

        {formError === undefined ? null : (
          <p className="text-sm text-danger" role="alert">
            {formError}
          </p>
        )}

        <Button
          disabled={busy && !(create.isPending || update.isPending)}
          loading={create.isPending || update.isPending}
          size="large"
          type="submit"
          variant="primary"
        >
          {isNew ? 'Dodaj źródło' : 'Zapisz zmiany'}
        </Button>
      </form>

      {source === undefined ? null : (
        <Section title="Działania">
          <div className="flex flex-col gap-2">
            <Button
              disabled={busy}
              loading={archive.isPending}
              onClick={() => {
                setFormError(undefined);
                archive.mutate(
                  { id: source.id, archived: !source.isArchived },
                  { onSuccess: onDone, onError },
                );
              }}
              variant="ghost"
            >
              {source.isArchived ? 'Przywróć z archiwum' : 'Archiwizuj'}
            </Button>
            {confirmDelete ? (
              <div className="flex flex-col gap-2 rounded-md border border-danger p-3">
                <p className="text-sm">
                  Usunąć „{source.name}” na stałe? Źródła z przychodami nie da się usunąć — wtedy je
                  zarchiwizuj.
                </p>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      setConfirmDelete(false);
                    }}
                    variant="ghost"
                  >
                    Anuluj
                  </Button>
                  <Button
                    className="flex-1"
                    loading={remove.isPending}
                    onClick={() => {
                      setFormError(undefined);
                      remove.mutate(source.id, {
                        onSuccess: onDone,
                        onError: (error) => {
                          setConfirmDelete(false);
                          onError(error);
                        },
                      });
                    }}
                    variant="danger"
                  >
                    Usuń
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                disabled={busy}
                onClick={() => {
                  setConfirmDelete(true);
                }}
                variant="ghost"
              >
                Usuń
              </Button>
            )}
          </div>
        </Section>
      )}
    </>
  );
}

/** Właściwości arkusza źródła. */
export interface IncomeSourceFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: IncomeSourceDto;
  members: readonly HouseholdMemberDto[];
}

/**
 * Arkusz nowego albo edytowanego źródła.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.source - Źródło do edycji.
 * @param props.members - Domownicy.
 * @returns Element arkusza.
 */
export function IncomeSourceFormSheet({
  open,
  onOpenChange,
  source,
  members,
}: IncomeSourceFormSheetProps): ReactNode {
  return (
    <Sheet
      onOpenChange={onOpenChange}
      open={open}
      title={source === undefined ? 'Nowe źródło przychodu' : 'Źródło przychodu'}
    >
      {open ? (
        <IncomeSourceForm
          key={source?.id ?? 'new'}
          members={members}
          onDone={() => {
            onOpenChange(false);
          }}
          {...(source === undefined ? {} : { source })}
        />
      ) : null}
    </Sheet>
  );
}
