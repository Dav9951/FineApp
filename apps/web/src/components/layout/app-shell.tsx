import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';

import { currentMonthKey } from '@fineapp/shared';

import { Fab, FAB_CONTENT_PADDING } from '../ui/fab.js';
import { ToastProvider } from '../ui/toast.js';
import { useAuth } from '../../features/auth/auth-context.js';
import {
  TransactionSheetProvider,
  useTransactionSheet,
} from '../../features/transactions/components/transaction-sheet.js';
import { useAiEnabled } from '../../features/scan/hooks/use-documents.js';
import { cn } from '../../lib/cn.js';
import { BottomNav } from './bottom-nav.js';
import { OfflineBanner } from './offline-banner.js';
import { MORE_PATH, planningNav, primaryNav, settingsNav } from './nav-items.js';
import { Sidebar, useSidebarCollapsed } from './sidebar.js';

/**
 * Powłoka aplikacji ([06 §2](../../../../../plans/06-ui-views.md#2-nawigacja)).
 *
 * Do 768 px: treść plus dolny pasek zakładek i FAB. Od 768 px: lewy pasek boczny
 * 240 px (zwijany do szyny 64 px, ADR-067), treść wyśrodkowana do 1200 px, a FAB zostaje w prawym dolnym rogu. Wcześniej
 * zamieniał się w przycisk „Dodaj" w nagłówku, ale ten lądował tuż nad „+" ekranu
 * (np. „Nowy cel") — dwa plusy jeden nad drugim, każdy robiący co innego (ADR-058).
 */

/**
 * Wyznacza miesiąc do zbudowania odnośników nawigacji.
 *
 * Miesiąc jest w adresie ([06 §2](../../../../../plans/06-ui-views.md#struktura-tras)),
 * więc zakładka „Historia" ma prowadzić do historii **oglądanego** miesiąca, a nie
 * zawsze bieżącego. Poza trasami miesięcznymi wracamy do miesiąca bieżącego.
 *
 * @param timezone - Strefa gospodarstwa.
 * @param month - Miesiąc z adresu, o ile trasa go niesie.
 * @returns Klucz miesiąca.
 */
function shellMonth(timezone: string, month: string | undefined): string {
  return month ?? currentMonthKey(timezone);
}

/**
 * Powłoka z nawigacją wokół treści trasy.
 *
 * Arkusz formularza transakcji jest stanem powłoki (`TransactionSheetProvider`), więc
 * FAB otwiera go nad bieżącym ekranem, bez zmiany trasy (ADR-037).
 * Toast też jest stanem powłoki: musi przetrwać zamknięcie arkusza, który go wywołał.
 *
 * @returns Element powłoki.
 */
export function AppShell(): ReactNode {
  return (
    <ToastProvider>
      <TransactionSheetProvider>
        <ShellLayout />
      </TransactionSheetProvider>
    </ToastProvider>
  );
}

/**
 * Układ powłoki: pasek boczny, treść, pasek zakładek, FAB.
 *
 * @returns Element układu.
 */
function ShellLayout(): ReactNode {
  const { household } = useAuth();
  const { month } = useParams();
  const navigate = useNavigate();
  const { openNew } = useTransactionSheet();
  const sidebar = useSidebarCollapsed();

  const activeMonth = shellMonth(household?.timezone ?? 'Europe/Warsaw', month);
  const aiEnabled = useAiEnabled();
  const primary = primaryNav(activeMonth, aiEnabled);

  /** Otwiera formularz nowego wydatku — najczęstsza czynność w aplikacji. */
  const addTransaction = (): void => {
    openNew('expense');
  };

  return (
    <div className={cn('min-h-dvh', sidebar.collapsed ? 'md:pl-[76px]' : 'md:pl-[248px]')}>
      <OfflineBanner />
      <Sidebar
        collapsed={sidebar.collapsed}
        onToggleCollapsed={sidebar.toggle}
        planning={planningNav()}
        primary={primary.filter((item) => item.to !== MORE_PATH)}
        settings={settingsNav()}
      />

      {/* `overflow-x-clip`: treść szersza niż ekran (choćby jeden za szeroki element)
          poszerza na Androidzie obszar układu, a FAB i pasek zakładek są przypięte do
          niego — FAB lądował za prawą krawędzią. `clip`, nie `hidden`: nie tworzy
          kontenera przewijania, więc `sticky` w treści działa dalej. `relative`, bo
          przycinanie obejmuje tylko elementy pozycjonowane względem kontenera — tekst
          `sr-only` (absolutny) bez pozycjonowanego przodka uciekał spod `clip` (ADR-074). */}
      <div
        className={cn(
          'relative mx-auto w-full max-w-content overflow-x-clip px-4 py-4 md:px-6',
          FAB_CONTENT_PADDING,
          // Bez paska zakładek: 24 px od krawędzi + 56 px FAB + zapas na ostatni wiersz.
          'md:pb-28',
        )}
      >
        <Outlet />
      </div>

      <BottomNav items={primary} />

      <Fab
        actions={[
          { label: 'Wydatek', onSelect: addTransaction },
          {
            label: 'Przychód',
            onSelect: () => {
              openNew('income');
            },
          },
          {
            label: 'Przelew',
            onSelect: () => {
              openNew('transfer');
            },
          },
          ...(aiEnabled
            ? [
                {
                  label: 'Paragon',
                  onSelect: () => {
                    void navigate('/scan');
                  },
                },
              ]
            : []),
        ]}
        label="Dodaj transakcję"
        onClick={addTransaction}
      >
        <Plus aria-hidden="true" className="h-[26px] w-[26px]" strokeWidth={1.5} />
      </Fab>
    </div>
  );
}
