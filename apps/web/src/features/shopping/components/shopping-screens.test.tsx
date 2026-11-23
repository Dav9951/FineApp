import type { ShoppingItemDto, ShoppingItemsDto, ShoppingListDto } from '@fineapp/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '../../../../test/render-screen.js';
import { AppShell } from '../../../components/layout/app-shell.js';
import { ApiRequestError, NetworkError } from '../../../lib/api-client.js';
import { clearOfflineStore } from '../../../lib/offline-store.js';
import * as shoppingApi from '../api.js';
import { readOutbox, writeSnapshot } from '../offline.js';
import ShoppingListScreen from './shopping-list-screen.js';
import ShoppingListsScreen from './shopping-lists-screen.js';
import ShoppingStaplesScreen from './shopping-staples-screen.js';

/**
 * Testy ekranów list zakupów
 * ([06 §3.15](../../../../../../plans/06-ui-views.md#315-listy-zakupów--shopping-shoppinglistid-shoppinglistidimportimportid),
 * `F10-5`…`F10-7`).
 */

const LIST_ID = '01JC7K0000000000000000L001';
const OTHER_ID = '01JC7K0000000000000000L002';

const ROUTES = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'shopping', element: <ShoppingListsScreen /> },
      { path: 'shopping/staples', element: <ShoppingStaplesScreen /> },
      { path: 'shopping/:listId', element: <ShoppingListScreen /> },
      { path: 'scan', element: <p>ekran skanu</p> },
    ],
  },
];

/**
 * Lista testowa.
 *
 * @param over - Nadpisane pola.
 * @returns Lista.
 */
function list(over: Partial<ShoppingListDto> = {}): ShoppingListDto {
  return {
    id: LIST_ID,
    name: 'Spożywcze',
    isDefault: true,
    archived: false,
    sortOrder: 0,
    toBuyCount: 2,
    checkedCount: 1,
    lastActivityAt: null,
    lastActivityBy: null,
    pendingImports: [],
    ...over,
  };
}

/**
 * Pozycja testowa.
 *
 * @param over - Nadpisane pola.
 * @returns Pozycja.
 */
