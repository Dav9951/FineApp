import type { IncomeSourceDto, SettingsDto } from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, TEST_SESSION } from '../../../../test/render-screen.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import * as settingsApi from '../../settings/api.js';
import * as sourcesApi from '../api.js';
import IncomeSourcesScreen from './income-sources-screen.js';

/**
 * Testy ekranu źródeł przychodu — `F8-1`: cztery stany, dodanie z właścicielem (`Z-15`),
 * edycja, archiwum, usunięcie z `409`.
 */

const BASIA = '01J9ZQK8WQ3333333333333333';
const SALARY = '01J9ZQK8WQ6666666666666666';
const OLD = '01J9ZQK8WQ7777777777777777';

const SETTINGS: SettingsDto = {
  household: TEST_SESSION.household,
  users: [
    {
      id: TEST_SESSION.user.id,
      email: 'adam@example.com',
      displayName: 'Adam',
      avatarColor: null,
      isCurrent: true,
      lastLoginAt: null,
    },
    {
      id: BASIA,
      email: 'basia@example.com',
      displayName: 'Basia',
      avatarColor: null,
      isCurrent: false,
      lastLoginAt: null,
    },
  ],
  appVersion: '1.0.0',
};

const SOURCES: IncomeSourceDto[] = [
  {
    id: SALARY,
    name: 'Pensja Basi',
    kind: 'salary',
    ownerUserId: BASIA,
    countsTowardAllocation: true,
    isArchived: false,
    sortOrder: 0,
  },
  {
    id: OLD,
    name: 'Stare zlecenie',
    kind: 'freelance',
    ownerUserId: null,
    countsTowardAllocation: true,
    isArchived: true,
    sortOrder: 1,
  },
];

beforeEach(() => {
  vi.spyOn(settingsApi, 'fetchSettings').mockResolvedValue(SETTINGS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Renderuje ekran.
 *
 * @param sources - Źródła z API albo obietnica.
 * @returns Atrapa listy.
 */
function renderSources(sources: IncomeSourceDto[] | Promise<IncomeSourceDto[]> = SOURCES) {
  const fetchAll = vi
    .spyOn(sourcesApi, 'fetchIncomeSourcesWithArchive')
    .mockImplementation(() => Promise.resolve(sources));
  renderScreen('/settings/income-sources', [
    { path: '/settings/income-sources', element: <IncomeSourcesScreen /> },
  ]);
  return { fetchAll };
}

/**
 * Wiersz źródła po nazwie.
 *
 * @param name - Nazwa źródła.
 * @returns Przycisk wiersza.
 */
async function row(name: string): Promise<HTMLElement> {
  const label = await screen.findByText(name, { selector: 'span' });
  const button = label.closest('button');
  if (button === null) throw new Error(`brak wiersza ${name}`);
  return button;
}

describe('stany ekranu', () => {
  it('treść: aktywne z właścicielem, archiwum osobno', async () => {
    renderSources();
    const salary = await row('Pensja Basi');
    await waitFor(() => {
      expect(within(salary).getByText('Pensja · Basia')).toBeInTheDocument();
    });
    const archive = screen.getByRole('heading', { name: 'Archiwum' }).closest('section');
    if (archive === null) throw new Error('brak archiwum');
    expect(within(archive).getByText('Stare zlecenie')).toBeInTheDocument();
  });

  it('ładowanie — szkielet', () => {
    renderSources(new Promise<IncomeSourceDto[]>(() => undefined));
    expect(screen.getByLabelText('Wczytywanie źródeł przychodu')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('pusto — jedna akcja', async () => {
    renderSources([]);
    expect(await screen.findByText('Nie masz jeszcze źródeł przychodu')).toBeInTheDocument();
  });

  it('błąd — komunikat z ponowieniem', async () => {
    vi.spyOn(sourcesApi, 'fetchIncomeSourcesWithArchive').mockRejectedValue(
      new ApiRequestError('INTERNAL_ERROR', 'Awaria', 500, 'r'),
    );
    renderScreen('/settings/income-sources', [
      { path: '/settings/income-sources', element: <IncomeSourcesScreen /> },
    ]);
    expect(await screen.findByText('Nie udało się wczytać źródeł przychodu')).toBeInTheDocument();
  });
});

describe('formularz', () => {
  it('nowe źródło z właścicielem — lista domowników z ustawień', async () => {
    const create = vi.spyOn(sourcesApi, 'createIncomeSource').mockResolvedValue(SOURCES[0]!);
    renderSources();
    await row('Pensja Basi');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj źródło przychodu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nowe źródło przychodu' });
    await userEvent.type(within(dialog).getByLabelText('Nazwa'), 'Zwrot podatku');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Zwrot' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Adam' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj źródło' }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith('token-testowy', {
        name: 'Zwrot podatku',
        kind: 'refund',
        ownerUserId: TEST_SESSION.user.id,
        countsTowardAllocation: false,
      });
    });
  });

  it('edycja wysyła tylko zmianę', async () => {
    const update = vi
      .spyOn(sourcesApi, 'updateIncomeSource')
      .mockResolvedValue({ ...SOURCES[0]!, ownerUserId: null });
    renderSources();
    await userEvent.click(await row('Pensja Basi'));
    const dialog = await screen.findByRole('dialog', { name: 'Źródło przychodu' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Wspólne' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('token-testowy', SALARY, { ownerUserId: null });
    });
  });

  it('przywrócenie z archiwum', async () => {
    const restore = vi
      .spyOn(sourcesApi, 'setIncomeSourceArchived')
      .mockResolvedValue({ ...SOURCES[1]!, isArchived: false });
    renderSources();
    await userEvent.click(await row('Stare zlecenie'));
    const dialog = await screen.findByRole('dialog', { name: 'Źródło przychodu' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Przywróć z archiwum' }));
    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith('token-testowy', OLD, false);
    });
  });

  it('usunięcie używanego — komunikat `409` z serwera', async () => {
    vi.spyOn(sourcesApi, 'deleteIncomeSource').mockRejectedValue(
      new ApiRequestError('CONFLICT', 'Źródło ma przychody — zarchiwizuj je.', 409, 'r'),
    );
    renderSources();
    await userEvent.click(await row('Pensja Basi'));
    const dialog = await screen.findByRole('dialog', { name: 'Źródło przychodu' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }));
    const confirm = within(dialog).getAllByRole('button', { name: 'Usuń' }).at(-1);
    if (confirm === undefined) throw new Error('brak potwierdzenia');
    await userEvent.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Źródło ma przychody — zarchiwizuj je.',
    );
  });
});
