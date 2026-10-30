import { todayInTimezone, type AccountDto, type AllocationClass } from '@fineapp/shared';
import { ChevronDown } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';

import { Button, OptionGrid, Sheet, Switch, TextField } from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { cn } from '../../../lib/cn.js';
import { useAuth } from '../../auth/auth-context.js';
import {
  accountFormFrom,
  effectiveAllocationClass,
  emptyAccountForm,
  formErrorsFromRequest,
  toCreateRequest,
  toUpdateRequest,
  type AccountFormErrors,
  type AccountFormState,
} from '../account-form-state.js';
import {
  ACCOUNT_TYPE_ICON,
  ACCOUNT_TYPE_LABEL,
  ACCOUNT_TYPE_ORDER,
  ALLOCATION_CLASS_ORDER,
  ALLOCATION_CLASS_SHORT_LABEL,
} from '../accounts-view.js';
import { useCreateAccount, useUpdateAccount } from '../hooks/use-accounts.js';

/**
 * Formularz konta w arkuszu ([06 §3.7](../../../../../../plans/06-ui-views.md#37-konta--accounts)).
 *
 * Krótki z założenia: nazwa, rodzaj, saldo początkowe, data. Pula, instytucja i udział
 * w majątku netto siedzą w „Zaawansowanych" — pula podpowiada się z rodzaju i większość
 * kont nigdy jej nie zmienia.
 */

/** Opcje rodzaju konta z ikonami. */
const TYPE_OPTIONS = ACCOUNT_TYPE_ORDER.map((type) => {
  const Icon = ACCOUNT_TYPE_ICON[type];
  return {
    value: type,
    label: ACCOUNT_TYPE_LABEL[type],
    icon: <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />,
  };
});

/** Opcje puli. */
const CLASS_OPTIONS = ALLOCATION_CLASS_ORDER.map((allocationClass) => ({
  value: allocationClass,
  label: ALLOCATION_CLASS_SHORT_LABEL[allocationClass],
}));

/**
 * Zamienia błąd zapisu na komunikat i błędy pól.
 *
 * @param error - Błąd mutacji.
 * @returns Komunikat ogólny i błędy pól.
 */
function describeSaveError(error: unknown): { message: string; fields: AccountFormErrors } {
  if (error instanceof ApiRequestError) {
    return { message: error.message, fields: formErrorsFromRequest(error.fieldErrors()) };
  }
  return {
    message: error instanceof Error ? error.message : 'Nie udało się zapisać konta.',
    fields: {},
  };
}

/** Właściwości treści formularza. */
interface AccountFormProps {
  /** Konto do edycji; brak = nowe konto. */
  account?: AccountDto;
  onSaved: (account: AccountDto) => void;
}

/**
 * Treść formularza — montowana od nowa przy każdym otwarciu arkusza, więc stan
 * nie przecieka między „Nowe konto" a edycją innego.
 *
 * @param props - Właściwości komponentu.
 * @param props.account - Konto do edycji.
 * @param props.onSaved - Wywoływane po udanym zapisie.
 * @returns Element formularza.
 */
