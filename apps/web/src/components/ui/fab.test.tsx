import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Fab } from './fab.js';

/**
 * Testy przycisku akcji głównej
 * ([15 §4.4](../../../../../plans/15-design-system.md#44-fab)).
 *
 * Reguła, której nie wolno złamać: FAB **nie zachodzi na pasek zakładek**. Nachodząc,
 * zasłaniałby „Więcej", czyli odbierał dostęp do Kont, Zobowiązań i Ustawień.
 */

describe('Fab', () => {
  it('liczy pozycję od paska zakładek, a nie od dołu ekranu', () => {
    render(
      <Fab label="Dodaj transakcję" onClick={vi.fn()}>
        <svg />
      </Fab>,
    );

    const wrapper = screen.getByRole('button', { name: 'Dodaj transakcję' }).parentElement;
    expect(wrapper?.className).toContain('spacing.tabbar');
    expect(wrapper?.className).toContain('safe-area-inset-bottom');
  });

  it('dotknięcie wywołuje akcję kontekstową', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Fab label="Dodaj transakcję" onClick={onClick}>
        <svg />
      </Fab>,
    );

    await user.click(screen.getByRole('button', { name: 'Dodaj transakcję' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('przytrzymanie otwiera menu i nie wywołuje akcji kontekstowej', () => {
    // `fireEvent`, nie `userEvent`: przytrzymanie mierzy czas, a `userEvent`
    // z podmienionym zegarem zawiesza się na własnym opóźnieniu.
    vi.useFakeTimers();
    const onClick = vi.fn();
    const onSelect = vi.fn();
    render(
      <Fab actions={[{ label: 'Paragon', onSelect }]} label="Dodaj transakcję" onClick={onClick}>
        <svg />
      </Fab>,
    );

    const fab = screen.getByRole('button', { name: 'Dodaj transakcję' });
    fireEvent.pointerDown(fab);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    fireEvent.pointerUp(fab);
    fireEvent.click(fab);

    expect(screen.getByRole('button', { name: 'Paragon' })).toBeInTheDocument();
    // Jedno przytrzymanie nie może dać dwóch skutków naraz.
    expect(onClick).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('wybór z menu wywołuje akcję i zamyka menu', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(
      <Fab actions={[{ label: 'Paragon', onSelect }]} label="Dodaj" onClick={vi.fn()}>
        <svg />
      </Fab>,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Dodaj' }));
    act(() => {
      vi.advanceTimersByTime(600);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Paragon' }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Paragon' })).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('bez menu przytrzymanie zachowuje się jak zwykłe dotknięcie', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(
      <Fab label="Dodaj transakcję" onClick={onClick}>
        <svg />
      </Fab>,
    );

    const fab = screen.getByRole('button', { name: 'Dodaj transakcję' });
    fireEvent.pointerDown(fab);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    fireEvent.pointerUp(fab);
    fireEvent.click(fab);

    expect(onClick).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('na desktopie stoi w prawym dolnym rogu, bez odstępu na pasek zakładek', () => {
    render(
      <Fab label="Dodaj transakcję" onClick={vi.fn()}>
        <svg />
      </Fab>,
    );
    const wrapper = screen.getByRole('button', { name: 'Dodaj transakcję' }).parentElement;
    expect(wrapper).toHaveClass('md:bottom-6', 'md:right-6');
  });

  it('prawy przycisk myszy otwiera menu szybkich akcji bez akcji kontekstowej', () => {
    const onClick = vi.fn();
    render(
      <Fab
        actions={[{ label: 'Paragon', onSelect: vi.fn() }]}
        label="Dodaj transakcję"
        onClick={onClick}
      >
        <svg />
      </Fab>,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Dodaj transakcję' }));

    expect(screen.getByRole('button', { name: 'Paragon' })).toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });
});
