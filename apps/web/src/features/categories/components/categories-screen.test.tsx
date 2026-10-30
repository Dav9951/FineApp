import type { CategoryDto, CategoryTreeDto } from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '../../../../test/render-screen.js';
import { AppShell } from '../../../components/layout/app-shell.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import * as categoriesApi from '../api.js';
import CategoriesScreen from './categories-screen.js';

/**
 * Testy ekranu kategorii — cztery stany, użycie z podkategoriami, zakładki w adresie,
 * formularz z podpowiedziami dla AI, archiwizacja, scalenie, usunięcie
 * ([06 §3.11](../../../../../../plans/06-ui-views.md#311-kategorie--settingscategories)).
 */

const FOOD = '01JC0000000000000000000001';
const COFFEE = '01JC0000000000000000000002';
const OLD = '01JC0000000000000000000003';
const TRANSPORT = '01JC0000000000000000000004';

/**
 * Kategoria w kształcie z kontraktu.
 *
 * @param id - Identyfikator.
 * @param name - Nazwa.
 * @param overrides - Nadpisane pola.
 * @returns Kategoria.
 */
function category(id: string, name: string, overrides: Partial<CategoryDto> = {}): CategoryDto {
  return {
    id,
    parentId: null,
    name,
    slug: id,
    kind: 'expense',
    icon: null,
    color: null,
    aiHints: null,
    isSystem: false,
    isArchived: false,
    sortOrder: 0,
    ...overrides,
  };
}

/** Jedzenie (systemowa) z Kawą i zarchiwizowaną „Starą", Transport bez dzieci. */
const TREE: CategoryTreeDto[] = [
  {
    ...category(FOOD, 'Jedzenie', { isSystem: true, aiHints: 'Biedronka, Lidl' }),
    children: [
      category(COFFEE, 'Kawa', { parentId: FOOD }),
      category(OLD, 'Stara', { parentId: FOOD, isArchived: true }),
    ],
  },
  { ...category(TRANSPORT, 'Transport'), children: [] },
];

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Podstawia drzewo i użycie, renderuje ekran w powłoce.
 *
 * @param path - Adres startowy.
 * @param tree - Drzewo kategorii.
 * @returns Router i atrapa drzewa.
 */
function renderCategories(path = '/settings/categories', tree: CategoryTreeDto[] = TREE) {
  const fetchTree = vi.spyOn(categoriesApi, 'fetchCategoryTree').mockResolvedValue(tree);
  vi.spyOn(categoriesApi, 'fetchCategoryUsage').mockResolvedValue([
    { categoryId: FOOD, transactionCount: 1, monthAmountMinor: 2_000 },
    { categoryId: COFFEE, transactionCount: 11, monthAmountMinor: 12_000 },
  ]);
  const { router } = renderScreen(path, [
    {
      path: '/',
      element: <AppShell />,
      children: [{ path: 'settings/categories', element: <CategoriesScreen /> }],
    },
  ]);
  return { router, fetchTree };
}

/**
 * Wiersz kategorii po nazwie.
 *
 * @param name - Nazwa kategorii.
 * @returns Przycisk wiersza.
 */
async function row(name: string): Promise<HTMLElement> {
  const label = await screen.findByText(name, { selector: 'span' });
  const button = label.closest('button');
  if (button === null) throw new Error(`brak wiersza ${name}`);
  return button;
}

