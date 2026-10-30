import { daysBetween } from '../utils/month.js';

/**
 * Reguły dokumentów wspólne dla API i ekranu przeglądu
 * ([08 §10, §11](../../../../plans/08-ocr-ai-pipeline.md#10-wykrywanie-duplikatów), 06 §3.4).
 *
 * Suma zaznaczonych pozycji liczy się tak samo na ekranie („Zaznaczono 8 z 8 · 127,99 zł")
 * i w commicie `single` — inaczej użytkownik zatwierdziłby inną kwotę, niż widział.
 */

/** Minimum, którego potrzebują reguły z pozycji dokumentu. */
export interface DocumentItemAmount {
  readonly amountMinor: number;
  readonly direction: 'inflow' | 'outflow';
}

/**
 * Suma netto pozycji: obciążenia minus rabaty i zwroty.
 *
 * Rabat na paragonie to pozycja `inflow` — pomniejsza zapłaconą kwotę, a nie jest
 * osobnym przychodem.
 *
 * @param items - Pozycje (zwykle zaznaczone).
 * @returns Kwota netto w groszach; dodatnia, gdy więcej zapłacono niż odzyskano.
 */
export function documentItemsNetMinor(items: readonly DocumentItemAmount[]): number {
  return items.reduce(
    (sum, item) => sum + (item.direction === 'outflow' ? item.amountMinor : -item.amountMinor),
    0,
  );
}

/** Wynik kontroli sumy paragonu (06 §3.4). */
export type TotalCheck =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'match' }
  | { readonly kind: 'mismatch'; readonly differenceMinor: number };

/**
 * Porównuje sumę pozycji z sumą odczytaną z dokumentu.
 *
 * Rozbieżność **nie blokuje** zapisu — paragony mają rabaty i kaucje, których model mógł
 * nie zinterpretować. Użytkownik rozstrzyga, widząc różnicę.
 *
 * @param totalMinor - Suma z dokumentu albo `null`, gdy nieczytelna.
 * @param items - Wszystkie pozycje dokumentu (bez odrzuconych).
 * @returns Zgodna, niezgodna z różnicą (pozycje − suma) albo nieznana.
 */
export function checkDocumentTotal(
  totalMinor: number | null,
  items: readonly DocumentItemAmount[],
): TotalCheck {
  if (totalMinor === null || items.length === 0) return { kind: 'unknown' };
  const differenceMinor = documentItemsNetMinor(items) - totalMinor;
  return differenceMinor === 0 ? { kind: 'match' } : { kind: 'mismatch', differenceMinor };
}

/** Okno dat dopasowania duplikatu: data księgowania w banku bywa inna niż zakupu (08 §10). */
export const DUPLICATE_WINDOW_DAYS = 3;

/** Pozycja szukająca duplikatu. */
export interface DuplicateProbe extends DocumentItemAmount {
  readonly bookedOn: string | null;
}

/** Transakcja, która może być duplikatem. */
export interface DuplicateTarget {
  readonly id: string;
  readonly type: 'expense' | 'income' | 'transfer';
  readonly bookedOn: string;
  readonly amountMinor: number;
  readonly accountId: string | null;
  readonly counterAccountId: string | null;
}

/**
 * Czy transakcja płynie w tę samą stronę co pozycja — z perspektywy konta wyciągu.
 *
 * Obciążenie na wyciągu to wydatek albo przelew **z** tego konta; uznanie — przychód
 * albo przelew **na** nie. Bez znanego konta przelew pasuje w obie strony.
 *
 * @param probe - Pozycja.
 * @param target - Transakcja.
 * @param accountId - Konto dokumentu albo `null`.
 * @returns `true`, gdy kierunek się zgadza.
 */
function sameDirection(
  probe: DuplicateProbe,
  target: DuplicateTarget,
  accountId: string | null,
): boolean {
  if (target.type === 'transfer') {
    if (accountId === null) return true;
    return probe.direction === 'outflow'
      ? target.accountId === accountId
      : target.counterAccountId === accountId;
  }
  return probe.direction === 'outflow' ? target.type === 'expense' : target.type === 'income';
}

