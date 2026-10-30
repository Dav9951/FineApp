import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../lib/api-client.js';
import * as authApi from '../api.js';
import { AuthProvider } from '../auth-context.js';
import LoginScreen, { REMEMBERED_EMAIL_KEY } from './login-screen.js';

/**
 * Testy ekranu logowania
 * ([06 §3.13](../../../../../../plans/06-ui-views.md#313-logowanie--login)).
 *
 * To jest jedyna droga do aplikacji — jeśli ten ekran przestanie działać, nie da się
 * wejść wcale. Stąd testy także na przypadki, które „nie powinny się zdarzyć":
 * niedostępne `localStorage`, brak sieci, błąd serwera.
 */

const EMAIL = 'adam@example.com';
const PIN = '483920';

/** Odpowiedź logowania w kształcie z kontraktu. */
const SESSION = {
  accessToken: 'token',
  expiresIn: 900,
  user: {
    id: '01J9ZQK8WQ0000000000000000',
    email: EMAIL,
    displayName: 'Adam',
    avatarColor: null,
    lastLoginAt: null,
  },
  household: {
    id: '01J9ZQK8WQ1111111111111111',
    name: 'Dom',
    baseCurrency: 'PLN',
    timezone: 'Europe/Warsaw',
    locale: 'pl-PL',
    backPostingLimitMonths: 1,
    monthStartDay: 1,
    defaultExpenseAccountId: null,
  },
};

/** Renderuje ekran w kontekście sesji i routera. */
function renderLogin(): void {
  const Wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    // Router jest potrzebny, bo po udanym logowaniu ekran przekierowuje dalej.
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>{children}</AuthProvider>
    </MemoryRouter>
  );
  render(<LoginScreen />, { wrapper: Wrapper });
}

/**
 * Wpisuje PIN, dotykając klawiszy.
 *
 * @param user - Sterownik zdarzeń.
 * @param digits - Cyfry do wpisania.
 */
async function typePin(user: ReturnType<typeof userEvent.setup>, digits: string): Promise<void> {
  for (const digit of digits) {
    await user.click(screen.getByRole('button', { name: digit }));
  }
}

