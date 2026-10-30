import {
  checkPin,
  earliestPostableDate,
  formatDateOnly,
  isValidTimeZone,
  UpdateHouseholdRequestSchema,
  type HouseholdDto,
  type SessionDto,
  type UpdateHouseholdRequest,
} from '@fineapp/shared';

import { pluralPl } from '../../lib/format.js';

/**
 * Reguły ekranu ustawień — czyste funkcje, testowane bez renderowania
 * ([06 §3.12](../../../../../plans/06-ui-views.md#312-ustawienia--settings)).
 */

/** Typowe limity księgowania wstecz — pełny zakres 0–12 byłby siatką trzynastu przycisków. */
export const BACK_POSTING_PRESETS: readonly number[] = [0, 1, 2, 3, 6, 12];

/**
 * Opcje limitu wstecz: typowe wartości plus bieżąca, gdy jest nietypowa (np. 4 ustawione
 * wcześniej przez API) — inaczej formularz nie pokazałby, co jest zapisane.
 *
 * @param current - Bieżący limit.
 * @returns Posortowane wartości.
 */
export function backPostingOptions(current: number): number[] {
  return [...new Set([...BACK_POSTING_PRESETS, current])].sort((a, b) => a - b);
}

/**
 * Limit wstecz słowami: „tylko bieżący miesiąc", „1 miesiąc wstecz", „3 miesiące wstecz".
 *
 * @param limit - Liczba miesięcy.
 * @returns Opis limitu.
 */
export function backPostingLabel(limit: number): string {
  if (limit === 0) return 'tylko bieżący miesiąc';
  return `${String(limit)} ${pluralPl(limit, 'miesiąc', 'miesiące', 'miesięcy')} wstecz`;
}

/**
 * Najwcześniejsza data księgowania przy danym limicie, słowami.
 *
 * @param today - Dzisiejsza data gospodarstwa.
 * @param limit - Limit wstecz.
 * @returns Np. „od 1 sierpnia 2026".
 */
export function postingFromLabel(today: string, limit: number): string {
  return `od ${formatDateOnly(earliestPostableDate(today, limit))}`;
}

/**
 * Skutek zmiany limitu — obniżenie zamyka miesiące (07 §1.4), podniesienie je otwiera.
 *
 * Komunikat mówi o **dacie**, nie o nazwach miesięcy: „sprzed 1 września 2026" jest
 * jednoznaczne, a nazwa miesiąca w narzędniku („przed wrześniem") wymagałaby osobnej
 * odmiany każdego miesiąca.
 *
 * @param today - Dzisiejsza data gospodarstwa.
 * @param before - Limit zapisany.
 * @param after - Limit wybrany w formularzu.
 * @returns Komunikat albo `undefined`, gdy nic się nie zmienia.
 */
export function limitChangeNote(today: string, before: number, after: number): string | undefined {
  if (after === before) return undefined;
  const from = formatDateOnly(earliestPostableDate(today, after));
  if (after < before) {
    return `Transakcji sprzed ${from} nie da się już zmienić ani usunąć — ich miesiące zostaną zamknięte.`;
  }
  return `Znów da się dopisywać i poprawiać transakcje od ${from}.`;
}

/**
 * Strefa czasowa tego urządzenia — podpowiedź „Użyj strefy tego urządzenia".
 *
 * @returns Nazwa strefy IANA albo `undefined`, gdy przeglądarka jej nie zna.
 */
export function deviceTimeZone(): string | undefined {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(zone) ? zone : undefined;
}

/** Stan formularza gospodarstwa. */
export interface HouseholdFormState {
  name: string;
  timezone: string;
  backPostingLimitMonths: number;
}

/** Błędy pól formularza gospodarstwa. */
export type HouseholdFormErrors = Partial<Record<keyof HouseholdFormState, string>>;

/**
 * Stan formularza z zapisanych ustawień.
 *
 * @param household - Gospodarstwo.
 * @returns Stan początkowy.
 */
export function householdFormFrom(household: HouseholdDto): HouseholdFormState {
  return {
    name: household.name,
    timezone: household.timezone,
    backPostingLimitMonths: household.backPostingLimitMonths,
  };
}

