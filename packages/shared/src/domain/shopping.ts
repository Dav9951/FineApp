import { SHOPPING_SECTION_KEYWORDS, SHOPPING_UNIT_LABELS } from '../constants/shopping.js';
import { foldForSearch } from '../utils/names.js';
import { ShoppingSectionSchema, type ShoppingSection, type ShoppingUnit } from './enums.js';

/**
 * Czyste reguły list zakupów —
 * [07 §14](../../../../plans/07-domain-rules.md#14-listy-zakupów), Faza 10, ADR-093.
 *
 * Wszystkie ilości są liczbami całkowitymi w tysięcznych częściach jednostki (`…Milli`),
 * mnożnik w bps. Ułamek pojawia się wyłącznie przy rozbiorze tekstu wpisanego przez
 * człowieka — i tam jest rozbierany na cyfry, bez `parseFloat`.
 */

/** Tysięczne części jednej jednostki. */
export const MILLI_PER_UNIT = 1000;
/** Największa ilość pozycji: 1000 jednostek (04 §14b). */
export const MAX_QUANTITY_MILLI = 1_000_000;
/** Mnożnik ×1 w bps. */
export const SERVINGS_FACTOR_ONE_BPS = 10_000;
/** Zakres mnożnika porcji: ×0,25 … ×4 (03 §3.26). */
export const SERVINGS_FACTOR_MIN_BPS = 2_500;
/** Zakres mnożnika porcji: ×0,25 … ×4 (03 §3.26). */
export const SERVINGS_FACTOR_MAX_BPS = 40_000;
/** Poniżej tej pewności propozycja ma plakietkę „Sprawdź" (08 §17.2). */
export const NEEDS_REVIEW_BELOW_BPS = 6_000;
/** Wyczyszczone pozycje można przywrócić przez tyle czasu (I-28). */
export const CLEARED_RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Okno „często kupowanych" (07 §14.5). */
export const FREQUENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** Ile „często kupowanych" pokazujemy (07 §14.5). */
export const FREQUENT_LIMIT = 12;

/**
 * Sprowadza nazwę produktu do klucza porównań (07 §14.1).
 *
 * Bez polskich znaków i bez wielkości liter, bo na telefonie „maka" ma trafić w „Mąkę",
 * a „Mleko" dopisane przez jedną osobę i „mleko" przez drugą to ta sama pozycja.
 * Kropka i przecinek na końcu to zwykle literówka, nie część nazwy. Bez stemmingu:
 * „jajko" i „jajka" to w v1 dwa produkty.
 *
 * @param name - Nazwa wpisana albo odczytana.
 * @returns Klucz: małe litery, bez znaków diakrytycznych, pojedyncze spacje.
 */
export function normalizeShoppingName(name: string): string {
  // NFKD najpierw: ligatury i znaki pełnej szerokości („ﬁlet") dają ten sam klucz.
  return foldForSearch(name.normalize('NFKD'))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]+$/, '')
    .trim();
}

/**
 * Nazwa do zapisu: przycięta, z pojedynczymi spacjami i wielką pierwszą literą.
 *
 * @param name - Nazwa wpisana.
 * @returns Nazwa do wyświetlania.
 */
export function tidyShoppingName(name: string): string {
  const tidy = name.replace(/\s+/g, ' ').trim();
  return tidy.charAt(0).toLocaleUpperCase('pl') + tidy.slice(1);
}

/** Ilość z jednostką albo jej brak — obie wartości razem (I-27). */
export interface ShoppingQuantity {
  readonly quantityMilli: number | null;
  readonly unit: ShoppingUnit | null;
}

/**
 * Dzieli liczbę całkowitą z zaokrągleniem połowy w górę — dla liczb nieujemnych.
 *
 * @param numerator - Dzielna (≥ 0).
 * @param denominator - Dzielnik (> 0).
 * @returns Iloraz zaokrąglony.
 */
function divideHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/**
 * Dzieli z zaokrągleniem w górę — dla liczb całkowitych, dzielnik > 0.
 *
 * @param numerator - Dzielna.
 * @param denominator - Dzielnik.
 * @returns Najmniejsza liczba całkowita ≥ iloraz.
 */
function divideCeil(numerator: number, denominator: number): number {
  return Math.ceil(numerator / denominator);
}

