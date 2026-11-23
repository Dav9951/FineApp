import type { ShoppingImportDto, ShoppingImportItemDto, ShoppingListDto } from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '../../../../test/render-screen.js';
import { AppShell } from '../../../components/layout/app-shell.js';
import { clearOfflineStore } from '../../../lib/offline-store.js';
import * as scanApi from '../../scan/api.js';
import * as resize from '../../scan/resize-image.js';
import * as shoppingApi from '../api.js';
import ShoppingImportScreen from './shopping-import-screen.js';
import ShoppingListScreen from './shopping-list-screen.js';
import ShoppingShareRoute from './shopping-share-route.js';

/**
 * Testy importów list zakupów na froncie (06 §3.15, `F10-8`, `F10-9`).
 */

const LIST_ID = '01JC7K0000000000000000L001';
const IMPORT_ID = '01JC7K0000000000000000M001';

const ROUTES = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'shopping/share', element: <ShoppingShareRoute /> },
      { path: 'shopping/:listId/import/:importId', element: <ShoppingImportScreen /> },
      { path: 'shopping/:listId', element: <ShoppingListScreen /> },
    ],
  },
];

const LIST: ShoppingListDto = {
  id: LIST_ID,
  name: 'Spożywcze',
  isDefault: true,
  archived: false,
  sortOrder: 0,
  toBuyCount: 0,
  checkedCount: 0,
  lastActivityAt: null,
  lastActivityBy: null,
  pendingImports: [],
};

/**
 * Propozycja testowa.
 *
 * @param over - Nadpisane pola.
 * @returns Propozycja.
 */
function proposal(
  over: Partial<ShoppingImportItemDto> & { id: string; name: string },
): ShoppingImportItemDto {
  return {
    sourceText: over.name,
    quantityMilli: null,
    unit: null,
    quantityOverridden: false,
    neededAmountMilli: null,
    baseUnit: null,
    packageAmountMilli: null,
    packageLabel: null,
    section: 'other',
    confidenceBps: 9000,
    needsReview: false,
    alreadyHave: false,
    isStaple: false,
    selected: true,
    mergeInto: null,
    ...over,
  };
}

const RECIPE: ShoppingImportDto = {
  id: IMPORT_ID,
  listId: LIST_ID,
  kind: 'recipe',
  input: 'url',
  status: 'parsed',
  sourceUrl: 'https://przepisy.pl/brownie',
  servingsFactorBps: 5_000,
  recipeTitle: 'Brownie',
  baseServings: 12,
  notes: null,
  errorCode: null,
  errorMessage: null,
  createdAt: 1,
  items: [
    proposal({
      id: '01JC7K0000000000000000P001',
      name: 'Czekolada gorzka',
      sourceText: '200 g czekolady',
      quantityMilli: 1000,
      unit: 'pcs',
      neededAmountMilli: 100_000,
      baseUnit: 'g',
      packageAmountMilli: 100_000,
      packageLabel: 'tabliczka',
      mergeInto: { itemId: '01JC7K0000000000000000I001', quantityMilli: 1000, unit: 'pcs' },
    }),
    proposal({
      id: '01JC7K0000000000000000P002',
      name: 'Sól',
      alreadyHave: true,
      selected: false,
      isStaple: true,
    }),
  ],
};

beforeEach(() => {
  clearOfflineStore();
  vi.spyOn(shoppingApi, 'fetchShoppingLists').mockResolvedValue([LIST]);
  vi.spyOn(shoppingApi, 'fetchSuggestions').mockResolvedValue([]);
  vi.spyOn(shoppingApi, 'fetchFrequent').mockResolvedValue([]);
  vi.spyOn(scanApi, 'fetchAiUsage').mockResolvedValue({
    enabled: true,
  } as unknown as Awaited<ReturnType<typeof scanApi.fetchAiUsage>>);
});

afterEach(() => {
  vi.restoreAllMocks();
  clearOfflineStore();
});

