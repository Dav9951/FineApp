import {
  findMergeTarget,
  mergeNotes,
  mergeQuantities,
  normalizeShoppingName,
  sortShoppingItems,
  suggestShoppingSection,
  tidyShoppingName,
  type CreateShoppingItemRequest,
  type ReorderShoppingItemsRequest,
  type ShoppingItemDto,
  type ShoppingItemsDto,
  type UpdateShoppingItemRequest,
} from '@fineapp/shared';

import { ApiRequestError } from '../../lib/api-client.js';
import { newClientId } from '../../lib/client-id.js';
import { readOffline, removeOffline, writeOffline } from '../../lib/offline-store.js';
import * as shoppingApi from './api.js';

/**
 * Praca list zakupów bez sieci ([ADR-096](../../../../../plans/14-decisions-log.md#adr-096),
 * 06 §3.15, 07 §14.7).
 *
 * Dwie rzeczy:
 *
 * 1. **Migawka** ostatnio wczytanej listy na urządzeniu — po powrocie do ekranu bez zasięgu
 *    lista jest od razu, zamiast pustego ekranu z błędem.
 * 2. **Kolejka zmian** (dopisz, zmień, usuń, wyczyść kupione), które nie doszły do serwera.
 *    Każda jest bezpieczna do powtórzenia: dopisanie ma identyfikator od klienta (klucz
 *    idempotencji), odhaczenie i usunięcie są idempotentne po stronie API. Kolejka idzie
 *    po kolei, w tej samej kolejności, w jakiej zmiany powstały.
 *
 * Dopóki zmiana czeka, ekran pokazuje ją **nałożoną** na dane z serwera ({@link applyOps}) —
 * odpytywanie co 15 s nie może jej „cofnąć" na oczach użytkownika.
 */

/** Zmiana pozycji czekająca na sieć (bez identyfikatora — nadaje go {@link enqueue}). */
export type OutboxChange =
  | {
      readonly kind: 'add';
      readonly listId: string;
      readonly body: CreateShoppingItemRequest & { readonly id: string };
    }
  | {
      readonly kind: 'update';
      readonly listId: string;
      readonly itemId: string;
      readonly body: UpdateShoppingItemRequest;
    }
  | { readonly kind: 'delete'; readonly listId: string; readonly itemId: string }
  | { readonly kind: 'clear'; readonly listId: string }
  /** „Cofnij" po „Wyczyść kupione" — za czyszczeniem w tej samej kolejce. */
  | { readonly kind: 'restore'; readonly listId: string; readonly itemIds: readonly string[] }
  /** Kolejność po przeciągnięciu (ADR-104) — idempotentna, nieznane pozycje serwer pomija. */
  | {
      readonly kind: 'reorder';
      readonly listId: string;
      readonly body: ReorderShoppingItemsRequest;
    };

/** Zmiana w kolejce — z identyfikatorem, po którym schodzi z kolejki i jest zgłaszana. */
export type OutboxOp = OutboxChange & { readonly opId: string };

/**
 * Kody odpowiedzi, przy których serwer **ostatecznie** odmówił zmiany — powtarzanie nic nie
 * da (pozycja usunięta, lista w archiwum, zły kształt). Pozostałe błędy (`401` po
 * wygaśnięciu tokenu, `429`, `5xx`) zostawiają zmianę w kolejce na następną próbę.
 */
const FINAL_REJECTION = new Set([400, 404, 409, 422]);

const OUTBOX_KEY = 'shopping.outbox';

/**
 * Klucz migawki listy.
 *
 * @param listId - Lista.
 * @returns Klucz magazynu.
 */
function snapshotKey(listId: string): string {
  return `shopping.items.${listId}`;
}

/**
 * Czy wartość wygląda na kolejkę zmian — magazyn mógł zostać zapisany przez starszą wersję.
 *
 * @param value - Odczyt z magazynu.
 * @returns `true`, gdy to tablica obiektów z polem `kind`.
 */
function isOutbox(value: unknown): value is OutboxOp[] {
  return (
    Array.isArray(value) &&
    value.every(
      (op) =>
        typeof op === 'object' && op !== null && 'kind' in op && 'listId' in op && 'opId' in op,
    )
  );
}

/**
 * Zmiany czekające na sieć.
 *
 * @returns Kolejka w kolejności powstania.
 */