describe('stany ekranu', () => {
  it('drzewo z sumą rodzica razem z dziećmi, plakietka „własna" i archiwum', async () => {
    const { fetchTree } = renderCategories();

    const food = await row('Jedzenie');
    expect(within(food).getByText('12 transakcji')).toBeInTheDocument();
    expect(within(food).getByText('140,00 zł')).toBeInTheDocument();
    // Plakietka wyróżnia kategorie dodane przez domowników, nie systemowe (Z-25).
    expect(within(food).queryByText('własna')).not.toBeInTheDocument();

    const coffee = await row('Kawa');
    expect(within(coffee).getByText('własna')).toBeInTheDocument();
    expect(within(coffee).getByText('11 transakcji')).toBeInTheDocument();
    expect(within(await row('Transport')).getByText('nieużywana')).toBeInTheDocument();

    const archive = screen.getByRole('heading', { name: 'Archiwum' }).closest('section');
    if (archive === null) throw new Error('brak archiwum');
    expect(within(archive).getByText('Stara')).toBeInTheDocument();
    expect(within(archive).getByText(/w: Jedzenie/u)).toBeInTheDocument();
    expect(fetchTree).toHaveBeenCalledWith('token-testowy', 'expense', true);
  });

  it('zakładka rodzaju trafia do adresu i do zapytania', async () => {
    const { router, fetchTree } = renderCategories();
    await row('Jedzenie');
    await userEvent.click(screen.getByRole('tab', { name: 'Przychody' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?kind=income');
    });
    await waitFor(() => {
      expect(fetchTree).toHaveBeenCalledWith('token-testowy', 'income', true);
    });
  });

  it('pusto — jedna akcja: dodaj kategorię', async () => {
    renderCategories('/settings/categories?kind=transfer', []);
    expect(await screen.findByText('Brak kategorii tego rodzaju')).toBeInTheDocument();
    // Dwa wejścia: „+" w nagłówku i akcja stanu pustego — ta druga jest ostatnia.
    const [, emptyAction] = screen.getAllByRole('button', { name: 'Dodaj kategorię' });
    if (emptyAction === undefined) throw new Error('brak akcji stanu pustego');
    await userEvent.click(emptyAction);
    expect(
      await screen.findByRole('dialog', { name: 'Nowa kategoria przelewu' }),
    ).toBeInTheDocument();
  });

  it('błąd — z ponowieniem', async () => {
    vi.spyOn(categoriesApi, 'fetchCategoryTree')
      .mockRejectedValueOnce(new ApiRequestError('INTERNAL_ERROR', 'Awaria', 500, 'req'))
      .mockResolvedValue(TREE);
    vi.spyOn(categoriesApi, 'fetchCategoryUsage').mockResolvedValue([]);
    renderScreen('/settings/categories', [
      {
        path: '/',
        element: <AppShell />,
        children: [{ path: 'settings/categories', element: <CategoriesScreen /> }],
      },
    ]);
    expect(await screen.findByText('Nie udało się wczytać kategorii')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await row('Jedzenie')).toBeInTheDocument();
  });
});

describe('formularz', () => {
  it('nowa podkategoria z podpowiedziami dla AI — POST z rodzajem zakładki', async () => {
    const create = vi
      .spyOn(categoriesApi, 'createCategory')
      .mockResolvedValue(category('01JC0000000000000000000009', 'Kawiarnie'));
    renderCategories();
    await row('Jedzenie');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj kategorię' }));
    const sheet = await screen.findByRole('dialog', { name: 'Nowa kategoria wydatku' });

    await userEvent.click(within(sheet).getByRole('button', { name: 'Dodaj' }));
    expect(within(sheet).getByText('Nazwa jest wymagana')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Nazwa' }), 'Kawiarnie');
    await userEvent.click(within(sheet).getByRole('button', { name: /Należy do/u }));
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Jedzenie' }));
    // Wybór zwija listę z powrotem do jednego wiersza z wybraną kategorią.
    expect(within(sheet).getByRole('button', { name: /Należy do.*Jedzenie/u })).toBeInTheDocument();
    const hints = within(sheet).getByRole('textbox', { name: 'Podpowiedzi dla AI' });
    expect(hints).toHaveAccessibleDescription(/trafniej AI przypisze/u);
    await userEvent.type(hints, 'Starbucks, Costa');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Dodaj' }));

    expect(create).toHaveBeenCalledWith('token-testowy', {
      name: 'Kawiarnie',
      kind: 'expense',
      parentId: FOOD,
      aiHints: 'Starbucks, Costa',
    });
    expect(await screen.findByText('Dodano kategorię „Kawiarnie"')).toBeInTheDocument();
  });

  it('nazwa zajęta (409) trafia pod pole nazwy', async () => {
    vi.spyOn(categoriesApi, 'createCategory').mockRejectedValue(
      new ApiRequestError('CONFLICT', 'Taka nazwa już jest w tej kategorii.', 409, 'req'),
    );
    renderCategories();
    await row('Jedzenie');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj kategorię' }));
    const sheet = await screen.findByRole('dialog');
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Nazwa' }), 'Transport');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Dodaj' }));
    expect(
      await within(sheet).findByRole('textbox', { name: 'Nazwa' }),
    ).toHaveAccessibleDescription('Taka nazwa już jest w tej kategorii.');
  });

  it('edycja systemowej: bez „Usuń" i scalenia, PATCH tylko ze zmienionymi podpowiedziami', async () => {
    const update = vi
      .spyOn(categoriesApi, 'updateCategory')
      .mockResolvedValue(category(FOOD, 'Jedzenie'));
    renderCategories();
    await userEvent.click(await row('Jedzenie'));
    const sheet = await screen.findByRole('dialog', { name: 'Edytuj kategorię' });
    expect(within(sheet).getByText(/nie usunąć/u)).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Usuń' })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Scal z inną…' })).not.toBeInTheDocument();
    // Kategoria z podkategoriami nie może zostać podkategorią — brak wyboru rodzica.
    expect(within(sheet).queryByRole('button', { name: /Należy do/u })).not.toBeInTheDocument();

    await userEvent.type(
      within(sheet).getByRole('textbox', { name: 'Podpowiedzi dla AI' }),
      ', Żabka',
    );
    await userEvent.click(within(sheet).getByRole('button', { name: 'Zapisz zmiany' }));
    expect(update).toHaveBeenCalledWith('token-testowy', FOOD, {
      aiHints: 'Biedronka, Lidl, Żabka',
    });
  });

  it('archiwizacja z „Cofnij" w toaście', async () => {
    const setArchived = vi
      .spyOn(categoriesApi, 'setCategoryArchived')
      .mockResolvedValue(category(TRANSPORT, 'Transport'));
    renderCategories();
    await userEvent.click(await row('Transport'));
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Archiwizuj' }));
    expect(setArchived).toHaveBeenCalledWith('token-testowy', TRANSPORT, true);
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    await waitFor(() => {
      expect(setArchived).toHaveBeenLastCalledWith('token-testowy', TRANSPORT, false);
    });
  });

  it('scalenie: wybór celu, wynik z liczbą przeniesionych transakcji', async () => {
    const merge = vi.spyOn(categoriesApi, 'mergeCategory').mockResolvedValue({
      target: category(TRANSPORT, 'Transport'),
      transactionsMoved: 11,
    });
    renderCategories();
    await userEvent.click(await row('Kawa'));
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Scal z inną…' }));
    const scal = within(sheet).getByRole('button', { name: 'Scal' });
    expect(scal).toBeDisabled();
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Transport' }));
    await userEvent.click(scal);
    expect(merge).toHaveBeenCalledWith('token-testowy', COFFEE, TRANSPORT);
    expect(
      await screen.findByText('Scalono z „Transport" · przeniesiono transakcji: 11'),
    ).toBeInTheDocument();
  });

  it('usunięcie wymaga potwierdzenia; 409 zostaje w arkuszu z komunikatem serwera', async () => {
    const remove = vi
      .spyOn(categoriesApi, 'deleteCategory')
      .mockRejectedValue(
        new ApiRequestError('CONFLICT', 'Kategoria ma transakcje — zarchiwizuj ją.', 409, 'req'),
      );
    renderCategories();
    await userEvent.click(await row('Kawa'));
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Usuń' }));
    expect(remove).not.toHaveBeenCalled();
    const confirm = within(sheet).getAllByRole('button', { name: 'Usuń' }).at(-1);
    if (confirm === undefined) throw new Error('brak potwierdzenia');
    await userEvent.click(confirm);
    expect(remove).toHaveBeenCalledWith('token-testowy', COFFEE);
    expect(
      await within(sheet).findByText('Kategoria ma transakcje — zarchiwizuj ją.'),
    ).toBeInTheDocument();
  });

  it('kategoria z archiwum: „Przywróć z archiwum"', async () => {
    const setArchived = vi
      .spyOn(categoriesApi, 'setCategoryArchived')
      .mockResolvedValue(category(OLD, 'Stara'));
    renderCategories();
    await userEvent.click(await row('Stara'));
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Przywróć z archiwum' }));
    expect(setArchived).toHaveBeenCalledWith('token-testowy', OLD, false);
    expect(await screen.findByText('Przywrócono „Stara"')).toBeInTheDocument();
  });
});
