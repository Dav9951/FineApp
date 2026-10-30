import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { AuthProvider } from '../features/auth/auth-context.js';

/**
 * Providery aplikacji.
 *
 * TanStack Query jest **jedynym** źródłem stanu serwerowego — bez Reduxa ani Zustanda
 * dla danych z API ([02 §10](../../../../plans/02-architecture.md#10-frontend--wzorce)).
 * Lokalny stan UI trzyma `useState`, a stan nawigacyjny — parametr adresu.
 */

/**
 * Tworzy klienta zapytań z ustawieniami dopasowanymi do aplikacji finansowej.
 *
 * @returns Nowy klient zapytań.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Dane finansowe zmieniają się rzadko, ale dwie osoby mogą pisać równolegle.
        // Minuta to kompromis: nie odpytujemy przy każdym przełączeniu zakładki,
        // a zmiana drugiej osoby pojawia się bez odświeżania strony.
        staleTime: 60_000,
        // Błędu walidacji ani braku uprawnień nie ma sensu ponawiać — tylko awarie sieci.
        retry: (failureCount, error) => {
          const status = (error as { status?: number }).status;
          if (typeof status === 'number' && status < 500) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: true,
      },
      mutations: {
        // Ponowienie mutacji bez klucza idempotencji groziłoby podwójnym księgowaniem.
        retry: false,
      },
    },
  });
}

/**
 * Opakowuje aplikację w providery.
 *
 * @param props - Właściwości komponentu.
 * @param props.children - Drzewo aplikacji.
 * @returns Drzewo z providerami.
 */
export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  // Klient w stanie, nie w module: inaczej testy i odświeżenie w trybie deweloperskim
  // dzieliłyby jedną pamięć podręczną między niezależnymi drzewami.
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      {/* Sesja **wewnątrz** klienta zapytań: odnowienie tokenu unieważnia pamięć
          podręczną, a nie odwrotnie. */}
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
