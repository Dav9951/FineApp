import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../lib/api-client.js';
import * as authApi from './api.js';
import { AuthProvider, useAuth } from './auth-context.js';

/**
 * Testy stanu sesji ([09 §3.1](../../../../../plans/09-security-auth.md#31-podział-ról)).
 *
 * Reguła, której pilnują: **access token nigdy nie trafia do pamięci przeglądarki**.
 * Po odświeżeniu strony jest odtwarzany z ciasteczka, więc dla użytkownika nic się
 * nie zmienia — ale dla napastnika z XSS-em różnica jest zasadnicza.
 */

/** Odpowiedź logowania w kształcie z kontraktu. */
const SESSION = {
  accessToken: 'token-abc',
  expiresIn: 900,
  user: {
    id: '01J9ZQK8WQ0000000000000000',
    email: 'adam@example.com',
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

/**
 * Sonda pokazująca stan kontekstu.
 *
 * @returns Element z widocznym stanem sesji.
 */
function Probe(): ReactNode {
  const { status, user, accessToken, signIn, signOut } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.displayName ?? '—'}</span>
      <span data-testid="token">{accessToken ?? '—'}</span>
      <button onClick={() => void signIn({ email: 'a@b.pl', pin: '483920' })} type="button">
        Zaloguj
      </button>
      <button onClick={() => void signOut()} type="button">
        Wyloguj
      </button>
    </div>
  );
}

/** Renderuje sondę w providerze. */
function renderProbe(): void {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AuthProvider', () => {
  it('na starcie próbuje odtworzyć sesję z ciasteczka', async () => {
    const refresh = vi.spyOn(authApi, 'refresh').mockResolvedValue(SESSION);
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByTestId('user')).toHaveTextContent('Adam');
  });

  it('401 przy odtwarzaniu to normalna odpowiedź, nie awaria', async () => {
    vi.spyOn(authApi, 'refresh').mockRejectedValue(
      new ApiRequestError('UNAUTHORIZED', 'Sesja wygasła.', 401, 'req'),
    );
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
  });

  it('logowanie ustawia sesję', async () => {
    const user = userEvent.setup();
    vi.spyOn(authApi, 'refresh').mockRejectedValue(
      new ApiRequestError('UNAUTHORIZED', 'Sesja wygasła.', 401, 'req'),
    );
    vi.spyOn(authApi, 'login').mockResolvedValue(SESSION);
    renderProbe();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });

    await user.click(screen.getByRole('button', { name: 'Zaloguj' }));

    await waitFor(() => {
      expect(screen.getByTestId('token')).toHaveTextContent('token-abc');
    });
  });

  it('token nie trafia do localStorage ani sessionStorage', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(SESSION);
    renderProbe();
    await waitFor(() => {
      expect(screen.getByTestId('token')).toHaveTextContent('token-abc');
    });

    expect(JSON.stringify(window.localStorage)).not.toContain('token-abc');
    expect(JSON.stringify(window.sessionStorage)).not.toContain('token-abc');
  });

  it('wylogowanie czyści sesję nawet wtedy, gdy serwer odmówił', async () => {
    const user = userEvent.setup();
    vi.spyOn(authApi, 'refresh').mockResolvedValue(SESSION);
    vi.spyOn(authApi, 'logout').mockRejectedValue(
      new ApiRequestError('INTERNAL_ERROR', 'Awaria.', 500, 'req'),
    );
    renderProbe();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });

    await user.click(screen.getByRole('button', { name: 'Wyloguj' }));

    // Sesja w przeglądarce ma zniknąć tak czy inaczej — inaczej użytkownik zostaje
    // zalogowany wbrew sobie.
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
    expect(screen.getByTestId('token')).toHaveTextContent('—');
  });

  it('odnawia token, zanim wygaśnie', async () => {
    vi.useFakeTimers();
    const refresh = vi
      .spyOn(authApi, 'refresh')
      .mockResolvedValueOnce(SESSION)
      .mockResolvedValue({ ...SESSION, accessToken: 'token-drugi' });
    renderProbe();

    await vi.waitFor(() => {
      expect(screen.getByTestId('token')).toHaveTextContent('token-abc');
    });

    // Token żyje 900 s, odnowienie ma pójść 60 s wcześniej — a nie po pierwszym 401.
    await vi.advanceTimersByTimeAsync(840 * 1000);

    await vi.waitFor(() => {
      expect(screen.getByTestId('token')).toHaveTextContent('token-drugi');
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('nieudane odnowienie wylogowuje', async () => {
    vi.useFakeTimers();
    vi.spyOn(authApi, 'refresh')
      .mockResolvedValueOnce(SESSION)
      .mockRejectedValue(new ApiRequestError('UNAUTHORIZED', 'Sesja wygasła.', 401, 'req'));
    renderProbe();
    await vi.waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });

    // Serwer mógł unieważnić wszystko po wykryciu ponownego użycia tokenu (09 §3.3).
    await vi.advanceTimersByTimeAsync(840 * 1000);

    await vi.waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
  });

  it('useAuth poza providerem mówi wprost, co jest nie tak', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Probe />)).toThrow(/<AuthProvider>/);

    quiet.mockRestore();
  });
});
