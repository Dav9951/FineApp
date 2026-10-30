import { currentMonthKey } from '@fineapp/shared';
import { lazy, Suspense, type ReactNode } from 'react';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom';

import { AppShell } from '../components/layout/app-shell.js';
import { RequireSession } from '../features/auth/components/require-session.js';
import { ErrorBoundary } from './error-boundary.js';

/**
 * Trasy aplikacji, zgodnie z [06 §2](../../../../plans/06-ui-views.md#struktura-tras).
 *
 * Ekrany są na razie zaślepkami — `F0-8` buduje infrastrukturę, a treść dokładają
 * kolejne fazy. Trasy istnieją już teraz, bo to one ustalają kształt nawigacji
 * i pozwalają budować ekrany niezależnie od siebie.
 *
 * **Granica błędu jest na poziomie trasy**, nie całej aplikacji: awaria jednego ekranu
 * nie może wygasić pozostałych ([02 §10](../../../../plans/02-architecture.md)).
 */

/** Zaślepka ekranu — znika wraz z pierwszym prawdziwym widokiem danej trasy. */
const Placeholder = lazy(() => import('../components/layout/placeholder.js'));

/**
 * Przegląd prymitywów interfejsu.
 *
 * Ładowany leniwie, więc jest osobnym fragmentem paczki i nie obciąża pierwszego
 * wejścia — dlatego zostaje też w wersji produkcyjnej. Reguła „sprawdź, co już
 * istnieje" z `CLAUDE.md` odsyła do tej trasy, a odsyłacz do czegoś, czego nie ma
 * na wdrożonej aplikacji, jest wart tyle co nic.
 */
const UiGallery = lazy(() => import('../features/dev/ui-gallery.js'));

/** Ekran skanu — wybór źródła i ostatnie dokumenty (`F7-8`). */
const ScanScreen = lazy(() => import('../features/scan/components/scan-screen.js'));

/** Przegląd dokumentu — analiza, korekty, zatwierdzenie (`F7-8`, `F7-10`). */
const DocumentScreen = lazy(() => import('../features/scan/components/document-screen.js'));

/** Ekran kont (`F2-6`). */
const AccountsScreen = lazy(() => import('../features/accounts/components/accounts-screen.js'));

/** Szczegóły konta (`F2-6`). */
const AccountDetailScreen = lazy(
  () => import('../features/accounts/components/account-detail-screen.js'),
);

/** Wejścia z zewnątrz do arkusza transakcji (`F2-7`, ADR-037). */
const TransactionRoute = lazy(
  () => import('../features/transactions/components/transaction-route.js'),
);

/** Historia transakcji miesiąca (`F2-8`). */
const HistoryScreen = lazy(() => import('../features/transactions/components/history-screen.js'));

/** Ekran miesiąca — domyślny widok (`F3-4`). */
const MonthScreen = lazy(() => import('../features/months/components/month-screen.js'));

/** Rozbicie wydatków po kategoriach (`F3-2`). */
const MonthCategoriesScreen = lazy(
  () => import('../features/months/components/month-categories-screen.js'),
);

/** Ustawienia kategorii (`F2-9`). */
const CategoriesScreen = lazy(
  () => import('../features/categories/components/categories-screen.js'),
);

/** Zobowiązania (`F4-6`). */
const LiabilitiesScreen = lazy(
  () => import('../features/liabilities/components/liabilities-screen.js'),
);

/** Szczegóły zobowiązania (`F4-6`). */
const LiabilityDetailScreen = lazy(
  () => import('../features/liabilities/components/liability-detail-screen.js'),
);

/** Pozycje cykliczne (`F4-5`). */
const RecurringScreen = lazy(() => import('../features/recurring/components/recurring-screen.js'));

/** Wejście do reguły z adresu — lista z otwartym arkuszem (`F4-5`). */
const RecurringRoute = lazy(() => import('../features/recurring/components/recurring-route.js'));

/** Cele (`F5-5`). */
const GoalsScreen = lazy(() => import('../features/goals/components/goals-screen.js'));

/** Wejście do celu z adresu — lista z otwartym arkuszem (`F5-5`). */
const GoalsRoute = lazy(() => import('../features/goals/components/goals-route.js'));

/** Planowane wydatki (`F6-6`). */
const PlannedScreen = lazy(
  () => import('../features/planned-expenses/components/planned-screen.js'),
);

