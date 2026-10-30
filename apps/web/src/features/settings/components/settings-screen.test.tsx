import {
  currentMonthKey,
  formatMonth,
  type AccountDto,
  type AiUsageDto,
  type SessionDto,
  type SettingsDto,
} from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, TEST_SESSION } from '../../../../test/render-screen.js';
import { ToastProvider } from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import * as accountsApi from '../../accounts/api.js';
import * as authApi from '../../auth/api.js';
import * as documentsApi from '../../scan/api.js';
import * as settingsApi from '../api.js';
import SettingsScreen from './settings-screen.js';

/**
 * Testy ekranu ustawień — `F8-1`, `F8-2`: cztery stany, gospodarstwo z limitem wstecz,
 * profil, PIN, urządzenia, eksport, sekcja AI, wylogowanie
 * ([06 §3.12](../../../../../../plans/06-ui-views.md#312-ustawienia--settings)).
 */

const OTHER = '01J9ZQK8WQ3333333333333333';

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
      id: OTHER,
      email: 'basia@example.com',
      displayName: 'Basia Nowak',
      avatarColor: null,
      isCurrent: false,
      lastLoginAt: null,
    },
  ],
  appVersion: '1.4.2',
};

const USAGE: AiUsageDto = {
  enabled: true,
  model: 'claude-sonnet-5',
  monthKey: '2026-09',
  documentCount: 7,
  inputTokens: 1,
  outputTokens: 1,
  spentMinor: 1_250,
  budgetMinor: 5_000,
  remainingMinor: 3_750,
};