describe('przegląd odczytu', () => {
  it('przepis: sekcje Do kupienia / Już mam, dopisek potrzeby, scalenie, zatwierdzenie', async () => {
    const user = userEvent.setup();
    vi.spyOn(shoppingApi, 'fetchImport').mockResolvedValue(RECIPE);
    const commit = vi
      .spyOn(shoppingApi, 'commitImport')
      .mockResolvedValue({ listId: LIST_ID, addedCount: 0, mergedCount: 1 });
    vi.spyOn(shoppingApi, 'fetchShoppingItems').mockResolvedValue({ list: LIST, items: [] });
    const { router } = renderScreen(`/shopping/${LIST_ID}/import/${IMPORT_ID}`, ROUTES);

    expect(
      await screen.findByRole('heading', { name: 'Brownie' }, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Przepis na 12 porcji · ×0,5')).toBeInTheDocument();
    const toBuy = screen
      .getByRole('heading', { name: 'Do kupienia (1)' })
      .closest('section') as HTMLElement;
    expect(
      within(toBuy).getByText(/potrzeba 100 g · tabliczka 100 g · Już na liście \(1 szt\.\)/u),
    ).toBeInTheDocument();
    const have = screen
      .getByRole('heading', { name: 'Już mam (1)' })
      .closest('section') as HTMLElement;
    expect(within(have).getByRole('checkbox', { name: 'Sól — już mam' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(within(have).getByRole('button', { name: 'Nie zawsze mam' })).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Dodaj 1 pozycję do „Spożywcze”' }));
    expect(commit).toHaveBeenCalledWith('token-testowy', IMPORT_ID, expect.any(String) as string);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/shopping/${LIST_ID}`);
    });
    expect(await screen.findByText('Dodano 0 · scalono 1.')).toBeInTheDocument();
  });

  it('mnożnik, przeniesienie do „Już mam" i stepper idą na serwer', async () => {
    const user = userEvent.setup();
    vi.spyOn(shoppingApi, 'fetchImport').mockResolvedValue(RECIPE);
    const updateImport = vi
      .spyOn(shoppingApi, 'updateImport')
      .mockResolvedValue({ ...RECIPE, servingsFactorBps: 10_000 });
    const updateItem = vi.spyOn(shoppingApi, 'updateImportItem').mockResolvedValue(RECIPE);
    renderScreen(`/shopping/${LIST_ID}/import/${IMPORT_ID}`, ROUTES);

    await user.click(await screen.findByRole('button', { name: '×1' }, { timeout: 3_000 }));
    expect(updateImport).toHaveBeenCalledWith('token-testowy', IMPORT_ID, {
      servingsFactorBps: 10_000,
    });
    await user.click(screen.getByRole('button', { name: 'Więcej: Czekolada gorzka' }));
    expect(updateItem).toHaveBeenCalledWith(
      'token-testowy',
      IMPORT_ID,
      '01JC7K0000000000000000P001',
      { quantityMilli: 2000, unit: 'pcs' },
    );
    await user.click(screen.getByRole('checkbox', { name: 'Czekolada gorzka — do kupienia' }));
    expect(updateItem).toHaveBeenLastCalledWith(
      'token-testowy',
      IMPORT_ID,
      '01JC7K0000000000000000P001',
      { selected: false, alreadyHave: true },
    );
  });

  it('odczyt w toku, potem zdjęcie listy z „Sprawdź"', async () => {
    const photo: ShoppingImportDto = {
      ...RECIPE,
      kind: 'list_photo',
      input: 'image',
      servingsFactorBps: null,
      recipeTitle: null,
      baseServings: null,
      items: [
        proposal({
          id: '01JC7K0000000000000000P003',
          name: 'Mleko',
          sourceText: 'mlko?',
          needsReview: true,
        }),
      ],
    };
    const fetch = vi
      .spyOn(shoppingApi, 'fetchImport')
      .mockResolvedValueOnce({ ...photo, status: 'processing', items: [] })
      .mockResolvedValue(photo);
    renderScreen(`/shopping/${LIST_ID}/import/${IMPORT_ID}`, ROUTES);
    expect(
      await screen.findByRole('heading', { name: 'Czytam listę…' }, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Lista ze zdjęcia' }, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Sprawdź')).toBeInTheDocument();
    expect(screen.getByText('„mlko?”')).toBeInTheDocument();
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('nieudany odczyt pokazuje przyczynę i drogę dalej', async () => {
    const user = userEvent.setup();
    vi.spyOn(shoppingApi, 'fetchImport').mockResolvedValue({
      ...RECIPE,
      status: 'failed',
      items: [],
      errorCode: 'RECIPE_FETCH_BLOCKED',
      errorMessage: 'Tego adresu nie da się pobrać. Wklej treść przepisu albo zrób zrzut ekranu.',
    });
    const retry = vi
      .spyOn(shoppingApi, 'retryImport')
      .mockResolvedValue({ ...RECIPE, status: 'processing', items: [] });
    const discard = vi.spyOn(shoppingApi, 'discardImport').mockResolvedValue(undefined);
    vi.spyOn(shoppingApi, 'fetchShoppingItems').mockResolvedValue({ list: LIST, items: [] });
    renderScreen(`/shopping/${LIST_ID}/import/${IMPORT_ID}`, ROUTES);
    expect(
      await screen.findByText(/Tego adresu nie da się pobrać/u, {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(retry).toHaveBeenCalledWith('token-testowy', IMPORT_ID);
    await user.click(await screen.findByRole('button', { name: 'Odrzuć' }));
    expect(discard).toHaveBeenCalledWith('token-testowy', IMPORT_ID);
  });
});

describe('arkusz „Dodaj z…" i udostępnianie', () => {
  it('przepis z linku z mnożnikiem → import i przejście do przeglądu', async () => {
    const user = userEvent.setup();
    vi.spyOn(shoppingApi, 'fetchShoppingItems').mockResolvedValue({ list: LIST, items: [] });
    const create = vi
      .spyOn(shoppingApi, 'createTextImport')
      .mockResolvedValue({ ...RECIPE, status: 'processing', items: [] });
    vi.spyOn(shoppingApi, 'fetchImport').mockResolvedValue({
      ...RECIPE,
      status: 'processing',
      items: [],
    });
    const { router } = renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    await user.click(
      await screen.findByRole(
        'button',
        { name: 'Dodaj ze zdjęcia albo przepisu' },
        { timeout: 3_000 },
      ),
    );
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Przepis' }));
    await user.click(within(sheet).getByRole('button', { name: 'Link' }));
    await user.type(within(sheet).getByLabelText('Link do przepisu'), 'ftp://zly');
    await user.click(within(sheet).getByRole('button', { name: 'Odczytaj przepis' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Wklej adres strony z przepisem');
    await user.clear(within(sheet).getByLabelText('Link do przepisu'));
    await user.type(
      within(sheet).getByLabelText('Link do przepisu'),
      'https://przepisy.pl/brownie',
    );
    await user.click(within(sheet).getByRole('button', { name: '×0,5' }));
    await user.click(within(sheet).getByRole('button', { name: 'Odczytaj przepis' }));
    expect(create).toHaveBeenCalledWith('token-testowy', {
      input: 'url',
      kind: 'recipe',
      listId: LIST_ID,
      url: 'https://przepisy.pl/brownie',
      servingsFactorBps: 5_000,
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/shopping/${LIST_ID}/import/${IMPORT_ID}`);
    });
  });

  it('zdjęcie listy: skalowane w przeglądarce i wysłane jako obraz', async () => {
    const user = userEvent.setup();
    vi.spyOn(shoppingApi, 'fetchShoppingItems').mockResolvedValue({ list: LIST, items: [] });
    vi.spyOn(resize, 'prepareUpload').mockResolvedValue({
      blob: new Blob(['x']),
      filename: 'tablica.jpg',
      processed: true,
    });
    const create = vi
      .spyOn(shoppingApi, 'createImageImport')
      .mockResolvedValue({ ...RECIPE, kind: 'list_photo', status: 'processing', items: [] });
    vi.spyOn(shoppingApi, 'fetchImport').mockResolvedValue({
      ...RECIPE,
      kind: 'list_photo',
      status: 'processing',
      items: [],
    });
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    await user.click(
      await screen.findByRole(
        'button',
        { name: 'Dodaj ze zdjęcia albo przepisu' },
        { timeout: 3_000 },
      ),
    );
    const sheet = await screen.findByRole('dialog');
    await user.upload(
      within(sheet).getByLabelText('Zrób zdjęcie listy'),
      new File(['x'], 'IMG_1.heic', { type: 'image/heic' }),
    );
    expect(await within(sheet).findByText('tablica.jpg')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Odczytaj listę' }));
    const [, input] = create.mock.calls[0] ?? [];
    expect(input).toMatchObject({ listId: LIST_ID, kind: 'list_photo' });
    expect(input?.servingsFactorBps).toBeUndefined();
  });

  it('link ze schowka jednym przyciskiem', async () => {
    const user = userEvent.setup();
    vi.spyOn(shoppingApi, 'fetchShoppingItems').mockResolvedValue({ list: LIST, items: [] });
    vi.spyOn(navigator.clipboard, 'readText').mockResolvedValue('  https://przepisy.pl/sernik \n');
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    await user.click(
      await screen.findByRole(
        'button',
        { name: 'Dodaj ze zdjęcia albo przepisu' },
        { timeout: 3_000 },
      ),
    );
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Przepis' }));
    await user.click(within(sheet).getByRole('button', { name: 'Link' }));
    await user.click(within(sheet).getByRole('button', { name: 'Wklej ze schowka' }));
    expect(within(sheet).getByLabelText('Link do przepisu')).toHaveValue(
      'https://przepisy.pl/sernik',
    );
  });

  it('bez sieci aparat wyszarzony — odczyt wymaga serwera', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.spyOn(shoppingApi, 'fetchShoppingItems').mockResolvedValue({ list: LIST, items: [] });
    renderScreen(`/shopping/${LIST_ID}`, ROUTES);
    expect(
      await screen.findByRole(
        'button',
        { name: 'Dodaj ze zdjęcia albo przepisu' },
        { timeout: 3_000 },
      ),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('share_target: link z tekstu udostępnienia w formularzu przepisu dla listy domyślnej', async () => {
    renderScreen('/shopping/share?text=Zobacz%20https%3A%2F%2Fprzepisy.pl%2Fbrownie', ROUTES);
    expect(
      await screen.findByText('Do listy „Spożywcze”.', {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Link do przepisu')).toHaveValue('https://przepisy.pl/brownie');
    expect(screen.getByRole('button', { name: 'Przepis' })).toHaveAttribute('aria-pressed', 'true');
  });
});
