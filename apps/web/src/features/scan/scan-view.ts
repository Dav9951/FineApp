import {
  checkDocumentTotal,
  documentItemsNetMinor,
  groupItemsByCategory,
  LOW_CONFIDENCE,
  type CategoryGroup,
  type CommitDocumentRequest,
  type CommitNewCategory,
  type DocumentDto,
  type DocumentItemDto,
  type DocumentListItemDto,
  type DocumentStatus,
  type TotalCheck,
  type UploadDocumentKind,
} from '@fineapp/shared';

/**
 * Reguły ekranów skanu ([06 §3.4](../../../../../plans/06-ui-views.md#34-skanowanie--scan),
 * `F7-8`, `F7-10`) — czyste funkcje, testowane bez renderowania.
 *
 * Zasada ekranu: **pewność widoczna, nie ukryta**. Pozycja poniżej 60% dostaje znacznik
 * i wyróżnione tło, suma niezgodna — różnicę na czerwono, ale zapisu nic nie blokuje.
 */

/** Rodzaje do wyboru przy wrzuceniu — w kolejności z makiety 06 §3.4.A. */
export const KIND_OPTIONS: readonly { value: UploadDocumentKind; label: string }[] = [
  { value: 'receipt', label: 'Paragon' },
  { value: 'bank_statement', label: 'Wyciąg' },
  { value: 'invoice', label: 'Faktura' },
];

/** Nazwa rodzaju dokumentu w nagłówku. */
export const KIND_LABEL: Readonly<Record<DocumentDto['kind'], string>> = {
  receipt: 'Paragon',
  bank_statement: 'Wyciąg',
  invoice: 'Faktura',
  other: 'Dokument',
};

/**
 * Czy dokument jest jeszcze w drodze — front odpytuje o wynik co 1,5 s.
 *
 * @param status - Status dokumentu.
 * @returns `true` dla `uploaded` i `processing`.
 */
export function isInFlight(status: DocumentStatus): boolean {
  return status === 'uploaded' || status === 'processing';
}

/**
 * Tytuł dokumentu: rodzaj i sprzedawca, gdy jest.
 *
 * @param kind - Rodzaj dokumentu.
 * @param merchant - Sprzedawca albo `null`.
 * @returns Np. „Paragon · Lidl".
 */
export function documentTitle(kind: DocumentDto['kind'], merchant: string | null): string {
  return merchant === null ? KIND_LABEL[kind] : `${KIND_LABEL[kind]} · ${merchant}`;
}

/** Wiersz listy „Ostatnie" po przygotowaniu do wyświetlenia. */
export interface RecentRow {
  readonly title: string;
  readonly caption: string;
  readonly tone: 'neutral' | 'progress' | 'danger' | 'success';
}

/** Podpis statusu na liście „Ostatnie". */
const STATUS_CAPTION: Readonly<Record<DocumentStatus, string>> = {
  uploaded: 'w kolejce…',
  processing: 'przetwarzanie…',
  parsed: 'do przejrzenia',
  failed: 'nie udało się odczytać',
  committed: 'zapisany',
  discarded: 'odrzucony',
};

/**
 * Wiersz listy „Ostatnie": tytuł i podpis ze statusem.
 *
 * @param item - Dokument z listy.
 * @returns Tytuł, podpis i ton ikony.
 */
export function recentRow(item: DocumentListItemDto): RecentRow {
  const title = documentTitle(item.kind, item.merchant);
  let tone: RecentRow['tone'] = 'neutral';
  if (isInFlight(item.status)) tone = 'progress';
  else if (item.status === 'failed') tone = 'danger';
  else if (item.status === 'committed') tone = 'success';
  const count =
    item.status === 'parsed' && item.itemCount > 0 ? ` · ${String(item.itemCount)} poz.` : '';
  return { title, caption: `${STATUS_CAPTION[item.status]}${count}`, tone };
}

/**
 * Czy pozycja wymaga uwagi: pewność poniżej 60% (06 §3.4).
 *
 * @param item - Pozycja.
 * @returns `true`, gdy pewność jest znana i niska.
 */
export function isUncertain(item: Pick<DocumentItemDto, 'confidence'>): boolean {
  return item.confidence !== null && item.confidence < LOW_CONFIDENCE;
}

/**
 * Pewność jako procent do podpisu („97%").
 *
 * @param confidence - Pewność 0–1 albo `null`.
 * @returns Tekst albo `null`.
 */
export function confidenceLabel(confidence: number | null): string | null {
  return confidence === null ? null : `${String(Math.round(confidence * 100))}%`;
}

/**
 * Pozycje zaznaczone domyślnie: wszystkie poza odrzuconymi — w tym możliwe duplikaty
 * z wyciągu, które serwer odznacza (08 §10).
 *
 * @param items - Pozycje dokumentu.
 * @returns Zbiór identyfikatorów.
 */
export function defaultSelection(items: readonly DocumentItemDto[]): Set<string> {
  return new Set(items.filter((item) => item.reviewStatus !== 'rejected').map((item) => item.id));
}