beforeEach(() => {
  vi.spyOn(documentsApi, 'fetchAiUsage').mockResolvedValue(USAGE);
  vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Renderuje ekran z podstawionymi ustawieniami.
 *
 * @param settings - Ustawienia z API albo obietnica.
 * @returns Atrapa zapytania o ustawienia.
 */
function renderSettings(settings: SettingsDto | Promise<SettingsDto> = SETTINGS) {
  const fetchSettings = vi
    .spyOn(settingsApi, 'fetchSettings')
    .mockImplementation(() => Promise.resolve(settings));
  renderScreen('/settings', [
    {
      path: '/settings',
      element: (
        <ToastProvider>
          <SettingsScreen />
        </ToastProvider>
      ),
    },
  ]);
  return { fetchSettings };
}

/**
 * Wiersz listy po nazwie.
 *
 * @param name - Nazwa w wierszu.
 * @returns Przycisk wiersza.
 */
async function row(name: string | RegExp): Promise<HTMLElement> {
  const label = await screen.findByText(name, { selector: 'span' });
  const button = label.closest('button');
  if (button === null) throw new Error(`brak wiersza ${String(name)}`);
  return button;
}

/**
 * Sekcja ekranu po nagłówku.
 *
 * @param title - Nagłówek sekcji.
 * @returns Element sekcji.
 */
function section(title: string): HTMLElement {
  const found = screen.getByRole('heading', { name: title }).closest('section');
  if (found === null) throw new Error(`brak sekcji ${title}`);
  return found;
}

describe('stany ekranu', () => {
  it('treść: gospodarstwo, domownicy, dane, AI, wersja', async () => {
    renderSettings();
    expect(await screen.findByText('Dom')).toBeInTheDocument();
    expect(screen.getByText('Europe/Warsaw')).toBeInTheDocument();
    expect(screen.getByText('Wstecz: 1 miesiąc wstecz')).toBeInTheDocument();
    expect(screen.getByText(/^Księgowanie od 1 /u)).toBeInTheDocument();
    expect(screen.getByText('Waluta: PLN')).toBeInTheDocument();

    const members = section('Domownicy');
    expect(within(members).getByText('Basia Nowak')).toBeInTheDocument();
    expect(within(members).getByText('BN')).toBeInTheDocument();
    expect(within(members).getByText('Ty')).toBeInTheDocument();

    expect(screen.getByText('1.4.2')).toBeInTheDocument();
    const ai = section('Odczyt dokumentów (AI)');
    expect(await within(ai).findByText('12,50 zł')).toBeInTheDocument();
    expect(within(ai).getByText(/25%/u)).toBeInTheDocument();
    expect(within(ai).getByText('7')).toBeInTheDocument();
  });

  it('ładowanie — szkielet', () => {
    renderSettings(new Promise<SettingsDto>(() => undefined));
    expect(screen.getByLabelText('Wczytywanie ustawień')).toHaveAttribute('aria-busy', 'true');
  });

  it('błąd — ponowienie wczytuje od nowa', async () => {
    const failing = vi
      .spyOn(settingsApi, 'fetchSettings')
      .mockRejectedValueOnce(new ApiRequestError('INTERNAL_ERROR', 'Awaria', 500, 'req-2'))
      .mockResolvedValue(SETTINGS);
    renderScreen('/settings', [
      {
        path: '/settings',
        element: (
          <ToastProvider>
            <SettingsScreen />
          </ToastProvider>
        ),
      },
    ]);
    expect(await screen.findByText('Nie udało się wczytać ustawień')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Spróbuj ponownie/u }));
    expect(await screen.findByText('Dom')).toBeInTheDocument();
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('AI wyłączone — wyjaśnienie zamiast kosztów', async () => {
    vi.spyOn(documentsApi, 'fetchAiUsage').mockResolvedValue({ ...USAGE, enabled: false });
    renderSettings();
    expect(await screen.findByText(/Odczyt paragonów jest wyłączony/u)).toBeInTheDocument();
  });

  it('AI bez limitu — bez procentu', async () => {
    vi.spyOn(documentsApi, 'fetchAiUsage').mockResolvedValue({
      ...USAGE,
      budgetMinor: 0,
      remainingMinor: null,
    });
    renderSettings();
    expect(await screen.findByText('bez limitu miesięcznego')).toBeInTheDocument();
  });

  it('AI z wyczerpanym limitem — ostrzeżenie', async () => {
    vi.spyOn(documentsApi, 'fetchAiUsage').mockResolvedValue({
      ...USAGE,
      spentMinor: 5_000,
      remainingMinor: 0,
    });
    renderSettings();
    expect(await screen.findByText(/Limit na ten miesiąc wyczerpany/u)).toBeInTheDocument();
  });
});

describe('gospodarstwo', () => {
  it('obniżenie limitu ostrzega przed zapisem i wysyła tylko zmianę', async () => {
    const update = vi
      .spyOn(settingsApi, 'updateHousehold')
      .mockResolvedValue({ ...SETTINGS.household, backPostingLimitMonths: 0 });
    const { fetchSettings } = renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Zmień' }));
    // Po zapisie ekran wczytuje ustawienia od nowa — serwer oddaje już nowy limit.
    fetchSettings.mockResolvedValue({
      ...SETTINGS,
      household: { ...SETTINGS.household, backPostingLimitMonths: 0 },
    });
    const dialog = await screen.findByRole('dialog');

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Brak' }));
    expect(within(dialog).getByRole('status')).toHaveTextContent(/nie da się już zmienić/u);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('token-testowy', { backPostingLimitMonths: 0 });
    });
    expect(await screen.findByText('Wstecz: tylko bieżący miesiąc')).toBeInTheDocument();
  });

  it('konto do wydatków: wybór zapisuje się od razu, „Bez domyślnego" czyści (ADR-070)', async () => {
    const joint = {
      id: '01JB0000000000000000000002',
      name: 'Wspólne',
      type: 'checking',
      allocationClass: 'spending',
      currency: 'PLN',
      openingBalanceMinor: 0,
      openingBalanceOn: '2026-01-01',
      includeInNetWorth: true,
      isArchived: false,
      sortOrder: 0,
      color: null,
      icon: null,
      institution: null,
      notes: null,
      createdAt: 1,
      updatedAt: 1,
    } as AccountDto;
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([joint]);
    // Serwer pamięta zmianę — odświeżenie po zapisie ma ją zobaczyć.
    let household = SETTINGS.household;
    const update = vi.spyOn(settingsApi, 'updateHousehold').mockImplementation((_token, body) => {
      household = { ...household, ...body };
      return Promise.resolve(household);
    });
    vi.spyOn(settingsApi, 'fetchSettings').mockImplementation(() =>
      Promise.resolve({ ...SETTINGS, household }),
    );
    renderScreen('/settings', [
      {
        path: '/settings',
        element: (
          <ToastProvider>
            <SettingsScreen />
          </ToastProvider>
        ),
      },
    ]);

    await userEvent.click(await row('Nie wybrano'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByText('Wspólne'));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('token-testowy', { defaultExpenseAccountId: joint.id });
    });
    expect(await row('Wspólne')).toBeInTheDocument();

    await userEvent.click(await row('Wspólne'));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Bez domyślnego' }),
    );
    await waitFor(() => {
      expect(update).toHaveBeenLastCalledWith('token-testowy', { defaultExpenseAccountId: null });
    });
    expect(await row('Nie wybrano')).toBeInTheDocument();
  });

  it('nieznana strefa — błąd przy polu, bez żądania', async () => {
    const update = vi.spyOn(settingsApi, 'updateHousehold');
    renderSettings();
    await userEvent.click(await row('Europe/Warsaw'));
    const dialog = await screen.findByRole('dialog');
    const zone = within(dialog).getByLabelText('Strefa czasowa');
    await userEvent.clear(zone);
    await userEvent.type(zone, 'Europe/Gdansk');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));
    expect(await within(dialog).findByText('Nieznana strefa czasowa')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('domownicy', () => {
  it('własny wiersz otwiera profil; zapis wysyła nową nazwę', async () => {
    const update = vi
      .spyOn(settingsApi, 'updateProfile')
      .mockResolvedValue({ ...TEST_SESSION.user, displayName: 'Adam K.' });
    renderSettings();
    await userEvent.click(await row('Adam'));
    const dialog = await screen.findByRole('dialog', { name: 'Twój profil' });
    const name = within(dialog).getByLabelText('Imię lub nazwa');
    await userEvent.clear(name);
    await userEvent.type(name, 'Adam K.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('token-testowy', { displayName: 'Adam K.' });
    });
  });

  it('wiersz drugiego domownika nie jest przyciskiem', async () => {
    renderSettings();
    const label = await screen.findByText('Basia Nowak');
    expect(label.closest('button')).toBeNull();
  });

  it('zmiana PIN-u: słaby PIN zatrzymany, poprawny wysłany, potwierdzenie z liczbą urządzeń', async () => {
    const change = vi.spyOn(authApi, 'changePin').mockResolvedValue({ affected: 1 });
    renderSettings();
    await userEvent.click(await row('Zmień PIN'));
    const dialog = await screen.findByRole('dialog', { name: 'Zmiana PIN-u' });

    await userEvent.type(within(dialog).getByLabelText('Obecny PIN'), '482915');
    await userEvent.type(within(dialog).getByLabelText('Nowy PIN'), '123456');
    await userEvent.type(within(dialog).getByLabelText('Powtórz nowy PIN'), '123456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień PIN' }));
    expect(
      await within(dialog).findByText('PIN nie może być ciągiem kolejnych cyfr.'),
    ).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();

    const next = within(dialog).getByLabelText('Nowy PIN');
    await userEvent.clear(next);
    await userEvent.type(next, '739164');
    const confirm = within(dialog).getByLabelText('Powtórz nowy PIN');
    await userEvent.clear(confirm);
    await userEvent.type(confirm, '739164');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień PIN' }));

    await waitFor(() => {
      expect(change).toHaveBeenCalledWith('token-testowy', {
        currentPin: '482915',
        newPin: '739164',
      });
    });
    expect(
      await screen.findByText('PIN zmieniony. Wylogowano 1 inne urządzenie.'),
    ).toBeInTheDocument();
  });

  it('zły obecny PIN — komunikat serwera przy polu', async () => {
    vi.spyOn(authApi, 'changePin').mockRejectedValue(
      new ApiRequestError('UNAUTHORIZED', 'Obecny PIN się nie zgadza.', 401, 'req'),
    );
    renderSettings();
    await userEvent.click(await row('Zmień PIN'));
    const dialog = await screen.findByRole('dialog', { name: 'Zmiana PIN-u' });
    await userEvent.type(within(dialog).getByLabelText('Obecny PIN'), '482915');
    await userEvent.type(within(dialog).getByLabelText('Nowy PIN'), '739164');
    await userEvent.type(within(dialog).getByLabelText('Powtórz nowy PIN'), '739164');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień PIN' }));
    expect(await within(dialog).findByText('Obecny PIN się nie zgadza.')).toBeInTheDocument();
  });

  it('urządzenia: wylogowanie innego i „Wyloguj wszędzie" z potwierdzeniem', async () => {
    const sessions: SessionDto[] = [
      {
        id: '01J9ZQK8WQ4444444444444444',
        deviceLabel: 'Ten laptop',
        current: true,
        sameDevice: true,
        lastUsedAt: null,
        createdAt: 1,
        expiresAt: 2,
      },
      {
        id: '01J9ZQK8WQ5555555555555555',
        deviceLabel: 'iPhone — Safari',
        current: false,
        sameDevice: false,
        lastUsedAt: 1,
        createdAt: 1,
        expiresAt: 2,
      },
    ];
    vi.spyOn(authApi, 'sessions').mockResolvedValue(sessions);
    const revoke = vi.spyOn(authApi, 'revokeSession').mockResolvedValue({ affected: 1 });
    const logoutAll = vi.spyOn(authApi, 'logoutAll').mockResolvedValue({ affected: 2 });
    renderSettings();
    await userEvent.click(await row('Urządzenia'));
    const dialog = await screen.findByRole('dialog', { name: 'Urządzenia' });

    expect(await within(dialog).findByText('to urządzenie')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Wyloguj: Ten laptop' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyloguj: iPhone — Safari' }));
    await waitFor(() => {
      expect(revoke).toHaveBeenCalledWith('token-testowy', sessions[1]?.id);
    });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyloguj wszędzie' }));
    expect(logoutAll).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tak, wyloguj wszędzie' }));
    await waitFor(() => {
      expect(logoutAll).toHaveBeenCalledWith('token-testowy');
    });
  });
});