/** Wejście do wydatku z adresu — lista z otwartym arkuszem (`F6-6`). */
const PlannedRoute = lazy(() => import('../features/planned-expenses/components/planned-route.js'));

/** Planer budżetu — lista planów i szkic miesiąca (`F9-6`). */
const BudgetListScreen = lazy(() => import('../features/budget/components/budget-list-screen.js'));
const BudgetScreen = lazy(() => import('../features/budget/components/budget-screen.js'));

/** Rozkład docelowy (`F5-7`). */
const AllocationScreen = lazy(
  () => import('../features/allocation/components/allocation-screen.js'),
);

/** Wejście do podsekcji na telefonie (`F2-6`, ADR-036). */
const MoreScreen = lazy(() => import('../features/more/more-screen.js'));
const SettingsScreen = lazy(() => import('../features/settings/components/settings-screen.js'));
const IncomeSourcesScreen = lazy(
  () => import('../features/income-sources/components/income-sources-screen.js'),
);

/** Ekran logowania — jedyna trasa aplikacji dostępna bez sesji. */
const LoginScreen = lazy(() => import('../features/auth/components/login-screen.js'));

/**
 * Powłoka z granicą błędu wspólną dla tras potomnych.
 *
 * @returns Element trasy.
 */
function RouteShell(): ReactNode {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="p-6 text-muted-foreground">Ładowanie…</div>}>
        <Outlet />
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * Buduje definicje tras.
 *
 * @param timezone - Strefa gospodarstwa; potrzebna do wyznaczenia bieżącego miesiąca.
 * @returns Definicje tras dla React Router.
 */
export function routeDefinitions(timezone = 'Europe/Warsaw'): RouteObject[] {
  return [
    {
      path: '/',
      element: <RouteShell />,
      children: [
        // `/login` i `/dev/ui` stoją **poza** powłoką i poza bramą sesji: pierwsze
        // dlatego, że powłoka z nawigacją nie ma sensu, zanim jest gdzie nawigować,
        // drugie dlatego, że przegląd prymitywów ma pokazywać je same, bez otoczenia
        // ([06 §2](../../../../plans/06-ui-views.md#struktura-tras)).
        { path: 'login', element: <LoginScreen /> },
        { path: 'dev/ui', element: <UiGallery /> },
        {
          element: <RequireSession />,
          children: [
            {
              element: <AppShell />,
              children: [
                // Wejście na korzeń przenosi do bieżącego miesiąca — domyślnego widoku
                // aplikacji (wymaganie #12).
                {
                  index: true,
                  element: <Navigate to={`/m/${currentMonthKey(timezone)}`} replace />,
                },
                { path: 'm/:month', element: <MonthScreen /> },
                { path: 'm/:month/transactions', element: <HistoryScreen /> },
                { path: 'm/:month/categories', element: <MonthCategoriesScreen /> },
                { path: 't/new', element: <TransactionRoute /> },
                { path: 't/:id', element: <TransactionRoute /> },
                { path: 'goals', element: <GoalsScreen /> },
                { path: 'goals/:id', element: <GoalsRoute /> },
                { path: 'allocation', element: <AllocationScreen /> },
                { path: 'accounts', element: <AccountsScreen /> },
                { path: 'accounts/:id', element: <AccountDetailScreen /> },
                { path: 'liabilities', element: <LiabilitiesScreen /> },
                { path: 'liabilities/:id', element: <LiabilityDetailScreen /> },
                { path: 'recurring', element: <RecurringScreen /> },
                { path: 'recurring/:id', element: <RecurringRoute /> },
                { path: 'planned', element: <PlannedScreen /> },
                { path: 'planned/:id', element: <PlannedRoute /> },
                { path: 'budget', element: <BudgetListScreen /> },
                { path: 'budget/:month', element: <BudgetScreen /> },
                { path: 'scan', element: <ScanScreen /> },
                { path: 'scan/:documentId', element: <DocumentScreen /> },
                { path: 'more', element: <MoreScreen /> },
                { path: 'settings', element: <SettingsScreen /> },
                { path: 'settings/income-sources', element: <IncomeSourcesScreen /> },
                { path: 'settings/categories', element: <CategoriesScreen /> },
                { path: '*', element: <Placeholder title="Nie znaleziono strony" /> },
              ],
            },
          ],
        },
      ],
    },
  ];
}

/**
 * Router aplikacji.
 *
 * @returns Element z routerem.
 */
export function AppRouter(): ReactNode {
  return <RouterProvider router={createBrowserRouter(routeDefinitions())} />;
}
