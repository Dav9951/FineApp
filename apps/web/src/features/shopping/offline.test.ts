import type { ShoppingItemDto, ShoppingItemsDto } from '@fineapp/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError, NetworkError } from '../../lib/api-client.js';
import { clearOfflineStore } from '../../lib/offline-store.js';
import * as shoppingApi from './api.js';
import {
  applyOps,
  enqueue,
  flushOutbox,
  forgetList,
  undoClear,
  pendingOps,
  readOutbox,
  readSnapshot,
  writeSnapshot,
  type OutboxChange,
} from './offline.js';

/** Testy pracy offline list zakupów (ADR-096, 07 §14.3, §14.7). */

const LIST = 'L0000000000000000000000000';
const ID = (n: number): string => `01JC7K00000000000000000${String(n).padStart(3, '0')}`;

/**
 * Pozycja testowa.
 *
 * @param over - Nadpisane pola.
 * @returns Pozycja.
 */
function item(over: Partial<ShoppingItemDto> & { id: string; name: string }): ShoppingItemDto {
  return {
    listId: LIST,
    productId: null,
    quantityMilli: null,
    unit: null,
    note: null,
    section: 'other',
    sortOrder: 0,
    source: 'manual',
    checked: false,
    checkedAt: null,
    checkedByInitials: null,
    isStaple: false,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

/**
 * Lista z pozycjami.
 *
 * @param items - Pozycje.
 * @returns Dane listy.
 */
function data(items: ShoppingItemDto[]): ShoppingItemsDto {
  return {
    list: {
      id: LIST,
      name: 'Spożywcze',
      isDefault: true,
      archived: false,
      sortOrder: 0,
      toBuyCount: items.filter((i) => !i.checked).length,
      checkedCount: items.filter((i) => i.checked).length,
      lastActivityAt: null,
      lastActivityBy: null,
      pendingImports: [],
    },
    items,
  };
}

beforeEach(() => {
  clearOfflineStore();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearOfflineStore();
});

describe('applyOps — zmiany nałożone na listę', () => {
  const base = data([
    item({ id: ID(1), name: 'Mleko', quantityMilli: 2000, unit: 'pcs', section: 'dairy' }),
    item({ id: ID(2), name: 'Chleb', section: 'bakery', checked: true, checkedAt: 5 }),
  ]);

  it('bez zmian oddaje te same dane', () => {
    expect(applyOps(base, [], 'AK')).toBe(base);
  });

  it('dopisanie: nowa pozycja z działem ze słów kluczowych; to samo id drugi raz nic nie zmienia', () => {
    const op: OutboxChange = { kind: 'add', listId: LIST, body: { id: ID(3), name: 'cebula' } };
    const result = applyOps(base, [op, op], 'AK', 10);
    expect(result.items.map((i) => [i.name, i.section])).toEqual([
      ['Cebula', 'produce'],
      ['Mleko', 'dairy'],
      ['Chleb', 'bakery'],
    ]);
    expect(result.list).toMatchObject({ toBuyCount: 2, checkedCount: 1 });
  });

  it('dopisanie istniejącej scala jak serwer', () => {
    const op: OutboxChange = {
      kind: 'add',
      listId: LIST,
      body: { id: ID(3), name: 'MLEKO', quantityMilli: 1000, unit: 'pcs', note: 'bez laktozy' },
    };
    const [milk] = applyOps(base, [op], 'AK', 10).items;
    expect(milk).toMatchObject({ id: ID(1), quantityMilli: 3000, note: 'bez laktozy' });
  });

  it('odhaczenie, odznaczenie, zmiana pól, usunięcie, przeniesienie, czyszczenie', () => {
    const ops: OutboxChange[] = [
      { kind: 'update', listId: LIST, itemId: ID(1), body: { checked: true } },
      { kind: 'update', listId: LIST, itemId: ID(2), body: { checked: false } },
      {
        kind: 'update',
        listId: LIST,
        itemId: ID(2),
        body: {
          name: 'chleb razowy',
          quantityMilli: 1000,
          unit: 'pcs',
          note: 'krojony',
          section: 'other',
        },
      },
    ];
    const after = applyOps(base, ops, 'AK', 20);
    expect(
      after.items.map((i) => [i.name, i.checked, i.checkedByInitials, i.note, i.section]),
    ).toEqual([
      ['Chleb razowy', false, null, 'krojony', 'other'],
      ['Mleko', true, 'AK', null, 'dairy'],
    ]);

    const cleared = applyOps(
      after,
      [{ kind: 'update', listId: LIST, itemId: ID(2), body: { quantityMilli: null } }],
      'AK',
    );
    expect(cleared.items[0]).toMatchObject({ quantityMilli: null, unit: null });

    expect(
      applyOps(after, [{ kind: 'clear', listId: LIST }], 'AK').items.map((i) => i.name),
    ).toEqual(['Chleb razowy']);
    expect(
      applyOps(after, [{ kind: 'delete', listId: LIST, itemId: ID(1) }], 'AK').items,
    ).toHaveLength(1);
    expect(
      applyOps(
        after,
        [{ kind: 'update', listId: LIST, itemId: ID(1), body: { listId: 'INNA' } }],
        'AK',
      ).items.map((i) => i.id),
    ).toEqual([ID(2)]);
  });
});

describe('kolejność offline (ADR-104)', () => {
  it('reorder przestawia do kupienia jak serwer, move zmienia dział, kupione bez zmian', () => {
    const before = data([
      item({ id: ID(1), name: 'Mleko', sortOrder: 0, section: 'dairy' }),
      item({ id: ID(2), name: 'Chleb', sortOrder: 1, section: 'bakery' }),
      item({ id: ID(3), name: 'Jajka', sortOrder: 2, section: 'dairy' }),
      item({ id: ID(4), name: 'Masło', sortOrder: 3, checked: true, checkedAt: 5 }),
    ]);
    const after = applyOps(
      before,
      [
        {
          kind: 'reorder',
          listId: LIST,
          body: { itemIds: [ID(3), ID(9), ID(1)], move: { itemId: ID(3), section: 'bakery' } },
        },
      ],
      'AK',
    );
    const byId = new Map(after.items.map((i) => [i.id, i]));
    expect([ID(3), ID(1), ID(2)].map((id) => byId.get(id)?.sortOrder)).toEqual([0, 1, 2]);
    expect(byId.get(ID(3))?.section).toBe('bakery');
    expect(byId.get(ID(4))?.sortOrder).toBe(3);
  });

  it('dopisanie lokalne ląduje na końcu listy', () => {
    const after = applyOps(
      data([item({ id: ID(1), name: 'Mleko', sortOrder: 7 })]),
      [{ kind: 'add', listId: LIST, body: { id: ID(2), name: 'chleb' } }],
      'AK',
    );
    expect(after.items.find((i) => i.id === ID(2))?.sortOrder).toBe(8);
  });

  it('odznaczona wraca na koniec do kupienia, jak na serwerze', () => {
    const after = applyOps(
      data([
        item({ id: ID(1), name: 'Mleko', sortOrder: 0 }),
        item({ id: ID(2), name: 'Chleb', sortOrder: 1, checked: true, checkedAt: 5 }),
        item({ id: ID(3), name: 'Jajka', sortOrder: 4 }),
      ]),
      [{ kind: 'update', listId: LIST, itemId: ID(2), body: { checked: false } }],
      'AK',
    );
    expect(after.items.map((i) => i.name)).toEqual(['Mleko', 'Jajka', 'Chleb']);
  });

  it('migawka sprzed ADR-104 (bez sortOrder) dostaje 0 zamiast NaN', () => {
    const old = data([item({ id: ID(1), name: 'Mleko' })]);
    const { sortOrder: _dropped, ...legacy } = old.items[0] as ShoppingItemDto;
    window.localStorage.setItem(
      `fineapp.offline.shopping.items.${LIST}`,
      JSON.stringify({ ...old, items: [legacy] }),
    );
    expect(readSnapshot(LIST)?.items[0]?.sortOrder).toBe(0);
  });
});

describe('kolejka i migawka', () => {
  it('migawka listy wraca z magazynu; śmieci w magazynie są ignorowane', () => {
    expect(readSnapshot(LIST)).toBeUndefined();
    writeSnapshot(data([item({ id: ID(1), name: 'Mleko' })]));
    expect(readSnapshot(LIST)?.items[0]?.name).toBe('Mleko');
    window.localStorage.setItem('fineapp.offline.shopping.outbox', '{"zle": true}');
    expect(readOutbox()).toEqual([]);
    window.localStorage.setItem(`fineapp.offline.shopping.items.${LIST}`, '[1]');
    expect(readSnapshot(LIST)).toBeUndefined();
  });

  it('wysyła po kolei; brak sieci zatrzymuje, odmowa serwera usuwa zmianę', async () => {
    enqueue({ kind: 'add', listId: LIST, body: { id: ID(1), name: 'Mleko' } });
    enqueue({ kind: 'update', listId: LIST, itemId: ID(9), body: { checked: true } });
    enqueue({ kind: 'delete', listId: 'INNA', itemId: ID(2) });
    enqueue({ kind: 'clear', listId: LIST });
    expect(pendingOps(LIST)).toHaveLength(3);

    const add = vi
      .spyOn(shoppingApi, 'createShoppingItem')
      .mockRejectedValueOnce(new NetworkError());
    const first = await flushOutbox('t');
    expect(first).toMatchObject({ sent: 0, rejected: 0, stoppedOffline: true });
    expect(readOutbox()).toHaveLength(4);

    add.mockResolvedValue({ item: item({ id: ID(1), name: 'Mleko' }), merged: false });
    vi.spyOn(shoppingApi, 'updateShoppingItem').mockRejectedValue(
      new ApiRequestError('NOT_FOUND', 'Nie znaleziono pozycji listy.', 404, 'r'),
    );
    const remove = vi.spyOn(shoppingApi, 'deleteShoppingItem').mockResolvedValue(undefined);
    const clear = vi
      .spyOn(shoppingApi, 'clearCheckedItems')
      .mockResolvedValue({ clearedIds: [], listEmpty: false });
    const second = await flushOutbox('t');
    expect(second).toMatchObject({ sent: 4, rejected: 1, stoppedOffline: false });
    expect(second.rejectedOpIds).toHaveLength(1);
    expect(readOutbox()).toEqual([]);
    expect(remove).toHaveBeenCalledWith('t', ID(2));
    expect(clear).toHaveBeenCalledWith('t', LIST);
  });

  it('błąd 5xx zostawia zmianę w kolejce; równoległe wysyłanie to jedno wysyłanie', async () => {
    enqueue({ kind: 'delete', listId: LIST, itemId: ID(1) });
    const remove = vi
      .spyOn(shoppingApi, 'deleteShoppingItem')
      .mockRejectedValueOnce(new ApiRequestError('INTERNAL_ERROR', 'x', 500, 'r'))
      .mockResolvedValue(undefined);
    expect(await flushOutbox('t')).toMatchObject({ stoppedOffline: true });
    expect(readOutbox()).toHaveLength(1);
    const [a, b] = await Promise.all([flushOutbox('t'), flushOutbox('t')]);
    expect(a).toBe(b);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(readOutbox()).toEqual([]);
  });

  it('nieznany wyjątek traktujemy jak brak sieci', async () => {
    enqueue({ kind: 'delete', listId: LIST, itemId: ID(1) });
    vi.spyOn(shoppingApi, 'deleteShoppingItem').mockRejectedValue(new TypeError('x'));
    expect(await flushOutbox('t')).toMatchObject({ stoppedOffline: true });
  });

  it.each([401, 403, 429])(
    'odpowiedź %i zostawia zmianę w kolejce (np. wygasły token)',
    async (status) => {
      enqueue({ kind: 'update', listId: LIST, itemId: ID(1), body: { checked: true } });
      vi.spyOn(shoppingApi, 'updateShoppingItem').mockRejectedValue(
        new ApiRequestError('UNAUTHORIZED', 'x', status, 'r'),
      );
      expect(await flushOutbox('t')).toMatchObject({ stoppedOffline: true, rejected: 0 });
      expect(readOutbox()).toHaveLength(1);
    },
  );

  it('„Cofnij" przed wysłaniem czyszczenia po prostu je wycofuje', () => {
    enqueue({ kind: 'update', listId: LIST, itemId: ID(1), body: { checked: true } });
    enqueue({ kind: 'clear', listId: LIST });
    expect(undoClear(LIST, [ID(1)])).toBe('cancelled');
    expect(readOutbox().map((op) => op.kind)).toEqual(['update']);
  });

  it('„Cofnij" po wysłaniu czyszczenia staje za nim w kolejce', async () => {
    enqueue({ kind: 'clear', listId: LIST });
    let release: () => void = () => undefined;
    vi.spyOn(shoppingApi, 'clearCheckedItems').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ clearedIds: [ID(1)], listEmpty: false });
          };
        }),
    );
    const restore = vi
      .spyOn(shoppingApi, 'restoreClearedItems')
      .mockResolvedValue({ restoredIds: [ID(1)] });
    const flushing = flushOutbox('t');
    await Promise.resolve();
    // Czyszczenie jest w drodze — nie wolno go wyjąć; przywrócenie idzie za nim.
    expect(undoClear(LIST, [ID(1)])).toBe('queued');
    release();
    // To samo wysyłanie zabiera też przywrócenie — po czyszczeniu, nigdy przed nim.
    await flushing;
    expect(restore).toHaveBeenCalledWith('t', LIST, [ID(1)]);
    expect(readOutbox()).toEqual([]);
  });

  it('zapomnienie listy usuwa jej migawkę i zmiany, cudze zostają', () => {
    writeSnapshot(data([item({ id: ID(1), name: 'Mleko' })]));
    enqueue({ kind: 'delete', listId: LIST, itemId: ID(1) });
    enqueue({ kind: 'delete', listId: 'INNA', itemId: ID(2) });
    forgetList(LIST);
    expect(readSnapshot(LIST)).toBeUndefined();
    expect(readOutbox().map((op) => op.listId)).toEqual(['INNA']);
  });
});
