import { todayInTimezone, type LiabilityDto } from '@fineapp/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Button,
  Field,
  OptionGrid,
  Sheet,
  Switch,
  TextField,
} from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { useAuth } from '../../auth/auth-context.js';
import { useCategoryTree } from '../../categories/hooks/use-categories.js';
import {
  AccountPicker,
  CategoryPicker,
} from '../../transactions/components/transaction-pickers.js';
import { categoryLabel } from '../../transactions/transaction-view.js';
import { useCreateLiability, useUpdateLiability } from '../hooks/use-liabilities.js';
import {
  LIABILITY_KIND_ICON,
  LIABILITY_KIND_LABEL,
  LIABILITY_KIND_ORDER,
} from '../liabilities-view.js';
import {
  derivedField,
  editLinked,
  emptyLiabilityForm,
  formErrorsFromRequest,
  liabilityFormFrom,
  installmentBreakdown,
  linkedValues,
  toCreateRequest,
  toUpdateRequest,
  type LiabilityFormErrors,
  type LiabilityFormState,
  type LinkedField,
} from '../liability-form-state.js';

/**
 * Formularz zobowiązania w arkuszu
 * ([06 §3.8](../../../../../../plans/06-ui-views.md#38-zobowiązania--liabilities), `F4-6`).
 *
 * Trzy pola z wymagania #2 — pozostała kwota, rata, liczba rat — są powiązane: pole
 * wyliczane ma podpis „wyliczone" i wartość z dwóch pozostałych, a wpisanie w nie wartości
 * przenosi wyliczanie na pole dotknięte najdawniej. Przy nowym zobowiązaniu przełącznik
 * „Utwórz pozycję cykliczną na ratę" jest domyślnie włączony.
 */

/** Opcje rodzaju z ikonami. */
const KIND_OPTIONS = LIABILITY_KIND_ORDER.map((kind) => {
  const Icon = LIABILITY_KIND_ICON[kind];
  return {
    value: kind,
    label: LIABILITY_KIND_LABEL[kind],
    icon: <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />,
  };
});

/** Etykiety pól powiązanych. */
const LINKED_LABEL: Readonly<Record<LinkedField, string>> = {
  remaining: 'Pozostało do spłaty (zł)',
  monthly: 'Miesięczna rata (zł)',
  installments: 'Liczba rat',
};

/** Pole stanu z tekstem pola powiązanego i błędem. */
/**
 * Podpis pola wyliczanego — z rozpisaniem rat, gdy ostatnia jest niepełna.
 *
 * @param breakdown - Wynik `installmentBreakdown` albo `null`.
 * @returns Tekst podpisu.
 */
function derivedHint(breakdown: string | null): string {
  const base = 'ⓘ wyliczone z dwóch pozostałych — wpisz, żeby zmienić';
  return breakdown === null ? base : `ⓘ ${breakdown} · wyliczone — wpisz, żeby zmienić`;
}

const LINKED_TEXT: Readonly<
  Record<LinkedField, 'remainingText' | 'monthlyText' | 'installmentsText'>
> = { remaining: 'remainingText', monthly: 'monthlyText', installments: 'installmentsText' };

/** Widok arkusza: formularz albo picker. */
type View = 'form' | 'account' | 'category';

/** Właściwości treści formularza. */
interface LiabilityFormProps {
  /** Zobowiązanie do edycji; brak = nowe. */
  liability?: LiabilityDto;
  onSaved: (liability: LiabilityDto) => void;
}

/**
 * Treść formularza — montowana od nowa przy każdym otwarciu arkusza.
 *
 * @param props - Właściwości komponentu.
 * @param props.liability - Zobowiązanie do edycji.
 * @param props.onSaved - Wywoływane po zapisie.
 * @returns Element formularza.
 */
