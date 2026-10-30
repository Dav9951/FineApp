import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';

/**
 * Wejście `/recurring/:id` — przekierowanie na listę z otwartym arkuszem reguły.
 *
 * Arkusz sam dokłada wpis historii, żeby „wstecz" go zamykał (15 §4.6); adres szczegółów
 * jako osobny wpis ścigałby się z nim przy zamykaniu. Dlatego identyfikator jedzie
 * w stanie nawigacji, a adres wraca do `/recurring`.
 *
 * @returns Element przekierowania.
 */
export default function RecurringRoute(): ReactNode {
  const { id } = useParams();
  return <Navigate replace state={{ ruleId: id }} to="/recurring" />;
}