/**
 * Zamienia formularz na `PATCH` — tylko pola, które się zmieniły.
 *
 * Walidacja idzie tym samym schematem, który sprawdza serwer, więc komunikat pod polem
 * jest ten sam, który przyszedłby z `400`.
 *
 * @param household - Zapisane ustawienia.
 * @param state - Stan formularza.
 * @returns Ciało żądania albo błędy pól.
 */
export function toHouseholdPatch(
  household: HouseholdDto,
  state: HouseholdFormState,
): { ok: true; body: UpdateHouseholdRequest } | { ok: false; errors: HouseholdFormErrors } {
  const parsed = UpdateHouseholdRequestSchema.safeParse(state);
  if (!parsed.success) {
    const errors: HouseholdFormErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'name' || field === 'timezone' || field === 'backPostingLimitMonths') {
        errors[field] ??= issue.message;
      }
    }
    return { ok: false, errors };
  }

  const body: UpdateHouseholdRequest = {};
  if (parsed.data.name !== household.name) body.name = parsed.data.name;
  if (parsed.data.timezone !== household.timezone) body.timezone = parsed.data.timezone;
  if (parsed.data.backPostingLimitMonths !== household.backPostingLimitMonths) {
    body.backPostingLimitMonths = parsed.data.backPostingLimitMonths;
  }
  return { ok: true, body };
}

/** Stan formularza zmiany PIN-u. */
export interface PinFormState {
  currentPin: string;
  newPin: string;
  confirmPin: string;
}

/** Błędy pól formularza PIN-u. */
export type PinFormErrors = Partial<Record<keyof PinFormState, string>>;

/**
 * Sprawdza formularz PIN-u przed wysłaniem — te same reguły co serwer (09 §2.3),
 * plus powtórzenie nowego PIN-u, którego serwer nie widzi.
 *
 * @param state - Stan formularza.
 * @returns Błędy pól; pusty obiekt — można wysyłać.
 */
export function pinFormErrors(state: PinFormState): PinFormErrors {
  const errors: PinFormErrors = {};
  if (!/^\d{6,8}$/.test(state.currentPin)) errors.currentPin = 'Wpisz obecny PIN (6–8 cyfr).';

  const check = checkPin(state.newPin);
  if (!check.ok) errors.newPin = check.message;
  else if (state.newPin === state.currentPin) {
    errors.newPin = 'Nowy PIN musi różnić się od obecnego.';
  }

  if (errors.newPin === undefined && state.confirmPin !== state.newPin) {
    errors.confirmPin = 'PIN-y się różnią.';
  }
  return errors;
}

/**
 * Podpis urządzenia na liście sesji.
 *
 * `sameDevice` to ten sam adres IP, nie to samo urządzenie — stąd „ta sama sieć”,
 * a nie „to urządzenie” (09 §3.5).
 *
 * @param session - Sesja.
 * @param locale - Ustawienia regionalne.
 * @returns Np. „to urządzenie" albo „ostatnio 25 wrz, 14:02 · ta sama sieć".
 */
export function sessionCaption(session: SessionDto, locale = 'pl-PL'): string {
  if (session.current) return 'to urządzenie';
  const at = session.lastUsedAt ?? session.createdAt;
  const when = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
  return session.sameDevice ? `ostatnio ${when} · ta sama sieć` : `ostatnio ${when}`;
}

/**
 * Nazwa urządzenia na liście — etykieta z logowania albo zastępcza.
 *
 * @param session - Sesja.
 * @returns Nazwa do wyświetlenia.
 */
export function sessionName(session: SessionDto): string {
  return session.deviceLabel ?? 'Nieznane urządzenie';
}

/**
 * Wyzwala zapis pliku w przeglądarce.
 *
 * Plik przychodzi przez `fetch` z tokenem w nagłówku — zwykły link nie wysłałby
 * `Authorization` (token żyje tylko w pamięci, 09 §3.1).
 *
 * @param blob - Treść pliku.
 * @param fileName - Nazwa pliku.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Odroczone: Safari potrafi zacząć pobieranie dopiero po powrocie do pętli zdarzeń.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