/** Dane składnika od modelu, w tysięcznych (08 §17.2). */
export interface RecipeIngredientAmounts {
  readonly baseAmountMilli: number | null;
  readonly baseUnit: 'g' | 'ml' | 'pcs' | null;
  readonly packageAmountMilli: number | null;
}

/** Wynik przeliczenia składnika na zakupy. */
export interface RecipePurchase extends ShoppingQuantity {
  /** Potrzeba po mnożniku — do dopisku „potrzeba 100 g" (P-2); `null` — „do smaku". */
  readonly neededAmountMilli: number | null;
}

/**
 * Ile kupić, żeby zrobić przepis w danej ilości porcji (07 §14.2).
 *
 * **Liczy serwer, nie model** (ADR-094): model podaje ilość z przepisu i typowe
 * opakowanie, a mnożenie i zaokrąglenie są tutaj, deterministycznie i z testami — dzięki
 * temu zmiana mnożnika w przeglądzie nie wymaga ponownego odczytu.
 *
 * Tolerancja 10% opakowania: przepis na 105 g czekolady to w sklepie jedna tabliczka
 * 100 g, nie dwie. Wynik jest zawsze w sztukach albo opakowaniach — tak się kupuje.
 *
 * @param amounts - Ilość bazowa, jej jednostka i typowe opakowanie.
 * @param factorBps - Mnożnik porcji w bps (×1 = 10 000).
 * @returns Ilość do kupienia i potrzeba po mnożniku.
 */
export function recipePurchase(
  amounts: RecipeIngredientAmounts,
  factorBps: number,
): RecipePurchase {
  const { baseAmountMilli, baseUnit, packageAmountMilli } = amounts;
  if (baseAmountMilli === null || baseUnit === null) {
    return { quantityMilli: MILLI_PER_UNIT, unit: 'pcs', neededAmountMilli: null };
  }
  const needed = Math.max(1, divideHalfUp(baseAmountMilli * factorBps, SERVINGS_FACTOR_ONE_BPS));
  if (packageAmountMilli === null) {
    const count = baseUnit === 'pcs' ? divideCeil(needed, MILLI_PER_UNIT) : 1;
    return { quantityMilli: count * MILLI_PER_UNIT, unit: 'pcs', neededAmountMilli: needed };
  }
  // max(1, ceil((needed − pkg/10) / pkg)) — w całkowitych: ceil((10·needed − pkg) / (10·pkg)).
  const packages = Math.max(
    1,
    divideCeil(10 * needed - packageAmountMilli, 10 * packageAmountMilli),
  );
  const unit: ShoppingUnit =
    baseUnit === 'pcs' && packageAmountMilli > MILLI_PER_UNIT ? 'pack' : 'pcs';
  return { quantityMilli: packages * MILLI_PER_UNIT, unit, neededAmountMilli: needed };
}

/**
 * Porządek założenia: czas, potem identyfikator (ULID rośnie z czasem).
 *
 * @param a - Pierwsza pozycja.
 * @param a.id - Identyfikator.
 * @param a.createdAt - Znacznik założenia.
 * @param b - Druga pozycja.
 * @param b.id - Identyfikator.
 * @param b.createdAt - Znacznik założenia.
 * @returns Wynik porównania do `sort`.
 */
function byCreation(
  a: { id: string; createdAt: number },
  b: { id: string; createdAt: number },
): number {
  return a.createdAt - b.createdAt || Number(a.id > b.id) - Number(a.id < b.id);
}

/** Pozycja listy w zakresie potrzebnym do scalania. */
export interface MergeCandidate extends ShoppingQuantity {
  readonly id: string;
  readonly normalizedName: string;
  readonly checked: boolean;
  readonly createdAt: number;
}

/**
 * Pozycja *do kupienia*, z którą scali się dopisywany produkt (07 §14.3, I-29).
 *
 * Ta sama nazwa i ta sama jednostka — wprost. Gdy jedna ze stron nie ma ilości, łączy
 * się z dowolną (pierwszą założoną): „Mleko" i „Mleko 2 szt." to jedno mleko. Różne
 * jednostki („Mąka 1 kg" i „Mąka 2 szt.") zostają osobno. Kupione nie są celem: kupione
 * mleko i nowe mleko to dwie pozycje.
 *
 * @param items - Pozycje listy docelowej.
 * @param normalizedName - Klucz dopisywanego produktu.
 * @param unit - Jego jednostka albo `null`.
 * @returns Pozycja do scalenia albo `null`.
 */
