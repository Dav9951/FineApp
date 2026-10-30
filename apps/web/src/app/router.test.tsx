import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../lib/api-client.js';
import * as authApi from '../features/auth/api.js';
import * as transactionsApi from '../features/transactions/api.js';
import { AuthProvider } from '../features/auth/auth-context.js';
import { routeDefinitions } from './router.js';

/**
 * Testy tras chronionych ([09 §4](../../../../plans/09-security-auth.md#4-autoryzacja)).
 *
 * Reguła: do aplikacji nie wchodzi się bez sesji. Najłatwiej ją złamać **nie** przez
 * brak bramy, tylko przez jej zbyt gorliwe działanie — przekierowanie w trakcie
 * sprawdzania sesji mignęłoby ekranem logowania osobie zalogowanej przy każdym `F5`.
 */

/** Sesja w kształcie z kontraktu. */
const SESSION = {
  accessToken: 'token',
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
 * Renderuje aplikację pod wskazanym adresem.
 *
 * @param path - Adres startowy.
 * @returns Router, żeby dało się odczytać bieżącą ścieżkę.
 */
function renderAt(path: string): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(routeDefinitions('Europe/Warsaw'), {
    initialEntries: [path],
  });
  // Klient zapytań jak w `providers.tsx` — ekrany z danymi (od `F2-6`) bez niego nie wstaną.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Tree = (): ReactNode => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
  render(<Tree />);
  return router;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('trasy chronione', () => {
  it('bez sesji przekierowują na logowanie i pamiętają, dokąd się szło', async () => {
    vi.spyOn(authApi, 'refresh').mockRejectedValue(
      new ApiRequestError('UNAUTHORIZED', 'Sesja wygasła.', 401, 'req'),
    );

    const router = renderAt('/goals');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    // Bez tego po zalogowaniu wracałoby się na ekran startowy, a nie tam,
    // gdzie użytkownik faktycznie szedł.
    expect(router.state.location.state).toMatchObject({ from: '/goals' });
  });

  it('w trakcie sprawdzania sesji NIE migają ekranem logowania', async () => {
    // Odtworzenie sesji trwa jedno żądanie. Przekierowanie w tym czasie pokazywałoby
    // logowanie przy każdym odświeżeniu strony, także osobie zalogowanej.
    let settle: (value: typeof SESSION) => void = () => undefined;
    vi.spyOn(authApi, 'refresh').mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    const router = renderAt('/goals');

    expect(router.state.location.pathname).toBe('/goals');
    expect(screen.queryByLabelText('Adres e-mail')).not.toBeInTheDocument();

    settle(SESSION);
    await waitFor(() => {
      // Pasek zakładek i pasek boczny stoją oba w drzewie; o tym, który widać,
      // decyduje punkt przełamania w CSS.
      expect(screen.getAllByRole('navigation', { name: 'Nawigacja główna' })).toHaveLength(2);
    });
  });

  it('z sesją pokazują powłokę z nawigacją', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(SESSION);

    renderAt('/goals');

    const navs = await screen.findAllByRole('navigation', { name: 'Nawigacja główna' });
    // Pasek zakładek i pasek boczny stoją oba w drzewie; o tym, który widać,
    // decyduje punkt przełamania w CSS.
    expect(navs).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: /Miesiąc/ }).length).toBeGreaterThan(0);
  });

  it('korzeń przenosi do bieżącego miesiąca', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(SESSION);

    const router = renderAt('/');

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/m\/\d{4}-\d{2}$/);
    });
  });

  it('logowanie stoi poza powłoką — bez nawigacji i bez FAB-a', async () => {
    vi.spyOn(authApi, 'refresh').mockRejectedValue(
      new ApiRequestError('UNAUTHORIZED', 'Sesja wygasła.', 401, 'req'),
    );

    renderAt('/login');

    expect(await screen.findByLabelText('Adres e-mail')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dodaj transakcję' })).not.toBeInTheDocument();
  });

  it('nieznana ścieżka pod sesją daje ekran „nie znaleziono", nie przekierowanie', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(SESSION);

    const router = renderAt('/nie-ma-takiej');

    await waitFor(() => {
      expect(screen.getByText(/Nie znaleziono strony/)).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe('/nie-ma-takiej');
  });

  it('dokładnie jedna pozycja nawigacji jest bieżąca', async () => {
    // Regresja: własne dopasowanie ścieżki obok dopasowania `NavLink` rozjeżdżało się
    // z nim i `aria-current="page"` lądowało na dwóch pozycjach naraz — czytnik ekranu
    // zapowiadał dwie „bieżące" strony.
    vi.spyOn(authApi, 'refresh').mockResolvedValue(SESSION);
    vi.spyOn(transactionsApi, 'fetchTransactionPage').mockResolvedValue({
      data: [],
      meta: { nextCursor: null, hasMore: false },
    });

    renderAt('/m/2026-09/transactions');

    await screen.findAllByRole('navigation', { name: 'Nawigacja główna' });
    const current = [
      ...new Set(
        screen
          .getAllByRole('link')
          .filter((link) => link.getAttribute('aria-current') === 'page')
          .map((link) => link.textContent?.trim()),
      ),
    ];
    expect(current).toEqual(['Historia']);
  });

  it('nawigacja prowadzi do oglądanego miesiąca, nie zawsze do bieżącego', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(SESSION);

    renderAt('/m/2024-03');

    const history = await screen.findAllByRole('link', { name: /Historia/ });
    expect(history[0]).toHaveAttribute('href', '/m/2024-03/transactions');
  });
});