/** Tryb zatwierdzenia. */
export type CommitMode = CommitDocumentRequest['mode'];

/** Przedrostek klucza grupy dla przyjętej propozycji nowej kategorii (jeszcze bez id). */
const NEW_CATEGORY_KEY = 'new:';

/**
 * Klucz kategorii pozycji w podziale „Kategorie" — to samo, co serwer liczy przy zapisie
 * (07 §9.4): kategoria **wydatku** pozycji albo przyjęta propozycja nowej kategorii
 * wydatku.
 *
 * @param item - Pozycja.
 * @param isExpenseCategory - Czy identyfikator to aktywna kategoria wydatku.
 * @param accepted - Przyjęte propozycje nowych kategorii.
 * @returns Klucz grupy albo `null`.
 */
export function groupingKey(
  item: Pick<DocumentItemDto, 'suggestedCategoryId' | 'suggestedCategoryName'>,
  isExpenseCategory: (id: string) => boolean,
  accepted: readonly CommitNewCategory[],
): string | null {
  if (item.suggestedCategoryId !== null) {
    return isExpenseCategory(item.suggestedCategoryId) ? item.suggestedCategoryId : null;
  }
  const name = item.suggestedCategoryName?.trim().toLocaleLowerCase('pl-PL');
  if (name === undefined || name === '') return null;
  const proposal = accepted.find(
    (entry) => entry.kind === 'expense' && entry.name.toLocaleLowerCase('pl-PL') === name,
  );
  return proposal === undefined ? null : `${NEW_CATEGORY_KEY}${proposal.name}`;
}

/**
 * Nazwa nowej kategorii zapisana w kluczu grupy.
 *
 * @param key - Klucz grupy.
 * @returns Nazwa propozycji albo `null`, gdy klucz to identyfikator kategorii.
 */
export function proposalNameOfKey(key: string): string | null {
  return key.startsWith(NEW_CATEGORY_KEY) ? key.slice(NEW_CATEGORY_KEY.length) : null;
}

/**
 * Podgląd trybu „Kategorie": grupy zaznaczonych pozycji, tak jak zapisze je serwer.
 *
 * @param items - Pozycje dokumentu.
 * @param selected - Zaznaczone.
 * @param keyOf - Klucz kategorii pozycji ({@link groupingKey}).
 * @returns Grupy malejąco po kwocie; pusta lista, gdy suma nie jest dodatnia.
 */
export function categoryGroups(
  items: readonly DocumentItemDto[],
  selected: ReadonlySet<string>,
  keyOf: (item: DocumentItemDto) => string | null,
): CategoryGroup[] {
  const result = groupItemsByCategory(
    items
      .filter((item) => selected.has(item.id))
      .map((item) => ({
        id: item.id,
        amountMinor: item.amountMinor,
        direction: item.direction,
        categoryKey: keyOf(item),
      })),
  );
  return result.ok ? result.groups : [];
}

/**
 * Tryb domyślny (08 §11, ADR-069): wyciąg — po operacji; paragon i faktura z pozycjami
 * w co najmniej dwóch kategoriach — jedna transakcja na kategorię („jedzenie + worki na
 * śmieci" to dwa wydatki); inaczej jedna transakcja na całość, bo 30 pozycji zakupów
 * zaśmieciłoby historię.
 *
 * Liczy się przy pierwszym renderze, zanim drzewo kategorii zdąży się wczytać — dlatego
 * klucze biorą tylko obciążenia: kategoria obciążenia jest zawsze kategorią wydatku
 * (serwer tego pilnuje), a to obciążenia tworzą grupy.
 *
 * @param kind - Rodzaj dokumentu.
 * @param items - Pozycje dokumentu.
 * @param selected - Zaznaczone pozycje.
 * @returns Tryb.
 */
export function defaultMode(
  kind: DocumentDto['kind'],
  items: readonly DocumentItemDto[] = [],
  selected: ReadonlySet<string> = new Set(),
): CommitMode {
  if (kind === 'bank_statement') return 'split';
  const groups = categoryGroups(items, selected, (item) =>
    item.direction === 'outflow' ? item.suggestedCategoryId : null,
  );
  return groups.length >= 2 ? 'by_category' : 'single';
}

/**
 * Kategoria całości w trybie `single`: najczęstsza wśród zaznaczonych obciążeń
 * (remis — pierwsza na paragonie).
 *
 * @param items - Pozycje dokumentu.
 * @param selected - Zaznaczone.
 * @returns Identyfikator kategorii albo `null`.
 */
export function dominantCategory(
  items: readonly DocumentItemDto[],
  selected: ReadonlySet<string>,
): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const item of items) {
    if (!selected.has(item.id) || item.direction !== 'outflow') continue;
    if (item.suggestedCategoryId === null) continue;
    const count = (counts.get(item.suggestedCategoryId) ?? 0) + 1;
    counts.set(item.suggestedCategoryId, count);
    if (best === null || count > (counts.get(best) ?? 0)) best = item.suggestedCategoryId;
  }
  return best;
}

