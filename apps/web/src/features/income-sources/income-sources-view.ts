import {
  CreateIncomeSourceRequestSchema,
  defaultCountsTowardAllocation,
  type CreateIncomeSourceRequest,
  type HouseholdMemberDto,
  type IncomeSourceDto,
  type IncomeSourceKind,
  type UpdateIncomeSourceRequest,
} from '@fineapp/shared';

import { INCOME_SOURCE_KIND_LABEL } from '../transactions/transaction-view.js';

/**
 * Reguły ekranu źródeł przychodu — `/settings/income-sources`
 * ([06 §3.12](../../../../../plans/06-ui-views.md#312-ustawienia--settings), wymaganie #10).
 */

/** Wartość „źródło wspólne" w siatce wyboru właściciela — siatka przyjmuje tylko napisy. */
export const SHARED_OWNER = 'shared';

/** Stan formularza źródła. */
export interface IncomeSourceFormState {
  name: string;
  kind: IncomeSourceKind;
  /** Identyfikator domownika albo {@link SHARED_OWNER}. */
  owner: string;
  countsTowardAllocation: boolean;
}

/** Błędy pól formularza. */
export type IncomeSourceFormErrors = Partial<Record<'name', string>>;

/**
 * Pusty formularz — pensja, wspólna, liczona do celów.
 *
 * @returns Stan początkowy.
 */
export function emptyIncomeSourceForm(): IncomeSourceFormState {
  return { name: '', kind: 'salary', owner: SHARED_OWNER, countsTowardAllocation: true };
}

/**
 * Formularz z zapisanego źródła.
 *
 * @param source - Źródło.
 * @returns Stan formularza.
 */
export function incomeSourceFormFrom(source: IncomeSourceDto): IncomeSourceFormState {
  return {
    name: source.name,
    kind: source.kind,
    owner: source.ownerUserId ?? SHARED_OWNER,
    countsTowardAllocation: source.countsTowardAllocation,
  };
}

/**
 * Zmiana rodzaju w **nowym** źródle podpowiada też „liczy się do celów" (zwrot — nie),
 * tak jak robi to serwis przy pominiętym polu. W edycji nie ruszamy przełącznika:
 * użytkownik ustawił go jawnie i cicha zmiana byłaby zaskoczeniem (04 §12).
 *
 * @param state - Stan formularza.
 * @param kind - Nowy rodzaj.
 * @param isNew - Czy to nowe źródło.
 * @returns Stan po zmianie.
 */
export function withKind(
  state: IncomeSourceFormState,
  kind: IncomeSourceKind,
  isNew: boolean,
): IncomeSourceFormState {
  return {
    ...state,
    kind,
    countsTowardAllocation: isNew
      ? defaultCountsTowardAllocation(kind)
      : state.countsTowardAllocation,
  };
}

/**
 * Formularz → `POST`.
 *
 * @param state - Stan formularza.
 * @returns Ciało żądania albo błędy pól.
 */
export function toCreateIncomeSource(
  state: IncomeSourceFormState,
): { ok: true; body: CreateIncomeSourceRequest } | { ok: false; errors: IncomeSourceFormErrors } {
  const parsed = CreateIncomeSourceRequestSchema.safeParse({
    name: state.name,
    kind: state.kind,
    ownerUserId: state.owner === SHARED_OWNER ? null : state.owner,
    countsTowardAllocation: state.countsTowardAllocation,
  });
  if (!parsed.success) {
    return { ok: false, errors: { name: parsed.error.issues[0]?.message } };
  }
  return { ok: true, body: parsed.data };
}

/**
 * Formularz → `PATCH` — tylko zmienione pola.
 *
 * @param source - Zapisane źródło.
 * @param state - Stan formularza.
 * @returns Ciało żądania albo błędy pól.
 */
export function toUpdateIncomeSource(
  source: IncomeSourceDto,
  state: IncomeSourceFormState,
): { ok: true; body: UpdateIncomeSourceRequest } | { ok: false; errors: IncomeSourceFormErrors } {
  const created = toCreateIncomeSource(state);
  if (!created.ok) return created;
  const next = created.body;
  const body: UpdateIncomeSourceRequest = {};
  if (next.name !== source.name) body.name = next.name;
  if (next.kind !== source.kind) body.kind = next.kind;
  if ((next.ownerUserId ?? null) !== source.ownerUserId)
    body.ownerUserId = next.ownerUserId ?? null;
  if (next.countsTowardAllocation !== source.countsTowardAllocation) {
    body.countsTowardAllocation = next.countsTowardAllocation;
  }
  return { ok: true, body };
}

/**
 * Podpis źródła na liście: rodzaj · czyje · „poza celami".
 *
 * @param source - Źródło.
 * @param members - Domownicy (do imienia właściciela).
 * @returns Podpis.
 */
export function incomeSourceCaption(
  source: IncomeSourceDto,
  members: readonly HouseholdMemberDto[],
): string {
  const parts = [INCOME_SOURCE_KIND_LABEL[source.kind]];
  if (source.ownerUserId === null) parts.push('wspólne');
  else {
    const owner = members.find((member) => member.id === source.ownerUserId);
    parts.push(owner === undefined ? 'domownik' : owner.displayName);
  }
  if (!source.countsTowardAllocation) parts.push('poza podstawą celów');
  return parts.join(' · ');
}

/**
 * Dzieli źródła na aktywne i archiwum, zachowując kolejność wyświetlania.
 *
 * @param sources - Wszystkie źródła.
 * @returns Obie grupy.
 */
export function splitArchived(sources: readonly IncomeSourceDto[]): {
  active: IncomeSourceDto[];
  archived: IncomeSourceDto[];
} {
  return {
    active: sources.filter((source) => !source.isArchived),
    archived: sources.filter((source) => source.isArchived),
  };
}
