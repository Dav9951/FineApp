import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './error-boundary.js';

/**
 * Testy granicy błędu — w tym odzyskiwania po wdrożeniu nowej wersji (ADR-090).
 */

/**
 * Komponent, który rzuca przy renderze.
 *
 * @param props - Właściwości.
 * @param props.message - Komunikat błędu.
 */
function Boom({ message }: { message: string }): never {
  throw new TypeError(message);
}

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('ErrorBoundary', () => {
  it('zwykły błąd pokazuje ekran błędu', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom message="Cannot read properties of undefined" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Coś poszło nie tak.');
  });

  it('brak pliku ekranu po wdrożeniu przeładowuje stronę zamiast pokazać błąd', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom message="Failed to fetch dynamically imported module: https://x/assets/a-1.js" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Wczytywanie nowej wersji');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(window.sessionStorage.getItem('fineapp:stale-chunk-reload-at')).not.toBeNull();
  });

  it('gdy przeładowanie było przed chwilą, pokazuje ekran błędu (bez pętli)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.sessionStorage.setItem('fineapp:stale-chunk-reload-at', String(Date.now()));
    render(
      <ErrorBoundary>
        <Boom message="Failed to fetch dynamically imported module: https://x/assets/a-1.js" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Coś poszło nie tak.');
  });
});