/** Podsumowanie stopki: „Zaznaczono 7 z 8 · 127,99 zł". */
export interface SelectionSummary {
  readonly selectedCount: number;
  readonly totalCount: number;
  /** Suma netto zaznaczonych — to, co zapisze commit `single`. */
  readonly netMinor: number;
}

/**
 * Podsumowanie zaznaczenia.
 *
 * @param items - Pozycje.
 * @param selected - Zaznaczone.
 * @returns Liczniki i suma netto.
 */
export function selectionSummary(
  items: readonly DocumentItemDto[],
  selected: ReadonlySet<string>,
): SelectionSummary {
  const chosen = items.filter((item) => selected.has(item.id));
  return {
    selectedCount: chosen.length,
    totalCount: items.length,
    netMinor: documentItemsNetMinor(chosen),
  };
}

/**
 * Kontrola sumy paragonu na ekranie — wszystkie nieodrzucone pozycje kontra suma z nagłówka.
 *
 * Liczymy **wszystkie** pozycje, a nie zaznaczone: odznaczenie pozycji to decyzja, czego
 * nie zapisać, a nie dowód, że model źle odczytał paragon.
 *
 * @param document - Dokument.
 * @returns Wynik porównania.
 */
export function documentTotalCheck(document: DocumentDto): TotalCheck {
  if (document.kind === 'bank_statement') return { kind: 'unknown' };
  return checkDocumentTotal(document.summary?.totalMinor ?? null, document.items);
}

/** Stan przeglądu przed zatwierdzeniem. */
export interface ReviewDraft {
  readonly mode: CommitMode;
  readonly accountId: string | null;
  readonly bookedOn: string;
  readonly categoryId: string | null;
  readonly selected: ReadonlySet<string>;
  /** Propozycje nowych kategorii przyjęte „Dodaj" — nazwy w kolejności przyjęcia. */
  readonly acceptedProposals: readonly CommitNewCategory[];
}

/** Wynik złożenia commitu. */
export type CommitBuild =
  | { readonly ok: true; readonly body: CommitDocumentRequest }
  | { readonly ok: false; readonly message: string };

/**
 * Składa ciało commitu z przeglądu albo mówi, czego brakuje.
 *
 * @param draft - Stan przeglądu.
 * @param summary - Podsumowanie zaznaczenia.
 * @returns Ciało żądania albo komunikat.
 */
export function buildCommit(draft: ReviewDraft, summary: SelectionSummary): CommitBuild {
  if (draft.accountId === null) return { ok: false, message: 'Wybierz konto.' };
  if (summary.selectedCount === 0)
    return { ok: false, message: 'Zaznacz przynajmniej jedną pozycję.' };
  if (draft.mode === 'by_category' && summary.netMinor <= 0) {
    return { ok: false, message: 'Suma zaznaczonych pozycji musi być dodatnia.' };
  }
  if (draft.mode === 'single') {
    if (draft.categoryId === null) return { ok: false, message: 'Wybierz kategorię dla całości.' };
    if (summary.netMinor <= 0) {
      return { ok: false, message: 'Suma zaznaczonych pozycji musi być dodatnia.' };
    }
  }
  return {
    ok: true,
    body: {
      mode: draft.mode,
      accountId: draft.accountId,
      bookedOn: draft.bookedOn,
      categoryId: draft.mode === 'single' ? draft.categoryId : null,
      itemIds: [...draft.selected],
      createCategories: [...draft.acceptedProposals],
    },
  };
}

/**
 * Czy propozycja z pozycji została przyjęta „Dodaj".
 *
 * @param accepted - Przyjęte propozycje.
 * @param item - Pozycja z propozycją.
 * @returns `true`, gdy nazwa (bez wielkości liter) jest na liście.
 */
export function proposalAccepted(
  accepted: readonly CommitNewCategory[],
  item: Pick<DocumentItemDto, 'suggestedCategoryName' | 'direction'>,
): boolean {
  if (item.suggestedCategoryName === null) return false;
  const kind = item.direction === 'inflow' ? 'income' : 'expense';
  const name = item.suggestedCategoryName.toLocaleLowerCase('pl-PL');
  return accepted.some(
    (proposal) => proposal.kind === kind && proposal.name.toLocaleLowerCase('pl-PL') === name,
  );
}

/** Wynik przetworzenia pliku przed wysyłką. */
export interface FitSize {
  readonly width: number;
  readonly height: number;
  readonly scaled: boolean;
}

/** Dłuższy bok zdjęcia wysyłanego na serwer (06 §6, 08 §3). */
export const CLIENT_MAX_EDGE_PX = 1568;

/**
 * Wymiary po zmieszczeniu w kwadracie `max × max` z zachowaniem proporcji — bez powiększania.
 *
 * @param width - Szerokość źródła.
 * @param height - Wysokość źródła.
 * @param max - Dłuższy bok docelowy.
 * @returns Wymiary i informacja, czy trzeba skalować.
 */
export function fitWithin(width: number, height: number, max = CLIENT_MAX_EDGE_PX): FitSize {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height, scaled: false };
  const ratio = max / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  };
}