beforeEach(() => {
  window.localStorage.clear();
  // Odtworzenie sesji na starcie: domyślnie nikt nie jest zalogowany.
  vi.spyOn(authApi, 'refresh').mockRejectedValue(
    new ApiRequestError('UNAUTHORIZED', 'Sesja wygasła.', 401, 'req'),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginScreen', () => {
  it('bez zapamiętanego adresu zaczyna od pola e-mail', async () => {
    renderLogin();

    expect(await screen.findByLabelText('Adres e-mail')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument();
  });

  it('z zapamiętanym adresem pokazuje od razu klawiaturę PIN', async () => {
    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, EMAIL);
    renderLogin();

    expect(await screen.findByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EMAIL })).toBeInTheDocument();
  });

  it('odrzuca adres bez małpy, zanim cokolwiek wyśle', async () => {
    const user = userEvent.setup();
    const login = vi.spyOn(authApi, 'login');
    renderLogin();

    await user.type(await screen.findByLabelText('Adres e-mail'), 'bez-malpy');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nieprawidłowy adres e-mail');
    expect(login).not.toHaveBeenCalled();
  });

  it('po wpisaniu kompletu cyfr loguje automatycznie', async () => {
    const user = userEvent.setup();
    const login = vi.spyOn(authApi, 'login').mockResolvedValue(SESSION);
    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, EMAIL);
    renderLogin();
    await screen.findByRole('button', { name: '1' });

    await typePin(user, PIN);

    // Nie ma przycisku „Zaloguj" — komplet cyfr startuje logowanie sam (06 §3.13).
    await waitFor(() => {
      expect(login).toHaveBeenCalledWith(expect.objectContaining({ email: EMAIL, pin: PIN }));
    });
  });

  it('kropki pokazują postęp, nigdy cyfry', async () => {
    const user = userEvent.setup();
    vi.spyOn(authApi, 'login').mockResolvedValue(SESSION);
    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, EMAIL);
    renderLogin();
    await screen.findByRole('button', { name: '1' });

    await typePin(user, '483');

    expect(screen.getByRole('status')).toHaveAccessibleName('Wpisano 3 z 6 cyfr');
    // Wpisanych cyfr nie widać nigdzie na ekranie.
    expect(document.body.textContent).not.toContain('483');
  });

  it('błędny PIN pokazuje komunikat z serwera i czyści wpisane cyfry', async () => {
    const user = userEvent.setup();
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new ApiRequestError('UNAUTHORIZED', 'Nieprawidłowy e-mail lub PIN.', 401, 'req'),
    );
    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, EMAIL);
    renderLogin();
    await screen.findByRole('button', { name: '1' });

    await typePin(user, PIN);

    expect(await screen.findByRole('alert')).toHaveTextContent('Nieprawidłowy e-mail lub PIN.');
    // Zostawienie cyfr zachęcałoby do „poprawiania" jednej z nich, a każda próba
    // kosztuje jedną z pięciu (09 §2.5).
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveAccessibleName('Wpisano 0 z 6 cyfr');
    });
  });

  it('komunikat o blokadzie przechodzi z serwera bez zmian', async () => {
    const user = userEvent.setup();
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new ApiRequestError(
        'RATE_LIMITED',
        'Zbyt wiele prób logowania. Spróbuj ponownie za 15 minut.',
        429,
        'req',
      ),
    );
    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, EMAIL);
    renderLogin();
    await screen.findByRole('button', { name: '1' });

    await typePin(user, PIN);

    expect(await screen.findByRole('alert')).toHaveTextContent('za 15 minut');
  });

  it('zapamiętuje adres po udanym logowaniu — pole jest domyślnie zaznaczone', async () => {
    const user = userEvent.setup();
    vi.spyOn(authApi, 'login').mockResolvedValue(SESSION);
    renderLogin();

    await user.type(await screen.findByLabelText('Adres e-mail'), EMAIL);
    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    expect(screen.getByRole('checkbox')).toBeChecked();
    await typePin(user, PIN);

    await waitFor(() => {
      expect(window.localStorage.getItem(REMEMBERED_EMAIL_KEY)).toBe(EMAIL);
    });
  });

  it('nie zapamiętuje adresu, gdy pole jest odznaczone', async () => {
    const user = userEvent.setup();
    vi.spyOn(authApi, 'login').mockResolvedValue(SESSION);
    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, EMAIL);
    renderLogin();
    await screen.findByRole('button', { name: '1' });

    await user.click(screen.getByRole('checkbox'));
    await typePin(user, PIN);

    await waitFor(() => {
      expect(window.localStorage.getItem(REMEMBERED_EMAIL_KEY)).toBeNull();
    });
  });

  it('PIN nie trafia do pamięci lokalnej', async () => {
    const user = userEvent.setup();
    vi.spyOn(authApi, 'login').mockResolvedValue(SESSION);
    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, EMAIL);
    renderLogin();
    await screen.findByRole('button', { name: '1' });

    await typePin(user, PIN);

    await waitFor(() => {
      expect(JSON.stringify(window.localStorage)).not.toContain(PIN);
      expect(JSON.stringify(window.localStorage)).not.toContain('token');
    });
  });

  it('niedostępne localStorage nie wywraca ekranu', async () => {
    // Tryb prywatny albo zablokowane dane witryny: sam odczyt rzuca wyjątkiem.
    // To jedyna droga do aplikacji — nie może się na tym wywrócić.
    const storage = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('brak dostępu');
    });
    renderLogin();

    expect(await screen.findByLabelText('Adres e-mail')).toBeInTheDocument();
    storage.mockRestore();
  });

  it('dotknięcie adresu pozwala go poprawić', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, EMAIL);
    renderLogin();

    await user.click(await screen.findByRole('button', { name: EMAIL }));

    expect(screen.getByLabelText('Adres e-mail')).toHaveValue(EMAIL);
  });

  it('klawiatura PIN nie ma klawisza dodatkowego', async () => {
    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, EMAIL);
    renderLogin();
    await screen.findByRole('button', { name: '1' });

    // Cyfry, zero i cofanie — bez przecinka, który należy do kwoty (06 §3.13).
    expect(screen.queryByRole('button', { name: 'Przecinek' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usuń ostatnią cyfrę' })).toBeInTheDocument();
  });

  it('cofanie usuwa ostatnią cyfrę', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, EMAIL);
    renderLogin();
    await screen.findByRole('button', { name: '1' });

    await typePin(user, '483');
    await user.click(screen.getByRole('button', { name: 'Usuń ostatnią cyfrę' }));

    expect(screen.getByRole('status')).toHaveAccessibleName('Wpisano 2 z 6 cyfr');
  });
});
