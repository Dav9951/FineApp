import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Sheet } from './sheet.js';

/**
 * Testy arkusza ([15 §4.6](../../../../../plans/15-design-system.md#46-sheet)).
 *
 * Najważniejsze jest zamykanie przyciskiem „wstecz": bez niego gest cofnięcia
 * — pierwszy odruch na telefonie — wyrzuca z aplikacji razem z wypełnionym formularzem.
 */

/**
 * Arkusz sterowany stanem, jak w prawdziwym użyciu.
 *
 * @param props - Właściwości pomocnicze.
 * @param props.children - Treść arkusza.
 * @returns Drzewo testowe.
 */
function ControlledSheet({ children }: { children?: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Otwórz
      </button>
      <Sheet onOpenChange={setOpen} open={open} title="Nowy wydatek">
        {children ?? <p>Treść arkusza</p>}
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('treść ma dolny odstęp także bez marginesu urządzenia (desktop)', async () => {
    const user = userEvent.setup();
    render(<ControlledSheet />);
    await user.click(screen.getByRole('button', { name: 'Otwórz' }));
    // `pb-safe-bottom` samo nadpisywało `p-4` i na desktopie dół był zerowy.
    const body = screen.getByText('Treść arkusza').parentElement;
    expect(body).toHaveClass('pb-[calc(1rem+env(safe-area-inset-bottom))]');
    expect(body).not.toHaveClass('pb-safe-bottom');
  });

  it('otwiera się i zamyka krzyżykiem', async () => {
    const user = userEvent.setup();
    render(<ControlledSheet />);

    await user.click(screen.getByRole('button', { name: 'Otwórz' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Nowy wydatek');

    await user.click(screen.getByRole('button', { name: 'Zamknij' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('zamyka się klawiszem Esc', async () => {
    const user = userEvent.setup();
    render(<ControlledSheet />);

    await user.click(screen.getByRole('button', { name: 'Otwórz' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('przycisk „wstecz" zamyka arkusz zamiast wychodzić z aplikacji', async () => {
    const user = userEvent.setup();
    render(<ControlledSheet />);

    await user.click(screen.getByRole('button', { name: 'Otwórz' }));
    // Otwarcie dokłada własny wpis do historii — inaczej „wstecz" cofałoby o ekran
    // za daleko, czyli wyrzucało z aplikacji razem z wypełnionym formularzem.
    expect(window.history.state).toMatchObject({ fineappSheet: true });

    window.history.back();

    // `popstate` przychodzi asynchronicznie i jeden takt zegara bywał za krótki.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('nowa funkcja `onOpenChange` przy każdym renderze nie rusza historii', async () => {
    const user = userEvent.setup();
    /**
     * Rodzic podający funkcję strzałkową i renderujący się przy otwartym arkuszu.
     *
     * @returns Drzewo testowe.
     */
    function InlineHandler(): ReactNode {
      const [open, setOpen] = useState(false);
      const [ticks, setTicks] = useState(0);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            Otwórz
          </button>
          <Sheet
            onOpenChange={(next) => {
              setOpen(next);
            }}
            open={open}
            title="Arkusz"
          >
            <button onClick={() => setTicks(ticks + 1)} type="button">
              Przerysuj {ticks}
            </button>
          </Sheet>
        </>
      );
    }
    render(<InlineHandler />);
    const push = vi.spyOn(window.history, 'pushState');
    const back = vi.spyOn(window.history, 'back');

    await user.click(screen.getByRole('button', { name: 'Otwórz' }));
    await user.click(screen.getByRole('button', { name: /Przerysuj/u }));
    await user.click(screen.getByRole('button', { name: /Przerysuj/u }));

    // Jeden wpis arkusza, bez cofania przy każdym renderze — i arkusz wciąż otwarty.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(push).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    push.mockRestore();
    back.mockRestore();
  });

  it('ma nazwę dla czytnika ekranu nawet bez osobnego opisu', async () => {
    const user = userEvent.setup();
    render(<ControlledSheet />);

    await user.click(screen.getByRole('button', { name: 'Otwórz' }));

    expect(screen.getByRole('dialog', { name: 'Nowy wydatek' })).toBeInTheDocument();
  });
});