describe('dane — eksport', () => {
  let created: Blob[];
  let clicked: string[];

  beforeEach(() => {
    created = [];
    clicked = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:plik';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
  });

  it('kopia JSON zapisuje plik z dzisiejszą datą', async () => {
    const blob = new Blob(['{}']);
    const fetchJson = vi.spyOn(settingsApi, 'fetchExportJson').mockResolvedValue(blob);
    renderSettings();
    await userEvent.click(await row('Kopia wszystkich danych'));
    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });
    expect(fetchJson).toHaveBeenCalledWith('token-testowy');
    expect(created).toEqual([blob]);
    expect(clicked[0]).toMatch(/^fineapp-\d{4}-\d{2}-\d{2}\.json$/u);
  });

  it('CSV bieżącego miesiąca i wszystkich transakcji', async () => {
    const fetchCsv = vi.spyOn(settingsApi, 'fetchExportCsv').mockResolvedValue(new Blob(['x']));
    const month = currentMonthKey('Europe/Warsaw');
    renderSettings();
    await userEvent.click(await row(`Transakcje: ${formatMonth(month)}`));
    await waitFor(() => {
      expect(clicked).toEqual([`fineapp-${month}.csv`]);
    });
    expect(fetchCsv).toHaveBeenLastCalledWith('token-testowy', month);

    await userEvent.click(await row('Wszystkie transakcje'));
    await waitFor(() => {
      expect(clicked).toHaveLength(2);
    });
    expect(fetchCsv).toHaveBeenLastCalledWith('token-testowy', undefined);
  });

  it('błąd pobierania — komunikat pod listą', async () => {
    vi.spyOn(settingsApi, 'fetchExportJson').mockRejectedValue(
      new ApiRequestError('INTERNAL_ERROR', 'Serwer nie odpowiada.', 500, 'req'),
    );
    renderSettings();
    await userEvent.click(await row('Kopia wszystkich danych'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Serwer nie odpowiada.');
    expect(clicked).toEqual([]);
  });
});