export function findMergeTarget<T extends MergeCandidate>(
  items: readonly T[],
  normalizedName: string,
  unit: ShoppingUnit | null,
): T | null {
  const candidates = items
    .filter((item) => !item.checked && item.normalizedName === normalizedName)
    .sort(byCreation);
  const sameUnit = candidates.find((item) => item.unit === unit);
  if (sameUnit) return sameUnit;
  if (unit === null) return candidates[0] ?? null;
  return candidates.find((item) => item.unit === null) ?? null;
}

/**
 * Ilość po scaleniu dwóch pozycji, które {@link findMergeTarget} uznało za jedną.
 *
 * Ta sama jednostka — suma (przycięta do {@link MAX_QUANTITY_MILLI}); jedna bez ilości —
 * zostaje ta z ilością.
 *
 * @param existing - Ilość pozycji na liście.
 * @param incoming - Ilość dopisywana.
 * @returns Ilość wynikowa.
 */
export function mergeQuantities(
  existing: ShoppingQuantity,
  incoming: ShoppingQuantity,
): ShoppingQuantity {
  if (existing.quantityMilli === null || existing.unit === null) return incoming;
  if (incoming.quantityMilli === null || incoming.unit === null) return existing;
  return {
    quantityMilli: Math.min(MAX_QUANTITY_MILLI, existing.quantityMilli + incoming.quantityMilli),
    unit: existing.unit,
  };
}

/**
 * Notatka po scaleniu: obie, połączone „ · ", bez powtórzeń, do 120 znaków.
 *
 * @param existing - Notatka pozycji na liście.
 * @param incoming - Notatka dopisywana.
 * @returns Notatka wynikowa albo `null`.
 */
export function mergeNotes(existing: string | null, incoming: string | null): string | null {
  const parts = [existing, incoming]
    .flatMap((note) => (note ?? '').split(' · '))
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const unique = parts.filter(
    (part, index) =>
      parts.findIndex((other) => normalizeShoppingName(other) === normalizeShoppingName(part)) ===
      index,
  );
  if (unique.length === 0) return null;
  return unique.join(' · ').slice(0, 120);
}

/** Wynik rozbioru szybkiego dopisania. */
export interface QuickAddParse extends ShoppingQuantity {
  readonly name: string;
}

/** Jednostki rozpoznawane w szybkim dopisaniu i ich mnożnik do jednostki z enumu. */
type QuickUnit = 'kg' | 'g' | 'dag' | 'l' | 'ml' | 'szt' | 'op' | 'opak';
const QUICK_UNITS: Readonly<Record<QuickUnit, { unit: ShoppingUnit; factor: number }>> = {
  kg: { unit: 'kg', factor: 1 },
  g: { unit: 'g', factor: 1 },
  dag: { unit: 'g', factor: 10 },
  l: { unit: 'l', factor: 1 },
  ml: { unit: 'ml', factor: 1 },
  szt: { unit: 'pcs', factor: 1 },
  op: { unit: 'pack', factor: 1 },
  opak: { unit: 'pack', factor: 1 },
};

const NUMBER = String.raw`(\d{1,7}(?:[.,]\d+)?)`;
const UNIT = String.raw`(kg|dag|g|ml|l|szt|opak|op)\.?`;
const COUNT = String.raw`(\d{1,7})`;

/**
 * Liczba z tekstu („1,5", „2", „0.25") w tysięcznych, bez `parseFloat`.
 *
 * @param text - Cyfry z opcjonalną częścią ułamkową.
 * @param factor - Mnożnik jednostki (dag → g = 10).
 * @returns Ilość w tysięcznych; ułamek ponad trzy miejsca obcięty.
 */
function toMilli(text: string, factor: number): number {
  const [whole, fraction] = `${text.replace(',', '.')}.`.split('.');
  const milli =
    Number(whole) * MILLI_PER_UNIT + Number(String(fraction).padEnd(3, '0').slice(0, 3));
  return milli * factor;
}

/**
 * Składa wynik rozbioru albo odrzuca, gdy ilość jest zerowa lub za duża.
 *
 * @param name - Część nazwy.
 * @param milli - Ilość w tysięcznych.
 * @param unit - Jednostka.
 * @returns Wynik albo `null`.
 */