export function readOutbox(): OutboxOp[] {
  const value = readOffline(OUTBOX_KEY);
  return isOutbox(value) ? value : [];
}

/**
 * Zapisuje kolejkę.
 *
 * @param ops - Kolejka.
 */
function writeOutbox(ops: readonly OutboxOp[]): void {
  if (ops.length === 0) removeOffline(OUTBOX_KEY);
  else writeOffline(OUTBOX_KEY, ops);
}

/**
 * Dokłada zmianę na koniec kolejki.
 *
 * @param change - Zmiana.
 * @returns Zmiana z identyfikatorem w kolejce.
 */
export function enqueue(change: OutboxChange): OutboxOp {
  const op = { ...change, opId: newClientId() } as OutboxOp;
  writeOutbox([...readOutbox(), op]);
  return op;
}

/** Zmiana właśnie wysyłana — nie wolno jej wyjąć z kolejki w trakcie. */
let inFlightOpId: string | null = null;

/**
 * „Cofnij" po „Wyczyść kupione". Gdy czyszczenie jeszcze nie wyszło, po prostu znika
 * z kolejki; w przeciwnym razie za nim staje przywrócenie — serwer zobaczy obie zmiany
 * w kolejności, w jakiej powstały.
 *
 * @param listId - Lista.
 * @param itemIds - Wyczyszczone pozycje.
 * @returns `cancelled` — czyszczenie wycofane przed wysłaniem; `queued` — przywrócenie w kolejce.
 */
export function undoClear(listId: string, itemIds: readonly string[]): 'cancelled' | 'queued' {
  const ops = readOutbox();
  const index = ops.findLastIndex(
    (op) => op.kind === 'clear' && op.listId === listId && op.opId !== inFlightOpId,
  );
  if (index >= 0) {
    writeOutbox(ops.filter((_, position) => position !== index));
    return 'cancelled';
  }
  enqueue({ kind: 'restore', listId, itemIds });
  return 'queued';
}

/**
 * Zapomina listę na urządzeniu — po `404` (usunięta na drugim telefonie): migawka i jej
 * zmiany w kolejce i tak nie mają już dokąd trafić.
 *
 * @param listId - Lista.
 */
export function forgetList(listId: string): void {
  removeOffline(snapshotKey(listId));
  writeOutbox(readOutbox().filter((op) => op.listId !== listId || op.opId === inFlightOpId));
}

/**
 * Zmiany czekające dla jednej listy.
 *
 * @param listId - Lista.
 * @returns Zmiany w kolejności powstania.
 */
export function pendingOps(listId: string): OutboxOp[] {
  return readOutbox().filter((op) => op.listId === listId);
}

/**
 * Ostatnio wczytana lista z urządzenia.
 *
 * @param listId - Lista.
 * @returns Migawka albo `undefined`.
 */
export function readSnapshot(listId: string): ShoppingItemsDto | undefined {
  const value = readOffline(snapshotKey(listId));
  if (
    typeof value !== 'object' ||
    value === null ||
    !('items' in value) ||
    !('list' in value) ||
    !Array.isArray(value.items)
  ) {
    return undefined;
  }
  const data = value as ShoppingItemsDto;
  // Migawki sprzed ADR-104 nie mają `sortOrder` — bez niego sortowanie dostawało `NaN`.
  return {
    ...data,
    items: data.items.map((item) => ({
      ...item,
      sortOrder: (item as Partial<ShoppingItemDto>).sortOrder ?? 0,
    })),
  };
}

/**
 * Zapisuje migawkę listy (bez zmian z kolejki — te nakłada się przy odczycie).
 *
 * @param data - Lista z pozycjami z serwera.
 */
export function writeSnapshot(data: ShoppingItemsDto): void {
  writeOffline(snapshotKey(data.list.id), data);
}

/**
 * Pozycja dopisana lokalnie — zanim serwer ją zobaczy.
 *
 * @param op - Dopisanie.
 * @param now - Znacznik czasu.
 * @param sortOrder - Miejsce na końcu listy (ADR-104).
 * @returns Pozycja w kształcie kontraktu.
 */