describe('dane — usunięcie wszystkiego (ADR-072)', () => {
  const DELETED = {
    accounts: 3,
    categories: 1,
    incomeSources: 1,
    goals: 1,
    liabilities: 0,
    allocationTargets: 0,
    recurringRules: 0,
    recurringOccurrences: 0,
    plannedExpenses: 0,
    documents: 0,
    documentItems: 0,
    budgetDrafts: 0,
    budgetDraftGroups: 0,
    budgetDraftLines: 0,
    transactions: 42,
  };

  it('przycisk otwiera arkusz; bez PIN-u nic nie idzie, z PIN-em — usunięcie i potwierdzenie', async () => {
    const reset = vi.spyOn(settingsApi, 'resetData').mockResolvedValue({ deleted: DELETED });
    const { fetchSettings } = renderSettings();
    await screen.findByText('Kopia wszystkich danych');
    await userEvent.click(
      within(section('Dane')).getByRole('button', { name: 'Usuń wszystkie dane' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Usunąć wszystkie dane?' });
    expect(within(dialog).getByText(/Zostają domownicy/u)).toBeInTheDocument();

    const submit = within(dialog).getByRole('button', { name: 'Usuń wszystkie dane' });
    await userEvent.click(submit);
    expect(await within(dialog).findByText('Podaj swój PIN (6–8 cyfr).')).toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText('Twój PIN'), '482915');
    await userEvent.click(submit);

    await waitFor(() => {
      expect(reset).toHaveBeenCalledWith('token-testowy', { pin: '482915' });
    });
    expect(await screen.findByText('Dane usunięte: 42 transakcje, 3 konta.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Pamięć zapytań jest czyszczona — ustawienia wczytują się od nowa.
    await waitFor(() => {
      expect(fetchSettings.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('zły PIN — komunikat serwera przy polu, arkusz zostaje', async () => {
    vi.spyOn(settingsApi, 'resetData').mockRejectedValue(
      new ApiRequestError('UNAUTHORIZED', 'PIN się nie zgadza.', 401, 'req'),
    );
    renderSettings();
    await screen.findByText('Kopia wszystkich danych');
    await userEvent.click(
      within(section('Dane')).getByRole('button', { name: 'Usuń wszystkie dane' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Usunąć wszystkie dane?' });
    await userEvent.type(within(dialog).getByLabelText('Twój PIN'), '111222');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń wszystkie dane' }));
    expect(await within(dialog).findByText('PIN się nie zgadza.')).toBeInTheDocument();
  });
});

describe('O aplikacji', () => {
  it('„Wyloguj" kończy sesję na serwerze', async () => {
    const logout = vi.spyOn(authApi, 'logout').mockResolvedValue();
    renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Wyloguj' }));
    await waitFor(() => {
      expect(logout).toHaveBeenCalled();
    });
  });
});
