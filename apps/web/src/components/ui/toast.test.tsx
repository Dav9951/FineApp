import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TOAST_DURATION_MS, ToastProvider, useToast, type ToastOptions } from './toast.js';

/**
 * Testy toastu ([15 §4.10](../../../../../plans/15-design-system.md#410-pozostałe)):
 * 4 s na ekranie, akcja zamyka, wskaźnik na toaście wstrzymuje odliczanie.
 */

/**
 * Przycisk pokazujący toast.
 *
 * @param props - Właściwości pomocnicze.
 * @param props.options - Treść toastu.
 * @returns Element przycisku.
 */
function Trigger({ options }: { options: ToastOptions }): ReactNode {
  const { show } = useToast();
  return (
    <button
      onClick={() => {
        show(options);
      }}
      type="button"
    >
      Pokaż
    </button>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('znika po 4 s; region „status" jest w drzewie przed treścią', () => {
    render(
      <ToastProvider>
        <Trigger options={{ message: 'Zapisano' }} />
      </ToastProvider>,
    );
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż' }));
    expect(screen.getByRole('status')).toHaveTextContent('Zapisano');
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(screen.getByText('Zapisano')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Zapisano')).not.toBeInTheDocument();
  });

  it('akcja wykonuje się raz i zamyka toast', () => {
    const onAction = vi.fn();
    render(
      <ToastProvider>
        <Trigger options={{ message: 'Usunięto', action: { label: 'Cofnij', onAction } }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Usunięto')).not.toBeInTheDocument();
  });

  it('wskaźnik na toaście wstrzymuje odliczanie, zejście wznawia je od nowa', () => {
    render(
      <ToastProvider>
        <Trigger options={{ message: 'Usunięto' }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż' }));
    const toast = screen.getByText('Usunięto');
    fireEvent.pointerEnter(toast);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 3);
    });
    expect(screen.getByText('Usunięto')).toBeInTheDocument();
    fireEvent.pointerLeave(toast);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(screen.queryByText('Usunięto')).not.toBeInTheDocument();
  });

  it('nowy toast zastępuje poprzedni', () => {
    render(
      <ToastProvider>
        <Trigger options={{ message: 'Pierwszy' }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż' }));
    expect(screen.getAllByText('Pierwszy')).toHaveLength(1);
  });

  it('poza providerem — czytelny błąd', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger options={{ message: 'x' }} />)).toThrow(/ToastProvider/u);
  });
});