function LiabilityForm({ liability, onSaved }: LiabilityFormProps): ReactNode {
  const navigate = useNavigate();
  const { household } = useAuth();
  const [state, setState] = useState<LiabilityFormState>(() =>
    liability === undefined
      ? emptyLiabilityForm(todayInTimezone(household?.timezone ?? 'Europe/Warsaw'))
      : liabilityFormFrom(liability),
  );
  const [view, setView] = useState<View>('form');
  const [errors, setErrors] = useState<LiabilityFormErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const accounts = useAccountList(false);
  const categories = useCategoryTree('expense');
  const create = useCreateLiability();
  const update = useUpdateLiability();
  const pending = create.isPending || update.isPending;

  /**
   * Zmienia pola i czyści ich błędy.
   *
   * @param patch - Zmienione pola.
   */
  const change = (patch: Partial<LiabilityFormState>): void => {
    setState((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key as keyof LiabilityFormState];
      return next;
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    const handlers = {
      onSuccess: onSaved,
      onError: (error: Error) => {
        setFormError(error.message);
        if (error instanceof ApiRequestError) setErrors(formErrorsFromRequest(error.fieldErrors()));
      },
    };
    if (liability === undefined) {
      const result = toCreateRequest(state);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      create.mutate(result.body, handlers);
      return;
    }
    const result = toUpdateRequest(liability, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (Object.keys(result.body).length === 0) {
      onSaved(liability);
      return;
    }
    update.mutate({ liabilityId: liability.id, body: result.body }, handlers);
  };

  if (view === 'account') {
    return (
      <AccountPicker
        accounts={accounts.data ?? []}
        onBack={() => {
          setView('form');
        }}
        onManageAccounts={() => {
          void navigate('/accounts');
        }}
        onSelect={(paymentAccountId) => {
          change({ paymentAccountId });
          setView('form');
        }}
        selectedId={state.paymentAccountId}
        title="Konto płatności"
      />
    );
  }
  if (view === 'category') {
    return (
      <CategoryPicker
        kind="expense"
        onBack={() => {
          setView('form');
        }}
        onSelect={(categoryId) => {
          change({ categoryId });
          setView('form');
        }}
        selectedId={state.categoryId}
      />
    );
  }

  const derived = derivedField(state);
  const linked = linkedValues(state);
  const breakdown = installmentBreakdown(linked);
  const accountName =
    state.paymentAccountId === null
      ? 'Wybierz'
      : (accounts.data?.find((account) => account.id === state.paymentAccountId)?.name ?? '…');
  const categoryName =
    state.categoryId === null
      ? 'Bez kategorii'
      : (categoryLabel(categories.data ?? [], state.categoryId) ?? '…');

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <TextField
        autoFocus={liability === undefined}
        error={errors.name}
        label="Nazwa"
        maxLength={60}
        onChange={(name) => {
          change({ name });
        }}
        placeholder="np. Telefon na raty"
        value={state.name}
      />

      <OptionGrid
        legend="Rodzaj"
        onChange={(kind) => {
          change({ kind });
        }}
        options={KIND_OPTIONS}
        value={state.kind}
      />

      <TextField
        error={errors.creditor}
        label="Wierzyciel"
        maxLength={60}
        onChange={(creditor) => {
          change({ creditor });
        }}
        placeholder="np. mBank"
        value={state.creditor}
      />

      {(['remaining', 'monthly', 'installments'] as const).map((field) => (
        <TextField
          error={errors[LINKED_TEXT[field]]}
          hint={
            field === derived
              ? derivedHint(breakdown)
              : field === 'remaining'
                ? 'Tyle, ile zostało do spłaty na dzień poniżej — z umowy albo wyciągu.'
                : undefined
          }
          inputMode={field === 'installments' ? 'numeric' : 'decimal'}
          key={field}
          label={LINKED_LABEL[field]}
          onChange={(text) => {
            setState((current) => editLinked(current, field, text));
            setErrors((current) => ({ ...current, [LINKED_TEXT[field]]: undefined }));
          }}
          value={field === derived ? linked.derivedText : state[LINKED_TEXT[field]]}
        />
      ))}

      <div className="grid grid-cols-2 gap-3">
        <TextField
          error={errors.balanceAsOf}
          label="Na dzień"
          onChange={(balanceAsOf) => {
            change({ balanceAsOf });
          }}
          type="date"
          value={state.balanceAsOf}
        />
        <TextField
          error={errors.paymentDayText}
          inputMode="numeric"
          label="Dzień płatności"
          onChange={(paymentDayText) => {
            change({ paymentDayText });
          }}
          placeholder="np. 10"
          value={state.paymentDayText}
        />
      </div>

      {/* ADR-068: spłata od listopada albo rata z tego miesiąca już zapłacona — bez tego
          pola zobowiązanie od razu pokazywało ratę po terminie. */}
      <TextField
        error={errors.firstPaymentOn}
        hint="Opcjonalnie. Gdy spłata zaczyna się później albo ratę z tego miesiąca już zapłacono. Puste — pierwszy dzień płatności po dniu „Na dzień”."
        label="Najbliższa rata"
        onChange={(firstPaymentOn) => {
          change({ firstPaymentOn });
        }}
        type="date"
        value={state.firstPaymentOn}
      />

      <div>
        <Field
          label="Konto płatności"
          onOpen={() => {
            setView('account');
          }}
          value={accountName}
        />
        {errors.paymentAccountId === undefined ? null : (
          <p className="pb-2 text-caption text-danger" role="alert">
            {errors.paymentAccountId}
          </p>
        )}
        <Field
          label="Kategoria raty"
          onOpen={() => {
            setView('category');
          }}
          value={categoryName}
        />
        {errors.categoryId === undefined ? null : (
          <p className="pb-2 text-caption text-danger" role="alert">
            {errors.categoryId}
          </p>
        )}
      </div>

      {liability === undefined ? (
        <div className="flex min-h-touch items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-sm">Utwórz pozycję cykliczną na ratę</span>
            <span className="text-caption text-muted-foreground">
              Rata pojawi się co miesiąc do potwierdzenia — nie trzeba jej wpisywać dwa razy.
            </span>
          </span>
          <Switch
            checked={state.createRecurringRule}
            label="Utwórz pozycję cykliczną na ratę"
            onCheckedChange={(createRecurringRule) => {
              change({ createRecurringRule });
            }}
          />
        </div>
      ) : null}

      <TextField
        error={errors.notes}
        label="Notatka"
        maxLength={1000}
        onChange={(notes) => {
          change({ notes });
        }}
        placeholder="np. numer umowy"
        value={state.notes}
      />

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-card px-4 pb-2 pt-3">
        {formError === undefined ? null : (
          <p className="mb-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Button loading={pending} size="large" type="submit" variant="primary">
          {liability === undefined ? 'Dodaj zobowiązanie' : 'Zapisz zmiany'}
        </Button>
      </div>
    </form>
  );
}

/** Właściwości arkusza zobowiązania. */
export interface LiabilityFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Zobowiązanie do edycji; brak = nowe. */
  liability?: LiabilityDto;
}

/**
 * Arkusz z formularzem nowego albo edytowanego zobowiązania.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @param props.liability - Zobowiązanie do edycji.
 * @returns Element arkusza.
 */
export function LiabilityFormSheet({
  open,
  onOpenChange,
  liability,
}: LiabilityFormSheetProps): ReactNode {
  return (
    <Sheet
      onOpenChange={onOpenChange}
      open={open}
      title={liability === undefined ? 'Nowe zobowiązanie' : 'Edytuj zobowiązanie'}
    >
      {open ? (
        <LiabilityForm
          key={liability?.id ?? 'new'}
          liability={liability}
          onSaved={() => {
            onOpenChange(false);
          }}
        />
      ) : null}
    </Sheet>
  );
}
