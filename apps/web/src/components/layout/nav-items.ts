import {
  Banknote,
  Camera,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Landmark,
  Menu,
  PieChart,
  ReceiptText,
  Repeat,
  Settings,
  Tags,
  Target,
  type LucideIcon,
} from 'lucide-react';

/**
 * Pozycje nawigacji ([06 §2](../../../../../plans/06-ui-views.md#2-nawigacja)).
 *
 * Jedno źródło dla paska zakładek i paska bocznego: na telefonie widać pięć pozycji
 * głównych, na desktopie te same plus rozwinięte podsekcje z „Więcej". Gdyby były to
 * dwie listy, pierwsza zmiana nawigacji rozjechałaby je bez żadnego ostrzeżenia.
 */

/** Pozycja nawigacji. */
export interface NavItem {
  /** Ścieżka docelowa; `:month` podstawiamy w czasie renderowania. */
  to: string;
  label: string;
  icon: LucideIcon;
  /**
   * Czy pozycja ma być aktywna także na ścieżkach potomnych.
   *
   * Steruje wprost propsem `end` komponentu `NavLink` (odwrotnie), więc dopasowanie
   * liczy sam router — a nie my obok niego. Dwa niezależne dopasowania rozjeżdżały się
   * i `aria-current` trafiało na dwie pozycje naraz.
   */
  nested?: boolean;
}

/** Ścieżka „Więcej" — na desktopie jej zawartość stoi rozwinięta w pasku bocznym. */
export const MORE_PATH = '/more';

/**
 * Pięć pozycji dolnego paska zakładek (cztery, gdy OCR jest wyłączony).
 *
 * „Więcej" nie jest trasą, tylko wejściem do sekcji — na telefonie otwiera listę,
 * na desktopie znika, bo jej zawartość stoi już rozwinięta w pasku bocznym.
 * `AI_ENABLED=false` chowa zakładkę *Skan* (08 §9).
 *
 * @param month - Klucz bieżącego miesiąca.
 * @param scan - Czy pokazać zakładkę *Skan*.
 * @returns Pozycje paska.
 */
export function primaryNav(month: string, scan = true): NavItem[] {
  return [
    { to: `/m/${month}`, label: 'Miesiąc', icon: CalendarDays },
    { to: `/m/${month}/transactions`, label: 'Historia', icon: ReceiptText },
    { to: '/goals', label: 'Cele', icon: Target, nested: true },
    ...(scan ? [{ to: '/scan', label: 'Skan', icon: Camera, nested: true }] : []),
    { to: MORE_PATH, label: 'Więcej', icon: Menu },
  ];
}

/**
 * Ekrany planowania — „Więcej" na telefonie, grupa „Planowanie" w pasku bocznym (ADR-082).
 *
 * @returns Pozycje w kolejności z 06 §2.
 */
export function planningNav(): NavItem[] {
  return [
    { to: '/accounts', label: 'Konta', icon: Landmark, nested: true },
    { to: '/liabilities', label: 'Zobowiązania', icon: CreditCard, nested: true },
    { to: '/recurring', label: 'Cykliczne', icon: Repeat, nested: true },
    { to: '/planned', label: 'Planowane', icon: Banknote, nested: true },
    { to: '/budget', label: 'Budżet', icon: ClipboardList, nested: true },
    // Wykres kołowy, nie tarcza — tarczę ma „Cele" (ADR-082).
    { to: '/allocation', label: 'Rozkład docelowy', icon: PieChart },
  ];
}

/**
 * Kategorie i Ustawienia — klaster na dole paska i ekranu „Więcej", bez nagłówka:
 * nagłówek „Ustawienia" nad pozycją „Ustawienia" byłby powtórzeniem (ADR-082).
 *
 * @returns Pozycje ustawień.
 */
export function settingsNav(): NavItem[] {
  return [
    { to: '/settings/categories', label: 'Kategorie', icon: Tags },
    { to: '/settings', label: 'Ustawienia', icon: Settings },
  ];
}
