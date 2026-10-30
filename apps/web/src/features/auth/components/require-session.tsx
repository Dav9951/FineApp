import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { SkeletonList } from '../../../components/ui/skeleton.js';
import { useAuth } from '../auth-context.js';

/**
 * Brama tras chronionych ([09 §4](../../../../../../plans/09-security-auth.md#4-autoryzacja)).
 *
 * Trzy stany sesji, trzy różne zachowania — i to jest cała trudność tego komponentu:
 *
 * - `checking` — **nie przekierowujemy**. Odtworzenie sesji z ciasteczka trwa jedno
 *   żądanie; wyrzucenie w tym czasie na `/login` mignęłoby ekranem logowania przy
 *   każdym odświeżeniu strony, także osobie zalogowanej.
 * - `anonymous` — przekierowanie na `/login` **z zapamiętaniem miejsca**, żeby po
 *   zalogowaniu wrócić tam, gdzie się szło, a nie na ekran startowy.
 * - `authenticated` — treść.
 */

/**
 * Wpuszcza dalej tylko zalogowanych.
 *
 * @returns Element trasy.
 */
export function RequireSession(): ReactNode {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    // Szkielet o kształcie treści, nie spinner (15 §4.9). Tutaj nie wiemy jeszcze,
    // jaki ekran się pojawi, więc szkielet jest listą — najczęstszym kształtem.
    return (
      <div className="mx-auto w-full max-w-content px-4 py-6">
        <SkeletonList rows={4} />
      </div>
    );
  }

  if (status === 'anonymous') {
    return <Navigate replace state={{ from: location.pathname + location.search }} to="/login" />;
  }

  return <Outlet />;
}