function item(over: Partial<ShoppingItemDto> & { id: string; name: string }): ShoppingItemDto {
  return {
    listId: LIST_ID,
    productId: null,
    quantityMilli: null,
    unit: null,
    note: null,
    section: 'other',
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

const ITEMS: ShoppingItemDto[] = [
  item({ id: '01JC7K000000000000000000I1', name: 'Chleb', section: 'bakery' }),
  item({
    id: '01JC7K000000000000000000I2',
    name: 'Mleko',
    section: 'dairy',
    quantityMilli: 2000,
    unit: 'pcs',
    note: 'bez laktozy',
  }),
  item({
    id: '01JC7K000000000000000000I3',
    name: 'Masło',
    section: 'dairy',
    checked: true,
    checkedAt: 5,
    checkedByInitials: 'AK',
  }),
];

/**
 * Atrapy API listy: pozycje, podpowiedzi, „często kupowane".
 *
 * @param items - Pozycje listy.
 * @param over - Nadpisanie listy.
 * @returns Atrapa odczytu pozycji.
 */
function mockList(items: ShoppingItemDto[] = ITEMS, over: Partial<ShoppingListDto> = {}) {
  vi.spyOn(shoppingApi, 'fetchSuggestions').mockResolvedValue([]);
  vi.spyOn(shoppingApi, 'fetchFrequent').mockResolvedValue([]);
  vi.spyOn(shoppingApi, 'fetchShoppingLists').mockResolvedValue([list(over)]);
  const data: ShoppingItemsDto = { list: list(over), items };
  return vi.spyOn(shoppingApi, 'fetchShoppingItems').mockResolvedValue(data);
}

beforeEach(() => {
  clearOfflineStore();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearOfflineStore();
});

describe('ShoppingListsScreen', () => {
  it('jedna lista → od razu ekran tej listy', async () => {
    mockList();
    const { router } = renderScreen('/shopping', ROUTES);
    expect(
      await screen.findByRole('heading', { name: 'Spożywcze' }, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/shopping/${LIST_ID}`);
  });

  it('kilka list: karty z licznikiem i ostatnią aktywnością; nowa lista', async () => {
    const user = userEvent.setup();
    vi.spyOn(shoppingApi, 'fetchShoppingLists').mockResolvedValue([
      list({ lastActivityAt: Date.now() - 12 * 60_000, lastActivityBy: 'Ania' }),
      list({ id: OTHER_ID, name: 'Decathlon', isDefault: false, toBuyCount: 0 }),
    ]);
    const create = vi
      .spyOn(shoppingApi, 'createShoppingList')
      .mockResolvedValue(list({ id: OTHER_ID, name: 'Ikea', isDefault: false }));
    vi.spyOn(shoppingApi, 'fetchShoppingItems').mockResolvedValue({
      list: list({ id: OTHER_ID, name: 'Ikea' }),
      items: [],
    });
    vi.spyOn(shoppingApi, 'fetchSuggestions').mockResolvedValue([]);
    vi.spyOn(shoppingApi, 'fetchFrequent').mockResolvedValue([]);
    const { router } = renderScreen('/shopping?all=1', ROUTES);

    const card = await screen.findByRole('link', { name: /Spożywcze/u }, { timeout: 3_000 });
    expect(card).toHaveTextContent('2 do kupienia · Ania · 12 min temu');
    expect(screen.getByRole('link', { name: /Decathlon/u })).toHaveTextContent('nic do kupienia');

    await user.click(screen.getByRole('button', { name: '+ Nowa lista' }));
    await user.type(screen.getByLabelText('Nazwa listy'), 'Ikea');
    await user.click(screen.getByRole('button', { name: 'Utwórz listę' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/shopping/${OTHER_ID}`);
    });
    expect(create).toHaveBeenCalledWith('token-testowy', { name: 'Ikea' });
  });

  it('błąd wczytywania ma stan błędu', async () => {
    vi.spyOn(shoppingApi, 'fetchShoppingLists').mockRejectedValue(new NetworkError());
    renderScreen('/shopping', ROUTES);
    expect(
      await screen.findByText('Nie udało się wczytać list', {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
  });
});

describe('ShoppingListScreen', () => {
  it('działy w kolejności sklepu, ilość i notatka; kupione zwinięte', async () => {
    const user = userEvent.setup();
    mockList();
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    const bakery = await screen.findByRole('heading', { name: 'Pieczywo' }, { timeout: 3_000 });
    const dairy = screen.getByRole('heading', { name: 'Nabiał i jaja' });
    expect(bakery.compareDocumentPosition(dairy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const milk = screen.getByRole('checkbox', { name: /Mleko/u });
    expect(milk).toHaveTextContent('bez laktozy');
    expect(milk).toHaveTextContent('2 szt.');
    expect(screen.queryByRole('checkbox', { name: /Masło/u })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kupione (1)' }));
    expect(screen.getByRole('checkbox', { name: /Masło/u })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('dotknięcie wiersza odhacza — od razu na ekranie, z „Cofnij"', async () => {
    const user = userEvent.setup();
    mockList();
    const update = vi
      .spyOn(shoppingApi, 'updateShoppingItem')
      .mockResolvedValue(item({ id: '01JC7K000000000000000000I1', name: 'Chleb', checked: true }));
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    await user.click(await screen.findByRole('checkbox', { name: /Chleb/u }, { timeout: 3_000 }));
    expect(update).toHaveBeenCalledWith('token-testowy', '01JC7K000000000000000000I1', {
      checked: true,
    });
    expect(await screen.findByText('Odhaczono Chleb')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cofnij' }));
    await waitFor(() => {
      expect(update).toHaveBeenLastCalledWith('token-testowy', '01JC7K000000000000000000I1', {
        checked: false,
      });
    });
  });

  it('szybkie dopisanie rozpoznaje ilość i wysyła identyfikator od klienta', async () => {
    const user = userEvent.setup();
    mockList();
    const create = vi.spyOn(shoppingApi, 'createShoppingItem').mockResolvedValue({
      item: item({ id: '01JC7K000000000000000000I9', name: 'Mąka' }),
      merged: false,
    });
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    const input = await screen.findByLabelText('Dodaj produkt', {}, { timeout: 3_000 });
    await user.type(input, 'mąka 1kg');
    expect(screen.getByText('→ Mąka · 1 kg')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    const [, listArg, body] = create.mock.calls[0] ?? [];
    expect(listArg).toBe(LIST_ID);
    expect(body).toMatchObject({ name: 'Mąka', quantityMilli: 1000, unit: 'kg' });
    expect(body?.id).toMatch(/^[0-9A-Z]{26}$/u);
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('bez sieci: dopisanie zostaje na liście i czeka w kolejce', async () => {
    const user = userEvent.setup();
    mockList();
    vi.spyOn(shoppingApi, 'createShoppingItem').mockRejectedValue(new NetworkError());
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    await user.type(
      await screen.findByLabelText('Dodaj produkt', {}, { timeout: 3_000 }),
      'cebula{Enter}',
    );
    expect(await screen.findByRole('checkbox', { name: /Cebula/u })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Warzywa i owoce' })).toBeInTheDocument();
    const outbox = readOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ kind: 'add', listId: LIST_ID, body: { name: 'Cebula' } });
  });

  it('bez sieci: odhaczenie od razu przenosi pozycję do kupionych', async () => {
    const user = userEvent.setup();
    mockList();
    vi.spyOn(shoppingApi, 'updateShoppingItem').mockRejectedValue(new NetworkError());
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    await user.click(await screen.findByRole('checkbox', { name: /Chleb/u }, { timeout: 3_000 }));
    expect(await screen.findByRole('button', { name: 'Kupione (2)' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pieczywo' })).not.toBeInTheDocument();
    expect(readOutbox()).toHaveLength(1);
  });

  it('„Wyczyść kupione" z „Cofnij" i podpowiedzią po zakupach', async () => {
    const user = userEvent.setup();
    mockList();
    const clear = vi
      .spyOn(shoppingApi, 'clearCheckedItems')
      .mockResolvedValue({ clearedIds: ['01JC7K000000000000000000I3'], listEmpty: false });
    const restore = vi
      .spyOn(shoppingApi, 'restoreClearedItems')
      .mockResolvedValue({ restoredIds: [] });
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    await user.click(
      await screen.findByRole('button', { name: 'Wyczyść kupione' }, { timeout: 3_000 }),
    );
    expect(clear).toHaveBeenCalledWith('token-testowy', LIST_ID);
    expect(await screen.findByText('Wyczyszczono 1 pozycję')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cofnij' }));
    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith('token-testowy', LIST_ID, [
        '01JC7K000000000000000000I3',
      ]);
    });
    await user.click(screen.getByRole('button', { name: 'Nie teraz' }));
  });

  it('arkusz pozycji: zmiana ilości i usunięcie z „Cofnij"', async () => {
    const user = userEvent.setup();
    mockList();
    const update = vi
      .spyOn(shoppingApi, 'updateShoppingItem')
      .mockResolvedValue(item({ id: '01JC7K000000000000000000I2', name: 'Mleko' }));
    const remove = vi.spyOn(shoppingApi, 'deleteShoppingItem').mockResolvedValue(undefined);
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    await user.click(
      await screen.findByRole('button', { name: 'Szczegóły: Mleko' }, { timeout: 3_000 }),
    );
    const sheet = await screen.findByRole('dialog');
    const quantity = within(sheet).getByLabelText('Ilość');
    expect(quantity).toHaveValue('2');
    await user.clear(quantity);
    await user.type(quantity, '1,5');
    await user.click(within(sheet).getByRole('button', { name: 'l' }));
    await user.click(within(sheet).getByRole('button', { name: 'Zapisz' }));
    expect(update).toHaveBeenCalledWith('token-testowy', '01JC7K000000000000000000I2', {
      quantityMilli: 1500,
      unit: 'l',
    });

    await user.click(screen.getByRole('button', { name: 'Szczegóły: Chleb' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Usuń z listy' }),
    );
    expect(remove).toHaveBeenCalledWith('token-testowy', '01JC7K000000000000000000I1');
    expect(await screen.findByText('Usunięto „Chleb”.')).toBeInTheDocument();
  });

  it('błędna ilość w arkuszu zostaje w formularzu', async () => {
    const user = userEvent.setup();
    mockList();
    const update = vi.spyOn(shoppingApi, 'updateShoppingItem');
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    await user.click(
      await screen.findByRole('button', { name: 'Szczegóły: Chleb' }, { timeout: 3_000 }),
    );
    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByLabelText('Ilość'), '0');
    await user.click(within(sheet).getByRole('button', { name: 'Zapisz' }));
    expect(within(sheet).getByText('Ilość od 0,001 do 1000')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('pusta lista ma stan pusty; usunięta lista — „Tej listy już nie ma"', async () => {
    mockList([]);
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    expect(await screen.findByText('Lista jest pusta', {}, { timeout: 3_000 })).toBeInTheDocument();
  });

  it('404 — lista usunięta na drugim telefonie', async () => {
    vi.spyOn(shoppingApi, 'fetchShoppingItems').mockRejectedValue(
      new ApiRequestError('NOT_FOUND', 'Nie znaleziono listy zakupów.', 404, 'r'),
    );
    vi.spyOn(shoppingApi, 'fetchSuggestions').mockResolvedValue([]);
    vi.spyOn(shoppingApi, 'fetchFrequent').mockResolvedValue([]);
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    expect(
      await screen.findByText('Tej listy już nie ma', {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
  });

  it('404 wygrywa z migawką na urządzeniu i zapomina listę', async () => {
    writeSnapshot({ list: list(), items: ITEMS });
    vi.spyOn(shoppingApi, 'fetchShoppingItems').mockRejectedValue(
      new ApiRequestError('NOT_FOUND', 'Nie znaleziono listy zakupów.', 404, 'r'),
    );
    vi.spyOn(shoppingApi, 'fetchSuggestions').mockResolvedValue([]);
    vi.spyOn(shoppingApi, 'fetchFrequent').mockResolvedValue([]);
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    expect(
      await screen.findByText('Tej listy już nie ma', {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Chleb/u })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(`fineapp.offline.shopping.items.${LIST_ID}`)).toBeNull();
  });

  it('przejście na inną listę zaczyna ekran od nowa', async () => {
    const user = userEvent.setup();
    mockList();
    vi.spyOn(shoppingApi, 'clearCheckedItems').mockResolvedValue({
      clearedIds: [],
      listEmpty: false,
    });
    const { router } = renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    await user.click(
      await screen.findByRole('button', { name: 'Wyczyść kupione' }, { timeout: 3_000 }),
    );
    expect(await screen.findByRole('heading', { name: 'Po zakupach' })).toBeInTheDocument();
    await router.navigate(`/shopping/${OTHER_ID}`);
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Po zakupach' })).not.toBeInTheDocument();
    });
  });

  it('przełącznik „Zawsze w domu" w arkuszu przestawia się od razu', async () => {
    const user = userEvent.setup();
    mockList();
    const upsert = vi.spyOn(shoppingApi, 'upsertProduct').mockResolvedValue({
      id: '01JC7K000000000000000000P1',
      name: 'Chleb',
      section: 'bakery',
      isStaple: true,
      useCount: 1,
      lastUsedAt: null,
    });
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    await user.click(
      await screen.findByRole('button', { name: 'Szczegóły: Chleb' }, { timeout: 3_000 }),
    );
    const toggle = within(await screen.findByRole('dialog')).getByRole('switch', {
      name: 'Zawsze w domu',
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(upsert).toHaveBeenCalledWith('token-testowy', {
      name: 'Chleb',
      section: 'bakery',
      isStaple: true,
    });
  });

  it('lista w archiwum jest tylko do odczytu', async () => {
    mockList(ITEMS, { archived: true, isDefault: false });
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    expect(
      await screen.findByText(/Lista jest w archiwum/u, {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Dodaj produkt')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Chleb/u })).toBeDisabled();
  });

  it('menu: zmiana nazwy, ustawienie domyślnej, usunięcie z potwierdzeniem', async () => {
    const user = userEvent.setup();
    mockList(ITEMS, { isDefault: false });
    const update = vi
      .spyOn(shoppingApi, 'updateShoppingList')
      .mockResolvedValue(list({ name: 'Dom' }));
    const remove = vi.spyOn(shoppingApi, 'deleteShoppingList').mockResolvedValue(undefined);
    const { router } = renderScreen(`/shopping/${LIST_ID}`, ROUTES);

    await user.click(await screen.findByRole('button', { name: 'Menu listy' }, { timeout: 3_000 }));
    await user.click(screen.getByRole('button', { name: 'Ustaw jako domyślną' }));
    expect(update).toHaveBeenCalledWith('token-testowy', LIST_ID, { isDefault: true });

    await user.click(screen.getByRole('button', { name: 'Menu listy' }));
    await user.click(screen.getByRole('button', { name: 'Zmień nazwę' }));
    const name = await screen.findByRole('textbox', { name: 'Nazwa listy' });
    await user.clear(name);
    await user.type(name, 'Dom');
    await user.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(update).toHaveBeenLastCalledWith('token-testowy', LIST_ID, { name: 'Dom' });
    });

    await user.click(screen.getByRole('button', { name: 'Menu listy' }));
    await user.click(screen.getByRole('button', { name: 'Usuń listę' }));
    const confirm = await screen.findByRole('dialog', { name: /Usunąć/u });
    await user.click(within(confirm).getByRole('button', { name: 'Usuń listę' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?all=1');
    });
    expect(remove).toHaveBeenCalledWith('token-testowy', LIST_ID);
  });

  it('udostępnienie jako tekst bez Web Share kopiuje do schowka', async () => {
    const user = userEvent.setup();
    mockList();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    await user.click(await screen.findByRole('button', { name: 'Menu listy' }, { timeout: 3_000 }));
    await user.click(screen.getByRole('button', { name: 'Udostępnij jako tekst' }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('• Mleko — 2 szt. (bez laktozy)'),
    );
    expect(await screen.findByText('Skopiowano listę do schowka.')).toBeInTheDocument();
  });
});

describe('ShoppingQuickAddSheet (FAB → „Do listy zakupów")', () => {
  it('dopisuje do listy domyślnej z dowolnego ekranu', async () => {
    const user = userEvent.setup();
    vi.spyOn(shoppingApi, 'fetchShoppingLists').mockResolvedValue([
      list({ id: OTHER_ID, name: 'Decathlon', isDefault: false }),
      list(),
    ]);
    vi.spyOn(shoppingApi, 'fetchSuggestions').mockResolvedValue([]);
    vi.spyOn(shoppingApi, 'fetchFrequent').mockResolvedValue([]);
    const create = vi.spyOn(shoppingApi, 'createShoppingItem').mockResolvedValue({
      item: item({ id: '01JC7K000000000000000000I9', name: 'Chleb' }),
      merged: false,
    });
    renderScreen('/scan', ROUTES);
    const fab = await screen.findByRole('button', { name: 'Dodaj transakcję' }, { timeout: 3_000 });
    // Prawy przycisk otwiera to samo menu co przytrzymanie (06 §2, desktop).
    fireEvent.contextMenu(fab);
    await user.click(await screen.findByRole('button', { name: 'Do listy zakupów' }));
    expect(await screen.findByText(/Dopisujesz do listy „Spożywcze”/u)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Dodaj produkt'), 'chleb{Enter}');
    expect(create).toHaveBeenCalledWith(
      'token-testowy',
      LIST_ID,
      expect.objectContaining({ name: 'Chleb' }),
    );
    expect(await screen.findByText('Dopisano „Chleb” do „Spożywcze”.')).toBeInTheDocument();
  });
});

describe('stany błędu arkuszy', () => {
  it('szybkie dopisanie bez list z serwera pokazuje błąd, a nie „Załóż listę"', async () => {
    vi.spyOn(shoppingApi, 'fetchShoppingLists').mockRejectedValue(new NetworkError());
    renderScreen('/scan', ROUTES);
    fireEvent.contextMenu(
      await screen.findByRole('button', { name: 'Dodaj transakcję' }, { timeout: 3_000 }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Do listy zakupów' }));
    expect(await screen.findByText('Nie udało się wczytać list')).toBeInTheDocument();
    expect(screen.queryByText(/Nie masz żadnej listy/u)).not.toBeInTheDocument();
  });

  it('archiwum pyta serwer dopiero po otwarciu i ma stan błędu', async () => {
    const user = userEvent.setup();
    const fetch = vi
      .spyOn(shoppingApi, 'fetchShoppingLists')
      .mockImplementation((_token, archived) =>
        archived === true
          ? Promise.reject(new NetworkError())
          : Promise.resolve([list(), list({ id: OTHER_ID, name: 'Dom', isDefault: false })]),
      );
    renderScreen('/shopping?all=1', ROUTES);
    await screen.findByRole('link', { name: /Dom/u }, { timeout: 3_000 });
    expect(fetch.mock.calls.some(([, archived]) => archived === true)).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Więcej opcji' }));
    await user.click(screen.getByRole('button', { name: 'Archiwum' }));
    expect(await screen.findByText('Nie udało się wczytać archiwum')).toBeInTheDocument();
  });
});

describe('ShoppingStaplesScreen', () => {
  it('lista produktów, dopisanie i zdjęcie flagi', async () => {
    const user = userEvent.setup();
    vi.spyOn(shoppingApi, 'fetchStaples').mockResolvedValue([
      {
        id: '01JC7K000000000000000000P1',
        name: 'Mleko',
        section: 'dairy',
        isStaple: true,
        useCount: 3,
        lastUsedAt: null,
      },
    ]);
    const upsert = vi.spyOn(shoppingApi, 'upsertProduct').mockResolvedValue({
      id: '01JC7K000000000000000000P2',
      name: 'Kakao',
      section: 'dry_goods',
      isStaple: true,
      useCount: 0,
      lastUsedAt: null,
    });
    const update = vi.spyOn(shoppingApi, 'updateProduct').mockResolvedValue({
      id: '01JC7K000000000000000000P1',
      name: 'Mleko',
      section: 'dairy',
      isStaple: false,
      useCount: 3,
      lastUsedAt: null,
    });
    renderScreen('/shopping/staples', ROUTES);
    expect(await screen.findByText('Mleko', {}, { timeout: 3_000 })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Dodaj produkt'), 'kakao');
    await user.click(screen.getByRole('button', { name: 'Dodaj' }));
    expect(upsert).toHaveBeenCalledWith('token-testowy', { name: 'kakao', isStaple: true });
    await user.click(screen.getByRole('button', { name: 'Usuń „Mleko” z zawsze w domu' }));
    expect(update).toHaveBeenCalledWith('token-testowy', '01JC7K000000000000000000P1', {
      isStaple: false,
    });
  });
});
