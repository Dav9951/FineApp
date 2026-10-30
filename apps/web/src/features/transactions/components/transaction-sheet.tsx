import type { TransactionType } from '@fineapp/shared';
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';

import type { TransactionPreset } from '../transaction-form-state.js';
import type * as SheetViewModule from './transaction-sheet-view.js';

/**
 * Pobiera moduł arkusza — leniwie, poza ścieżką krytyczną (ADR-037).
 *
 * @returns Moduł z komponentem arkusza.
 */
function loadSheetView(): Promise<typeof SheetViewModule> {
  return import('./transaction-sheet-view.js');
}
const TransactionSheetView = lazy(loadSheetView);

/**
 * Arkusz formularza transakcji nad bieżącym ekranem
 * ([06 §3.3](../../../../../../plans/06-ui-views.md#33-formularz-transakcji--tnew-tid)).
 *
 * Arkusz jest **stanem powłoki**, nie osobną trasą: otwiera się nad tym, co użytkownik
 * ogląda, i nie zabiera mu kontekstu. Trasy `/t/new` i `/t/:id` zostają jako wejścia
 * z zewnątrz (link, zakładka) — otwierają arkusz nad ekranem miesiąca (ADR-037).
 */

/** Sterowanie arkuszem transakcji. */
export interface TransactionSheetControls {
  /** Otwiera formularz nowej transakcji danego typu, opcjonalnie z wartościami z góry. */
  openNew: (type?: TransactionType, preset?: TransactionPreset) => void;
  /** Otwiera formularz edycji transakcji. */
  openEdit: (transactionId: string) => void;
}

/** Opóźnienie pobrania formularza po starcie — po pierwszym renderze ekranu. */
const PREFETCH_DELAY_MS = 1500;

const TransactionSheetContext = createContext<TransactionSheetControls | undefined>(undefined);

/**
 * Sterowanie arkuszem transakcji.
 *
 * @returns Funkcje otwierające arkusz.
 * @throws {Error} Poza {@link TransactionSheetProvider}.
 */
export function useTransactionSheet(): TransactionSheetControls {
  const value = useContext(TransactionSheetContext);
  if (value === undefined) {
    throw new Error('useTransactionSheet: komponent musi być wewnątrz <TransactionSheetProvider>');
  }
  return value;
}

/**
 * Provider arkusza — montowany w powłoce aplikacji, więc arkusz otwiera się nad każdym
 * ekranem.
 *
 * @param props - Właściwości komponentu.
 * @param props.children - Treść powłoki.
 * @returns Drzewo z arkuszem.
 */
export function TransactionSheetProvider({ children }: { children: ReactNode }): ReactNode {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Ostatnie żądanie zostaje po zamknięciu, żeby treść nie znikała w trakcie animacji.
  const [request, setRequest] = useState<SheetViewModule.SheetRequest | null>(null);
  const [newType, setNewType] = useState<TransactionType>('expense');
  const nextKey = useRef(0);

  const openNew = useCallback((type: TransactionType = 'expense', preset?: TransactionPreset) => {
    nextKey.current += 1;
    setNewType(type);
    setRequest(
      preset === undefined
        ? { key: nextKey.current, type }
        : { key: nextKey.current, type, preset },
    );
    setOpen(true);
  }, []);

  const openEdit = useCallback((transactionId: string) => {
    nextKey.current += 1;
    setRequest({ key: nextKey.current, transactionId });
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  /**
   * Zamyka arkusz i dopiero potem przechodzi do kont.
   *
   * Zamknięcie cofa wpis historii dodany przez arkusz (`history.back()`, 15 §4.6).
   * Przejście wykonane w tej samej chwili zostałoby tym cofnięciem odwołane — więc
   * czekamy na `popstate`.
   */
  const manageAccounts = useCallback(() => {
    window.addEventListener(
      'popstate',
      () => {
        void navigate('/accounts');
      },
      { once: true },
    );
    setOpen(false);
  }, [navigate]);

  // Formularz pobieramy w wolnej chwili po starcie: ekran startowy go nie potrzebuje,
  // a pierwsze dotknięcie FAB-a nie może czekać na sieć.
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSheetView();
    }, PREFETCH_DELAY_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, []);

  const controls = useMemo(() => ({ openNew, openEdit }), [openNew, openEdit]);

  return (
    <TransactionSheetContext.Provider value={controls}>
      {children}
      {request === null ? null : (
        <Suspense fallback={null}>
          <TransactionSheetView
            newType={newType}
            onDone={close}
            onManageAccounts={manageAccounts}
            onOpenChange={setOpen}
            onTypeChange={setNewType}
            open={open}
            request={request}
          />
        </Suspense>
      )}
    </TransactionSheetContext.Provider>
  );
}