function quantityResult(name: string, milli: number, unit: ShoppingUnit): QuickAddParse | null {
  if (milli <= 0 || milli > MAX_QUANTITY_MILLI) return null;
  return { name: tidyShoppingName(name), quantityMilli: milli, unit };
}

/**
 * Rozbiera wpis z pola „Dodaj produkt…" na nazwę i ilość (07 §14.4).
 *
 * Ilość jest rozpoznawana **tylko na początku albo na końcu** wpisu: liczba z jednostką
 * („mąka 1kg", „1,5 kg ziemniaki"), z `x`/`×` („mleko x2", „2x mleko") albo sama liczba
 * całkowita do 99 („2 mleko", „mleko 2"). Liczba w środku albo z ułamkiem bez jednostki
 * zostaje w nazwie („Mleko 3,2%", „Pepsi 0,5"). Ilość zerowa albo ponad 1000 jednostek
 * nie jest ilością — zostaje w nazwie.
 *
 * @param input - Tekst wpisany przez człowieka.
 * @returns Nazwa i ilość; `null`, gdy po odjęciu ilości nie zostaje nazwa.
 */
export function parseQuickAdd(input: string): QuickAddParse | null {
  const text = input.replace(/\s+/g, ' ').trim();
  if (text === '') return null;

  const patterns: readonly {
    regex: RegExp;
    build: (groups: readonly string[]) => QuickAddParse | null;
  }[] = [
    {
      // „mąka 1kg", „ziemniaki 1,5 kg", „jajka 2 opak"
      regex: new RegExp(String.raw`^(.+?) ${NUMBER} ?${UNIT}$`, 'iu'),
      build: ([name, number, unit]) => unitResult(name, number, unit),
    },
    {
      // „1kg mąka", „1,5 kg ziemniaki", „2 op. jajka"
      regex: new RegExp(String.raw`^${NUMBER} ?${UNIT} (.+)$`, 'iu'),
      build: ([number, unit, name]) => unitResult(name, number, unit),
    },
    {
      // „mleko x2", „mleko ×2"
      regex: new RegExp(String.raw`^(.+?) [x×] ?${COUNT}$`, 'iu'),
      build: ([name, count]) => countResult(name, count),
    },
    {
      // „2x mleko", „2 × mleko"
      regex: new RegExp(String.raw`^${COUNT} ?[x×] (.+)$`, 'iu'),
      build: ([count, name]) => countResult(name, count),
    },
    {
      // „2 mleko"
      regex: /^(\d{1,2}) (.+)$/u,
      build: ([count, name]) => countResult(name, count),
    },
    {
      // „mleko 2"
      regex: /^(.+?) (\d{1,2})$/u,
      build: ([name, count]) => countResult(name, count),
    },
  ];

  for (const { regex, build } of patterns) {
    const match = regex.exec(text);
    // Wszystkie grupy są obowiązkowe, więc przy dopasowaniu każda jest napisem.
    const result = match ? build(Array.from(match).slice(1).map(String)) : null;
    if (result) return result;
  }
  if (/^\d+(?:[.,]\d+)?$/.test(text)) return null;
  return { name: tidyShoppingName(text), quantityMilli: null, unit: null };
}

/**
 * Wynik dla liczby z jednostką.
 *
 * @param name - Nazwa.
 * @param number - Liczba.
 * @param unitText - Jednostka z tekstu.
 * @returns Wynik albo `null`.
 */
function unitResult(
  name: string | undefined,
  number: string | undefined,
  unitText: string | undefined,
): QuickAddParse | null {
  // Wyrażenie przepuszcza wyłącznie jednostki z `QUICK_UNITS`.
  const unit = QUICK_UNITS[String(unitText).toLowerCase() as QuickUnit];
  return quantityResult(String(name), toMilli(String(number), unit.factor), unit.unit);
}

/**
 * Wynik dla samej liczby sztuk.
 *
 * @param name - Nazwa.
 * @param count - Liczba całkowita.
 * @returns Wynik albo `null`.
 */
function countResult(name: string | undefined, count: string | undefined): QuickAddParse | null {
  return quantityResult(String(name), Number(count) * MILLI_PER_UNIT, 'pcs');
}

/**
 * Dział nowej pozycji, gdy nie podano go wprost (07 §14.5): słownik gospodarstwa,
 * potem słowa kluczowe, w ostateczności „Inne".
 *
 * @param normalizedName - Klucz nazwy.
 * @param productSection - Dział produktu ze słownika, jeśli jest.
 * @returns Dział.
 */