/**
 * Szuka istniejących transakcji odpowiadających odczytanym pozycjom.
 *
 * Dopasowanie wymaga zgodności kwoty co do grosza oraz daty w oknie ±3 dni
 * (data księgowania w banku bywa inna niż data zakupu) i tego samego konta, gdy jest
 * znane. Podobieństwo opisu nie jest warunkiem — wyciągi mają inne opisy niż wpisy ręczne.
 *
 * Jedna transakcja może być duplikatem **jednej** pozycji: dwie płatności po 12 zł
 * w tym samym tygodniu i jeden wpis ręczny to jeden duplikat i jedna nowa pozycja.
 * Pozycja bierze kandydata najbliższego datą.
 *
 * @param items - Pozycje w kolejności dokumentu.
 * @param candidates - Transakcje z okolicy dat.
 * @param accountId - Konto dokumentu albo `null`.
 * @returns Identyfikator transakcji-duplikatu dla każdej pozycji albo `null`.
 */
export function findDuplicates(
  items: readonly DuplicateProbe[],
  candidates: readonly DuplicateTarget[],
  accountId: string | null,
): (string | null)[] {
  const taken = new Set<string>();
  return items.map((item) => {
    if (item.bookedOn === null) return null;
    const bookedOn = item.bookedOn;
    let best: { id: string; distance: number } | null = null;
    for (const candidate of candidates) {
      if (taken.has(candidate.id) || candidate.amountMinor !== item.amountMinor) continue;
      if (!sameDirection(item, candidate, accountId)) continue;
      if (
        accountId !== null &&
        candidate.type !== 'transfer' &&
        candidate.accountId !== null &&
        candidate.accountId !== accountId
      ) {
        continue;
      }
      const distance = Math.abs(daysBetween(bookedOn, candidate.bookedOn));
      if (distance > DUPLICATE_WINDOW_DAYS) continue;
      if (best === null || distance < best.distance) best = { id: candidate.id, distance };
    }
    if (best === null) return null;
    taken.add(best.id);
    return best.id;
  });
}

/** Pozycja z propozycją nowej kategorii. */
export interface ProposalSource {
  readonly id: string;
  readonly direction: 'inflow' | 'outflow';
  readonly suggestedCategoryId: string | null;
  readonly suggestedCategoryName: string | null;
  readonly reviewStatus: string;
}

/** Propozycja nowej kategorii zebrana z pozycji. */
export interface CategoryProposal {
  readonly name: string;
  readonly kind: 'expense' | 'income';
  readonly itemIds: string[];
}

/**
 * Zbiera propozycje nowych kategorii z pozycji bez wybranej kategorii (wymaganie #5).
 *
 * Nazwy porównywane bez względu na wielkość liter — „Elektronika" i „elektronika" to
 * jedna propozycja. Odrzucone pozycje się nie liczą. Rodzaj wynika z kierunku.
 *
 * @param items - Pozycje dokumentu.
 * @returns Propozycje w kolejności pierwszego wystąpienia.
 */
export function collectCategoryProposals(items: readonly ProposalSource[]): CategoryProposal[] {
  const byKey = new Map<string, CategoryProposal>();
  for (const item of items) {
    if (item.reviewStatus === 'rejected' || item.suggestedCategoryId !== null) continue;
    const name = item.suggestedCategoryName?.trim() ?? '';
    if (name === '') continue;
    const kind = item.direction === 'inflow' ? 'income' : 'expense';
    const key = `${kind}:${name.toLocaleLowerCase('pl-PL')}`;
    const existing = byKey.get(key);
    if (existing === undefined) byKey.set(key, { name, kind, itemIds: [item.id] });
    else existing.itemIds.push(item.id);
  }
  return [...byKey.values()];
}

/** Pozycja wchodząca do podziału po kategoriach, z kluczem kategorii już rozstrzygniętym. */
export interface CategoryGroupSource extends DocumentItemAmount {
  readonly id: string;
  /**
   * Klucz kategorii **wydatku** pozycji albo `null`, gdy jej nie ma (albo jest innego
   * rodzaju). Serwer podaje identyfikator; ekran — identyfikator albo znacznik
   * przyjętej propozycji nowej kategorii.
   */
  readonly categoryKey: string | null;
}

/** Grupa pozycji zapisywana jako jedna transakcja wydatku. */
export interface CategoryGroup {
  /** Klucz kategorii; `null` tylko wtedy, gdy żadna pozycja nie ma kategorii. */
  readonly categoryKey: string | null;
  /** Suma netto grupy w groszach — dodatnia, jeśli podział się udał. */
  readonly amountMinor: number;
  /** Pozycje grupy w kolejności z dokumentu. */
  readonly itemIds: string[];
}

