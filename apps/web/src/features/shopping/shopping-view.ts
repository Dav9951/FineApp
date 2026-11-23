import {
  formatShoppingQuantity,
  SHOPPING_SECTION_LABELS,
  ShoppingSectionSchema,
  type ShoppingItemDto,
  type ShoppingSection,
} from '@fineapp/shared';

import { pluralPl } from '../../lib/format.js';

/**
 * Czyste pomocnicze ekranu listy zakupów (06 §3.15) — bez Reacta, z testami.
 */

/** Dział z pozycjami do kupienia. */
export interface SectionGroup {
  readonly section: ShoppingSection;
  readonly label: string;
  readonly items: readonly ShoppingItemDto[];
}

/**
 * Inicjały z imienia: pierwsze litery dwóch pierwszych słów („Adam Kowalski" → „AK").
 *
 * @param displayName - Imię wyświetlane.
 * @returns Inicjały wielkimi literami.
 */
export function initialsOf(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase('pl'))
    .join('');
}

/**
 * Pozycje do kupienia pogrupowane działami w stałej kolejności sklepu (P-5); kolejność
 * w dziale zostaje taka, jak przyszła z serwera.
 *
 * @param items - Pozycje listy.
 * @returns Działy z pozycjami; puste działy pominięte.
 */
export function groupToBuy(items: readonly ShoppingItemDto[]): SectionGroup[] {
  return ShoppingSectionSchema.options
    .map((section) => ({
      section,
      label: SHOPPING_SECTION_LABELS[section],
      items: items.filter((item) => !item.checked && item.section === section),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Kupione, od ostatnio odhaczonych.
 *
 * @param items - Pozycje listy.
 * @returns Kupione pozycje.
 */
export function checkedItems(items: readonly ShoppingItemDto[]): ShoppingItemDto[] {
  return items
    .filter((item) => item.checked)
    .sort((a, b) => (b.checkedAt ?? 0) - (a.checkedAt ?? 0));
}

/**
 * Lista jako tekst do udostępnienia („Udostępnij jako tekst", 06 §3.15) — dla kogoś bez
 * aplikacji. Tylko do kupienia, działami.
 *
 * @param name - Nazwa listy.
 * @param items - Pozycje.
 * @returns Tekst.
 */
export function shareText(name: string, items: readonly ShoppingItemDto[]): string {
  const lines = groupToBuy(items).flatMap((group) => [
    '',
    group.label.toLocaleUpperCase('pl'),
    ...group.items.map((item) => {
      const quantity = formatShoppingQuantity(item);
      return `• ${item.name}${quantity === '' ? '' : ` — ${quantity}`}${item.note === null ? '' : ` (${item.note})`}`;
    }),
  ]);
  return [name, ...lines].join('\n');
}

/**
 * Kiedy ostatnio — „przed chwilą", „12 min temu", „3 godz. temu", „wczoraj", „5 dni temu".
 *
 * @param at - Znacznik zdarzenia (ms).
 * @param now - Teraz (ms).
 * @returns Opis po polsku.
 */
export function relativeTime(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'przed chwilą';
  if (minutes < 60) return `${String(minutes)} min temu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} godz. temu`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'wczoraj';
  return `${String(days)} ${pluralPl(days, 'dzień', 'dni', 'dni')} temu`;
}

/**
 * „7 do kupienia" / „nic do kupienia".
 *
 * @param count - Liczba pozycji do kupienia.
 * @returns Podpis karty listy.
 */
export function toBuyLabel(count: number): string {
  return count === 0 ? 'nic do kupienia' : `${String(count)} do kupienia`;
}

/**
 * Ilość z pola arkusza pozycji („1,5", „2", pusta) w tysięcznych.
 *
 * @param text - Tekst pola.
 * @returns Tysięczne, `null` dla pustego pola albo `undefined`, gdy to nie liczba
 *   dodatnia do 1000 z najwyżej trzema miejscami po przecinku.
 */
export function parseQuantityInput(text: string): number | null | undefined {
  const value = text.trim().replace(',', '.');
  if (value === '') return null;
  const match = /^(\d{1,4})(?:\.(\d{1,3}))?$/u.exec(value);
  if (match === null) return undefined;
  const milli = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  return milli > 0 && milli <= 1_000_000 ? milli : undefined;
}

/**
 * Tysięczne jako tekst pola arkusza („1500" → „1,5").
 *
 * @param milli - Ilość w tysięcznych albo `null`.
 * @returns Tekst pola.
 */
export function quantityInputValue(milli: number | null): string {
  if (milli === null) return '';
  const fraction = String(milli % 1000)
    .padStart(3, '0')
    .replace(/0+$/u, '');
  return fraction === ''
    ? String(Math.floor(milli / 1000))
    : `${String(Math.floor(milli / 1000))},${fraction}`;
}
