import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Granica błędu.
 *
 * Zakładana **na poziomie trasy, nie całej aplikacji**
 * ([02 §10](../../../../plans/02-architecture.md#10-frontend--wzorce)): awaria widżetu
 * celów nie może wygasić całego ekranu miesiąca, bo wtedy użytkownik traci też dostęp
 * do danych, które są poprawne.
 */

/** Właściwości granicy błędu. */
interface ErrorBoundaryProps {
  children: ReactNode;
  /** Co pokazać zamiast zawartości, gdy poddrzewo się wywróci. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

/** Stan granicy błędu. */
interface ErrorBoundaryState {
  error: Error | null;
}

/** Granica błędu dla poddrzewa React. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  /**
   * Zapamiętuje błąd, żeby przy kolejnym renderze pokazać zastępczą treść.
   *
   * @param error - Przechwycony błąd.
   * @returns Nowy stan.
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  /**
   * Zgłasza błąd do konsoli przeglądarki.
   *
   * Nie wysyłamy go nigdzie na zewnątrz — `09 §8` zabrania telemetrii i raportowania
   * błędów poza aplikację.
   *
   * @param error - Przechwycony błąd.
   * @param info - Informacja o miejscu w drzewie komponentów.
   */
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Błąd w poddrzewie:', error, info.componentStack);
  }

  /**
   * Czyści błąd i próbuje wyrenderować poddrzewo ponownie.
   */
  reset = (): void => {
    this.setState({ error: null });
  };

  /**
   * @returns Zawartość albo treść zastępczą.
   */
  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div role="alert" className="p-6 text-foreground">
        <p className="text-lg">Coś poszło nie tak.</p>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          type="button"
          onClick={this.reset}
          className="mt-4 min-h-touch rounded-lg bg-primary px-4 text-primary-foreground"
        >
          Spróbuj ponownie
        </button>
      </div>
    );
  }
}