export function suggestShoppingSection(
  normalizedName: string,
  productSection: ShoppingSection | null,
): ShoppingSection {
  if (productSection !== null) return productSection;
  const firstWord = normalizedName.split(' ', 1).join('');
  return SHOPPING_SECTION_KEYWORDS[firstWord] ?? 'other';
}

/**
 * Czy propozycja z przepisu trafia do „Już mam" (07 §14.5).
 *
 * Słownik gospodarstwa wygrywa z oceną modelu: produkt, któremu ktoś zdjął flagę
 * („Nie zawsze mam"), nie wraca do „Już mam" tylko dlatego, że model uważa go za
 * podstawowy.
 *
 * @param product - Produkt ze słownika o tej samej nazwie albo `null`.
 * @param product.isStaple - Czy produkt ma flagę „zawsze w domu".
 * @param pantryStaple - Ocena modelu.
 * @returns `true` — sekcja „Już mam".
 */
export function isAlreadyHave(
  product: { isStaple: boolean } | null,
  pantryStaple: boolean,
): boolean {
  return product === null ? pantryStaple : product.isStaple;
}

/** Pozycja w zakresie potrzebnym do sortowania na ekranie. */
export interface SortableShoppingItem {
  readonly id: string;
  readonly section: ShoppingSection;
  readonly sortOrder: number;
  readonly checkedAt: number | null;
  readonly createdAt: number;
}

/**
 * Kolejność pozycji na ekranie (07 §14.6, ADR-104): do kupienia wg `sortOrder`
 * (przeciąganie), potem czasu dopisania — w widoku z działami najpierw dział w stałej
 * kolejności (P-5); kupione na końcu, ostatnio odhaczone na górze.
 *
 * @param items - Pozycje.
 * @param options - Widok.
 * @param options.bySection - Widok z działami (domyślnie `true` — tak sortuje serwer).
 * @returns Nowa tablica w kolejności ekranu.
 */
export function sortShoppingItems<T extends SortableShoppingItem>(
  items: readonly T[],
  options: { readonly bySection?: boolean } = {},
): T[] {
  const bySectionView = options.bySection ?? true;
  const order = ShoppingSectionSchema.options;
  return [...items].sort((a, b) => {
    if ((a.checkedAt === null) !== (b.checkedAt === null)) return a.checkedAt === null ? -1 : 1;
    if (a.checkedAt !== null && b.checkedAt !== null && a.checkedAt !== b.checkedAt) {
      return b.checkedAt - a.checkedAt;
    }
    if (a.checkedAt === null) {
      const bySection = bySectionView ? order.indexOf(a.section) - order.indexOf(b.section) : 0;
      if (bySection !== 0) return bySection;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    }
    return byCreation(a, b);
  });
}

/** Lista w zakresie potrzebnym do wyboru domyślnej. */
export interface DefaultListCandidate {
  readonly id: string;
  readonly archivedAt: number | null;
  readonly sortOrder: number;
  readonly createdAt: number;
}

/**
 * Lista, która przejmuje flagę domyślnej, gdy dotychczasowa znika z widoku (I-26):
 * pierwsza niezarchiwizowana według kolejności, potem czasu założenia.
 *
 * @param lists - Listy gospodarstwa bez tej, która traci flagę.
 * @returns Nowa domyślna albo `null`, gdy żadna nie została.
 */
export function nextDefaultList<T extends DefaultListCandidate>(lists: readonly T[]): T | null {
  const active = lists
    .filter((list) => list.archivedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
  return active[0] ?? null;
}

/**
 * Ilość do wyświetlenia: „1,5 kg", „2 szt.", „1 opak." (06 §3.15).
 *
 * @param quantity - Ilość z jednostką.
 * @returns Tekst albo `''`, gdy pozycja nie ma ilości.
 */
export function formatShoppingQuantity(quantity: ShoppingQuantity): string {
  if (quantity.quantityMilli === null || quantity.unit === null) return '';
  const whole = Math.floor(quantity.quantityMilli / MILLI_PER_UNIT);
  const fraction = String(quantity.quantityMilli % MILLI_PER_UNIT)
    .padStart(3, '0')
    .replace(/0+$/, '');
  const number = fraction === '' ? String(whole) : `${whole},${fraction}`;
  return `${number} ${SHOPPING_UNIT_LABELS[quantity.unit]}`;
}