function localItem(
  op: Extract<OutboxChange, { kind: 'add' }>,
  now: number,
  sortOrder: number,
): ShoppingItemDto {
  const name = tidyShoppingName(op.body.name);
  return {
    id: op.body.id,
    listId: op.listId,
    productId: null,
    name,
    quantityMilli: op.body.quantityMilli ?? null,
    unit: op.body.unit ?? null,
    note: op.body.note ?? null,
    section: op.body.section ?? suggestShoppingSection(normalizeShoppingName(name), null),
    sortOrder,
    source: 'manual',
    checked: false,
    checkedAt: null,
    checkedByInitials: null,
    isStaple: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Kolejność po przeciągnięciu — te same reguły co serwer (`reorderShoppingItems`, ADR-104):
 * wymienione do kupienia dostają 0…n−1, reszta do kupienia idzie za nimi, kupione bez zmian.
 *
 * @param items - Pozycje.
 * @param body - Kolejność i ewentualna zmiana działu.
 * @param now - Znacznik czasu.
 * @returns Pozycje po zmianie.
 */
function reorderLocally(
  items: readonly ShoppingItemDto[],
  body: ReorderShoppingItemsRequest,
  now: number,
): ShoppingItemDto[] {
  const toBuy = sortShoppingItems(
    items.filter((item) => !item.checked),
    { bySection: false },
  );
  const known = new Set(toBuy.map((item) => item.id));
  const listed = [...new Set(body.itemIds)].filter((id) => known.has(id));
  const order = new Map(
    [...listed, ...toBuy.map((item) => item.id).filter((id) => !listed.includes(id))].map(
      (id, index) => [id, index],
    ),
  );
  return items.map((item) => {
    const index = order.get(item.id);
    if (index === undefined) return item;
    const section = body.move?.itemId === item.id ? body.move.section : item.section;
    return { ...item, sortOrder: index, section, updatedAt: now };
  });
}

/**
 * Nakłada jedną zmianę na pozycje — tymi samymi regułami scalania co serwer (07 §14.3),
 * żeby lista po synchronizacji wyglądała tak samo jak przed nią.
 *
 * @param items - Pozycje.
 * @param op - Zmiana.
 * @param now - Znacznik czasu.
 * @param initials - Inicjały osoby, która odhacza.
 * @returns Pozycje po zmianie.
 */
function applyOp(
  items: readonly ShoppingItemDto[],
  op: OutboxChange,
  now: number,
  initials: string | null,
): ShoppingItemDto[] {
  switch (op.kind) {
    case 'add': {
      if (items.some((item) => item.id === op.body.id)) return [...items];
      const added = localItem(
        op,
        now,
        items.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1,
      );
      const target = findMergeTarget(
        items.map((item) => ({ ...item, normalizedName: normalizeShoppingName(item.name) })),
        normalizeShoppingName(added.name),
        added.unit,
      );
      if (!target) return [...items, added];
      const merged = mergeQuantities(target, added);
      return items.map((item) =>
        item.id === target.id
          ? { ...item, ...merged, note: mergeNotes(item.note, added.note), updatedAt: now }
          : item,
      );
    }
    case 'update':
      return items
        .map((item) => {
          if (item.id !== op.itemId) return item;
          const next: ShoppingItemDto = { ...item, updatedAt: now };
          const { body } = op;
          if (body.name !== undefined) next.name = tidyShoppingName(body.name);
          if (body.quantityMilli === null || body.unit === null) {
            next.quantityMilli = null;
            next.unit = null;
          } else if (body.quantityMilli !== undefined && body.unit !== undefined) {
            next.quantityMilli = body.quantityMilli;
            next.unit = body.unit;
          }
          if (body.note !== undefined) next.note = body.note;
          if (body.section !== undefined) next.section = body.section;
          if (body.checked === true && !item.checked) {
            next.checked = true;
            next.checkedAt = now;
            next.checkedByInitials = initials;
          }
          if (body.checked === false && item.checked) {
            next.checked = false;
            next.checkedAt = null;
            next.checkedByInitials = null;
            // Odznaczona wraca na koniec do kupienia — jak na serwerze (07 §14.6).
            next.sortOrder = items.reduce((max, other) => Math.max(max, other.sortOrder), -1) + 1;
          }
          return next;
        })
        .filter((item) => op.body.listId === undefined || item.id !== op.itemId);
    case 'delete':
      return items.filter((item) => item.id !== op.itemId);
    case 'clear':
      return items.filter((item) => !item.checked);
    case 'restore':
      // Wyczyszczonych nie ma w danych — wrócą z serwera po wysłaniu.
      return [...items];
    case 'reorder':
      return reorderLocally(items, op.body, now);
  }
}

/**
 * Nakłada zmiany z kolejki na listę z serwera i przelicza liczniki.
 *
 * @param data - Lista z pozycjami.
 * @param ops - Zmiany tej listy.
 * @param initials - Inicjały zalogowanej osoby.
 * @param now - Znacznik czasu.
 * @returns Lista, jaką widzi użytkownik.
 */
export function applyOps(
  data: ShoppingItemsDto,
  ops: readonly OutboxChange[],
  initials: string | null,
  now: number = Date.now(),
): ShoppingItemsDto {
  if (ops.length === 0) return data;
  const items = ops.reduce<ShoppingItemDto[]>(
    (current, op) => applyOp(current, op, now, initials),
    [...data.items],
  );
  return {
    list: {
      ...data.list,
      toBuyCount: items.filter((item) => !item.checked).length,
      checkedCount: items.filter((item) => item.checked).length,
    },
    items: sortShoppingItems(items),
  };
}

/** Wynik wysłania kolejki. */
export interface FlushResult {
  /** Zmiany, które doszły do serwera albo zostały przez niego odrzucone. */
  readonly sent: number;
  /** Zmiany odrzucone przez serwer (np. pozycja usunięta przez drugą osobę). */
  readonly rejected: number;
  /** Identyfikatory odrzuconych — ekran zgłasza błąd tylko przy własnej zmianie. */
  readonly rejectedOpIds: readonly string[];
  /** Sieć znów zawiodła — reszta czeka. */
  readonly stoppedOffline: boolean;
}

/**
 * Wysyła jedną zmianę.
 *
 * @param token - Token dostępu.
 * @param op - Zmiana.
 * @returns Obietnica spełniona po odpowiedzi serwera.
 */
async function send(token: string, op: OutboxOp): Promise<void> {
  switch (op.kind) {
    case 'add':
      await shoppingApi.createShoppingItem(token, op.listId, op.body);
      return;
    case 'update':
      await shoppingApi.updateShoppingItem(token, op.itemId, op.body);
      return;
    case 'delete':
      await shoppingApi.deleteShoppingItem(token, op.itemId);
      return;
    case 'clear':
      await shoppingApi.clearCheckedItems(token, op.listId);
      return;
    case 'restore':
      await shoppingApi.restoreClearedItems(token, op.listId, op.itemIds);
      return;
    case 'reorder':
      await shoppingApi.reorderShoppingItems(token, op.listId, op.body);
      return;
  }
}

let flushing: Promise<FlushResult> | null = null;

/**
 * Wysyła kolejkę po kolei. Brak sieci, `401`, `429` i `5xx` zatrzymują wysyłanie (reszta
 * czeka na następną okazję); ostateczna odmowa (`400`, `404`, `409`, `422`) usuwa zmianę
 * z kolejki — powtarzanie jej nic nie da, a lista po odświeżeniu pokaże stan z serwera.
 * Jednocześnie biegnie najwyżej jedno wysyłanie.
 *
 * @param token - Token dostępu.
 * @returns Ile wysłano i czy przerwał brak sieci.
 */
export function flushOutbox(token: string): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async (): Promise<FlushResult> => {
    let sent = 0;
    const rejectedOpIds: string[] = [];
    const result = (stoppedOffline: boolean): FlushResult => ({
      sent,
      rejected: rejectedOpIds.length,
      rejectedOpIds,
      stoppedOffline,
    });
    for (;;) {
      const [op] = readOutbox();
      if (op === undefined) return result(false);
      inFlightOpId = op.opId;
      try {
        await send(token, op);
      } catch (error) {
        if (!(error instanceof ApiRequestError) || !FINAL_REJECTION.has(error.status)) {
          // Brak sieci, wygasły token, limit, awaria serwera — zmiana czeka dalej.
          return result(true);
        }
        rejectedOpIds.push(op.opId);
      }
      sent += 1;
      writeOutbox(readOutbox().filter((queued) => queued.opId !== op.opId));
    }
  })().finally(() => {
    flushing = null;
    inFlightOpId = null;
  });
  return flushing;
}
