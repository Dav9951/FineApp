import type {
  AccountBalanceDto,
  AccountDto,
  AccountType,
  AllocationClass,
  BalancesMeta,
} from '@fineapp/shared';
import { Banknote, CreditCard, PiggyBank, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';

import type { MoneyVariant } from '../../components/ui/index.js';

/**
 * Czyste reguły ekranu kont ([06 §3.7](../../../../../plans/06-ui-views.md#37-konta--accounts)):
 * nazwy, ikony i grupowanie. Bez Reacta — testowane bezpośrednio.
 */

/** Kolejność pul na ekranie: od pieniędzy do wydania po pieniądze odłożone najdalej. */
export const ALLOCATION_CLASS_ORDER: readonly AllocationClass[] = [
  'spending',
  'savings',
  'investment',
];

/** Nagłówek grupy dla każdej puli. */
export const ALLOCATION_CLASS_LABEL: Readonly<Record<AllocationClass, string>> = {
  spending: 'Na bieżące wydatki',
  savings: 'Oszczędności',
  investment: 'Inwestycje',
};

/** Krótka nazwa puli — do wyboru w formularzu. */
export const ALLOCATION_CLASS_SHORT_LABEL: Readonly<Record<AllocationClass, string>> = {
  spending: 'Wydatki',
  savings: 'Oszczędności',
  investment: 'Inwestycje',
};

/**
 * Wariant kwoty sumy grupy.
 *
 * Pula oszczędności i inwestycji ma własny kolor z design systemu (15 §3.2); pieniądze
 * na wydatki są neutralne — `income` sugerowałby wpływ, którego nie było.
 */
export const ALLOCATION_CLASS_MONEY: Readonly<Record<AllocationClass, MoneyVariant>> = {
  spending: 'neutral',
  savings: 'savings',
  investment: 'investment',
};

/**
 * Nazwa rodzaju konta.
 *
 * Przymiotniki („konto oszczędnościowe"), a nie nazwy pul („Oszczędności"): rodzaj
 * i pula to dwie różne rzeczy, a przy tych samych słowach szczegóły konta czytały się
 * jak „Rodzaj: Oszczędności, Pula: Oszczędności".
 */
export const ACCOUNT_TYPE_LABEL: Readonly<Record<AccountType, string>> = {
  checking: 'Bieżące',
  cash: 'Gotówka',
  savings: 'Oszczędnościowe',
  investment: 'Inwestycyjne',
  other: 'Inne',
};

/** Kolejność rodzajów w formularzu. */
export const ACCOUNT_TYPE_ORDER: readonly AccountType[] = [
  'checking',
  'cash',
  'savings',
  'investment',
  'other',
];

/**
 * Ikona rodzaju konta.
 *
 * Stała mapa, a nie ikona po nazwie z `accounts.icon`: dynamiczne `import` całego
 * `lucide-react` dołożyłoby setki kilobajtów do paczki (06 §6 — budżet 200 kB).
 * Własna ikona konta dojdzie, gdy będzie wybór ikon z ograniczonej listy.
 */
export const ACCOUNT_TYPE_ICON: Readonly<Record<AccountType, LucideIcon>> = {
  checking: CreditCard,
  cash: Banknote,
  savings: PiggyBank,
  investment: TrendingUp,
  other: Wallet,
};

/** Grupa kont jednej puli. */
export interface AccountGroup {
  readonly allocationClass: AllocationClass;
  readonly label: string;
  /** Suma z serwera (`totalsByClass`), nie liczona na froncie. */
  readonly totalMinor: number;
  readonly accounts: readonly AccountBalanceDto[];
}

/**
 * Grupuje salda po puli, **nie po rodzaju konta**.
 *
 * To pula decyduje o celach procentowych i to ona jest istotna przy decyzjach
 * (06 §3.7): rachunek bieżący używany jako poduszka stoi wśród oszczędności. Puste
 * grupy są pomijane — nagłówek „Inwestycje 0,00 zł" bez żadnego konta niczego nie mówi.
 *
 * @param accounts - Salda w kolejności kont.
 * @param meta - Podsumowanie z sumami per pula.
 * @returns Niepuste grupy w stałej kolejności pul.
 */
export function groupBalances(
  accounts: readonly AccountBalanceDto[],
  meta: BalancesMeta,
): AccountGroup[] {
  return ALLOCATION_CLASS_ORDER.map((allocationClass) => ({
    allocationClass,
    label: ALLOCATION_CLASS_LABEL[allocationClass],
    totalMinor: meta.totalsByClass[allocationClass],
    accounts: accounts.filter((account) => account.allocationClass === allocationClass),
  })).filter((group) => group.accounts.length > 0);
}

/**
 * Konta z archiwum, których nie ma wśród sald.
 *
 * Zarchiwizowane konto z saldem różnym od zera zostaje w swojej grupie (07 §7 — wciąż
 * wchodzi do majątku), więc tutaj trafiają tylko te z zerem. Dzięki temu każde konto
 * jest na ekranie dokładnie raz.
 *
 * @param all - Wszystkie konta, łącznie z zarchiwizowanymi.
 * @param balances - Salda pokazane w grupach.
 * @returns Konta tylko z archiwum, w kolejności listy.
 */
export function archivedOutsideBalances(
  all: readonly AccountDto[],
  balances: readonly AccountBalanceDto[],
): AccountDto[] {
  const shown = new Set(balances.map((balance) => balance.accountId));
  return all.filter((account) => account.isArchived && !shown.has(account.id));
}

/**
 * Aktywa wliczane do majątku netto.
 *
 * Majątek netto to aktywa minus pozostałe zobowiązania (07 §7), więc aktywa to ich
 * suma — tożsamość, nie nowe obliczenie. Serwer nie zwraca ich osobno.
 *
 * @param meta - Podsumowanie majątku.
 * @returns Aktywa w groszach.
 */
export function assetsMinor(meta: BalancesMeta): number {
  return meta.netWorthMinor + meta.liabilitiesRemainingMinor;
}
