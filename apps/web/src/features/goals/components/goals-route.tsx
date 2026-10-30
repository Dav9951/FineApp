import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';

/**
 * Wejście `/goals/:id` — przekierowanie na listę z otwartym arkuszem celu.
 *
 * Jak `/recurring/:id` (ADR-048): arkusz sam dokłada wpis historii, żeby „wstecz" go
 * zamykał (15 §4.6), więc identyfikator jedzie w stanie nawigacji, a adres wraca do `/goals`.
 *
 * @returns Element przekierowania.
 */
export default function GoalsRoute(): ReactNode {
  const { id } = useParams();
  return <Navigate replace state={{ goalId: id }} to="/goals" />;
}