/** Wynik podziału po kategoriach. */
export type CategoryGrouping =
  | { readonly ok: true; readonly groups: CategoryGroup[] }
  | { readonly ok: false; readonly reason: 'non_positive_total' };

/**
 * Dzieli pozycje paragonu na grupy — jedna transakcja wydatku na kategorię
 * ([07 §9.4](../../../../plans/07-domain-rules.md#94-podział-dokumentu-po-kategoriach), ADR-069).
 *
 * Paragon „jedzenie + worki na śmieci" to dwie transakcje w dwóch kategoriach, a nie
 * jedna źle skategoryzowana albo trzydzieści jednoproduktowych. Pozycja bez kategorii
 * i rabat bez kategorii wydatku trafiają do grupy **dominującej** (najwięcej obciążeń —
 * ta sama reguła, co kategoria całości w trybie `single`), bo tam najpewniej należą:
 * niepewna pozycja paragonu z dziesięcioma produktami spożywczymi i jedną patelnią
 * to raczej jedzenie, choć patelnia kosztuje więcej — a osobna transakcja „bez kategorii" zaśmiecałaby
 * historię. Grupa, która po rabatach nie ma dodatniej sumy, też wchodzi do dominującej:
 * wydatek musi mieć dodatnią kwotę (I-3).
 *
 * Ekran liczy tą funkcją podgląd, serwer — zapis, więc użytkownik zatwierdza dokładnie
 * to, co widzi. Kwoty to sumy całkowitych groszy: bez dzielenia, bez zaokrągleń.
 *
 * @param items - Zaznaczone pozycje w kolejności z dokumentu.
 * @returns Grupy malejąco po kwocie albo błąd, gdy suma netto nie jest dodatnia.
 */
export function groupItemsByCategory(items: readonly CategoryGroupSource[]): CategoryGrouping {
  if (documentItemsNetMinor(items) <= 0) return { ok: false, reason: 'non_positive_total' };

  // Grupy tworzą wyłącznie obciążenia z kategorią; wartość = liczba pozycji. Kolejność
  // wstawienia = kolejność pierwszego wystąpienia na paragonie, co rozstrzyga remis.
  const outflow = new Map<string, number>();
  for (const item of items) {
    if (item.direction !== 'outflow' || item.categoryKey === null) continue;
    outflow.set(item.categoryKey, (outflow.get(item.categoryKey) ?? 0) + 1);
  }
  if (outflow.size === 0) {
    return {
      ok: true,
      groups: [
        {
          categoryKey: null,
          amountMinor: documentItemsNetMinor(items),
          itemIds: items.map((item) => item.id),
        },
      ],
    };
  }

  let dominant: string | null = null;
  for (const [key, count] of outflow) {
    if (dominant === null || count > (outflow.get(dominant) ?? 0)) dominant = key;
  }
  const dominantKey = dominant ?? '';

  const target = (item: CategoryGroupSource): string =>
    item.categoryKey !== null && outflow.has(item.categoryKey) ? item.categoryKey : dominantKey;

  const netOf = (key: string, members: readonly CategoryGroupSource[]): number =>
    documentItemsNetMinor(members.filter((item) => target(item) === key));

  // Grupy z niedodatnią sumą (rabat większy niż zakupy danej kategorii) łączymy
  // z dominującą; gdy sama dominująca nie ma dodatniej sumy — wszystko w jedną grupę.
  const merged = new Set<string>();
  for (const key of outflow.keys()) {
    if (key !== dominantKey && netOf(key, items) <= 0) merged.add(key);
  }
  const finalKey = (item: CategoryGroupSource): string => {
    const key = target(item);
    return merged.has(key) ? dominantKey : key;
  };
  const dominantNet = documentItemsNetMinor(items.filter((item) => finalKey(item) === dominantKey));
  const keyOf = dominantNet > 0 ? finalKey : (): string => dominantKey;

  const groups = new Map<string, { amountMinor: number; itemIds: string[] }>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? { amountMinor: 0, itemIds: [] };
    group.amountMinor += item.direction === 'outflow' ? item.amountMinor : -item.amountMinor;
    group.itemIds.push(item.id);
    groups.set(key, group);
  }
  return {
    ok: true,
    groups: [...groups.entries()]
      .map(([categoryKey, group]) => ({ categoryKey, ...group }))
      .sort((a, b) => b.amountMinor - a.amountMinor),
  };
}
