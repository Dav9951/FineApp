import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';

/**
 * Wejście `/planned/:id` — przekierowanie na listę z otwartym arkuszem wydatku.
 *
 * Jak `/goals/:id` i `/recurring/:id` (ADR-048): arkusz sam dokłada wpis historii, żeby
 * „wstecz" go zamykał (15 §4.6), więc identyfikator jedzie w stanie nawigacji, a adres
 * wraca do `/planned`.
 *
 * @returns Element przekierowania.
 */
export default function PlannedRoute(): ReactNode {
  const { id } = useParams();
  return <Navigate replace state={{ plannedId: id }} to="/planned" />;
}
