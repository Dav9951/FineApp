import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { vi } from 'vitest';

import * as authApi from '../src/features/auth/api.js';
import { AuthProvider } from '../src/features/auth/auth-context.js';

/**
 * Renderowanie ekranu z kompletem providerów: zapytania, sesja, router.
 *
 * Sesja jest odtwarzana tak jak w aplikacji — przez `refresh` na starcie — tyle że
 * odpowiedź podstawia atrapa. Ekrany widzą więc prawdziwy `useAuth()` z tokenem,
 * a nie jego podróbkę.
 */

/** Sesja testowa w kształcie z kontraktu. */
export const TEST_SESSION = {
  accessToken: 'token-testowy',
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
    defaultExpenseAccountId: null as string | null,
  },
};

/** Wyrenderowany ekran. */
export interface RenderedScreen {
  readonly router: ReturnType<typeof createMemoryRouter>;
  readonly queryClient: QueryClient;
}

/**
 * Renderuje trasy pod wskazanym adresem, z zalogowaną sesją.
 *
 * Klient zapytań bez ponowień: test błędu ma zobaczyć stan błędu od razu, a nie po
 * dwóch ukrytych próbach.
 *
 * @param path - Adres startowy.
 * @param routes - Trasy do zamontowania.
 * @param session - Sesja odtwarzana na starcie (np. z innymi ustawieniami gospodarstwa).
 * @returns Router i klient zapytań.
 */
export function renderScreen(
  path: string,
  routes: RouteObject[],
  session: typeof TEST_SESSION = TEST_SESSION,
): RenderedScreen {
  vi.spyOn(authApi, 'refresh').mockResolvedValue(session);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const Tree = (): ReactNode => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
  render(<Tree />);
  return { router, queryClient };
}
