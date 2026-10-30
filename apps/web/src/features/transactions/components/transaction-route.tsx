import { currentMonthKey, TransactionTypeSchema } from '@fineapp/shared';
import { useEffect, useRef, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useAuth } from '../../auth/auth-context.js';
import { useTransactionSheet } from './transaction-sheet.js';

/**
 * Trasy `/t/new` i `/t/:id` — wejścia z zewnątrz do arkusza.
 *
 * Otwiera arkusz i podmienia adres na bieżący miesiąc: arkusz ma nad czym stać,
 * a „wstecz" po zamknięciu nie wraca do pustej trasy formularza.
 * `/t/new?type=income` otwiera od razu właściwą zakładkę.
 *
 * @returns Nic — trasa tylko przekierowuje.
 */
export default function TransactionRoute(): ReactNode {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { household } = useAuth();
  const { openNew, openEdit } = useTransactionSheet();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const month = currentMonthKey(household?.timezone ?? 'Europe/Warsaw');
    void navigate(`/m/${month}`, { replace: true });
    if (id === undefined) {
      const type = TransactionTypeSchema.safeParse(search.get('type'));
      openNew(type.success ? type.data : 'expense');
    } else {
      openEdit(id);
    }
  }, [household, id, navigate, openEdit, openNew, search]);

  return null;
}