function AccountForm({ account, onSaved }: AccountFormProps): ReactNode {
  const { household } = useAuth();
  const [state, setState] = useState<AccountFormState>(() =>
    account === undefined
      ? emptyAccountForm(todayInTimezone(household?.timezone ?? 'Europe/Warsaw'))
      : accountFormFrom(account),
  );
  const [errors, setErrors] = useState<AccountFormErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [advancedOpen, setAdvancedOpen] = useState(
    () => account !== undefined && (account.institution !== null || !account.includeInNetWorth),
  );
  const create = useCreateAccount();
  const update = useUpdateAccount();
  const pending = create.isPending || update.isPending;

  /**
   * Zmienia jedno pole i czyści jego błąd — komunikat przy poprawianym polu tylko
   * przeszkadza.
   *
   * @param field - Pole formularza.
   * @param value - Nowa wartość.
   */
  const set = <K extends keyof AccountFormState>(field: K, value: AccountFormState[K]): void => {
    setState((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    const handlers = {
      onSuccess: onSaved,
      onError: (error: unknown) => {
        const described = describeSaveError(error);
        setFormError(described.message);
        setErrors(described.fields);
      },
    };

    if (account === undefined) {
      const result = toCreateRequest(state);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      create.mutate(result.body, handlers);
      return;
    }

    const result = toUpdateRequest(account, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (Object.keys(result.body).length === 0) {
      onSaved(account);
      return;
    }
    update.mutate({ accountId: account.id, body: result.body }, handlers);
  };

  const allocationClass: AllocationClass = effectiveAllocationClass(state, account);

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={handleSubmit}>
      <TextField
        autoFocus={account === undefined}
        error={errors.name}
        label="Nazwa"
        maxLength={60}
        onChange={(value) => {
          set('name', value);
        }}
        placeholder="np. ROR mBank"
        value={state.name}
      />

      <OptionGrid
        legend="Rodzaj"
        onChange={(value) => {
          set('type', value);
        }}
        options={TYPE_OPTIONS}
        value={state.type}
      />

      <div className="flex flex-col gap-2">
        <TextField
          error={errors.openingBalanceText}
          hint="Ile jest na koncie w dniu poniżej. Wcześniejszych operacji nie trzeba wpisywać."
          inputMode="decimal"
          label="Saldo początkowe (zł)"
          onChange={(value) => {
            set('openingBalanceText', value);
          }}
          placeholder="0,00"
          value={state.openingBalanceText}
        />
        <div className="flex min-h-touch items-center justify-between gap-3">
          <span className="text-sm">Saldo ujemne (debet, karta kredytowa)</span>
          <Switch
            checked={state.negative}
            label="Saldo ujemne"
            onCheckedChange={(checked) => {
              set('negative', checked);
            }}
          />
        </div>
      </div>

      <TextField
        error={errors.openingBalanceOn}
        label="Na dzień"
        onChange={(value) => {
          set('openingBalanceOn', value);
        }}
        type="date"
        value={state.openingBalanceOn}
      />

      <div className="border-t border-border">
        <button
          aria-expanded={advancedOpen}
          className={cn(
            'flex min-h-touch w-full items-center justify-between gap-2 text-sm font-medium',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          onClick={() => {
            setAdvancedOpen((open) => !open);
          }}
          type="button"
        >
          Zaawansowane
          <ChevronDown
            aria-hidden="true"
            className={cn('h-5 w-5 transition-transform', advancedOpen ? 'rotate-180' : '')}
            strokeWidth={1.5}
          />
        </button>

        {advancedOpen ? (
          <div className="flex flex-col gap-5 pb-2 pt-2">
            <div className="flex flex-col gap-1">
              <OptionGrid
                legend="Pula"
                onChange={(value) => {
                  set('allocationOverride', value);
                }}
                options={CLASS_OPTIONS}
                value={allocationClass}
              />
              <p className="text-caption text-muted-foreground">
                Decyduje, czy przelew na to konto liczy się do celów jako oszczędzanie lub
                inwestowanie. Domyślnie wynika z rodzaju — zmień, gdy np. rachunek bieżący służy
                jako poduszka finansowa.
              </p>
            </div>

            <TextField
              error={errors.institution}
              label="Bank lub dom maklerski"
              maxLength={60}
              onChange={(value) => {
                set('institution', value);
              }}
              placeholder="np. mBank"
              value={state.institution}
            />

            <div className="flex min-h-touch items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-sm">Wliczaj do majątku netto</span>
                <span className="text-caption text-muted-foreground">
                  Wyłącz np. dla konta firmowego, które nie jest pieniędzmi domu.
                </span>
              </span>
              <Switch
                checked={state.includeInNetWorth}
                label="Wliczaj do majątku netto"
                onCheckedChange={(checked) => {
                  set('includeInNetWorth', checked);
                }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {formError === undefined ? null : (
        <p className="text-sm text-danger" role="alert">
          {formError}
        </p>
      )}

      <Button loading={pending} size="large" type="submit" variant="primary">
        {account === undefined ? 'Dodaj konto' : 'Zapisz zmiany'}
      </Button>
    </form>
  );
}

/** Właściwości arkusza formularza konta. */
export interface AccountFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Konto do edycji; brak = nowe konto. */
  account?: AccountDto;
  /** Wywoływane po udanym zapisie, zanim arkusz się zamknie. */
  onSaved?: (account: AccountDto) => void;
}

/**
 * Arkusz z formularzem nowego albo edytowanego konta.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.account - Konto do edycji.
 * @param props.onSaved - Wywoływane po zapisie.
 * @returns Element arkusza.
 */
export function AccountFormSheet({
  open,
  onOpenChange,
  account,
  onSaved,
}: AccountFormSheetProps): ReactNode {
  return (
    <Sheet
      onOpenChange={onOpenChange}
      open={open}
      title={account === undefined ? 'Nowe konto' : 'Edytuj konto'}
    >
      {open ? (
        <AccountForm
          account={account}
          key={account?.id ?? 'new'}
          onSaved={(saved) => {
            onSaved?.(saved);
            onOpenChange(false);
          }}
        />
      ) : null}
    </Sheet>
  );
}
