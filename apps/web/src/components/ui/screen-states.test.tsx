import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button.js';
import { EmptyState } from './empty-state.js';
import { ErrorState } from './error-state.js';
import { SkeletonList } from './skeleton.js';

/**
 * Testy stanów ekranu ([15 §4.9](../../../../../plans/15-design-system.md#49-stany-ekranu)).
 *
 * „Ekran bez stanu pustego / ładowania / błędu to ekran nieukończony" (`CLAUDE.md`),
 * więc te trzy komponenty muszą działać, zanim powstanie pierwszy ekran z danymi.
 */

describe('SkeletonList', () => {
  it('odtwarza kształt listy, a nie kręci spinnerem', () => {
    const { container } = render(<SkeletonList rows={3} />);

    expect(screen.getByRole('status', { name: 'Ładowanie' })).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(3);
  });

  it('wyłącza animację przy prefers-reduced-motion', () => {
    const { container } = render(<SkeletonList rows={1} />);

    for (const block of container.querySelectorAll('.animate-pulse')) {
      expect(block).toHaveClass('motion-reduce:animate-none');
    }
  });

  it('wiersz szkieletu trzyma wysokość celu dotykowego, żeby lista nie usiadła', () => {
    const { container } = render(<SkeletonList rows={1} />);

    expect(container.querySelector('.min-h-touch')).not.toBeNull();
  });
});

describe('EmptyState', () => {
  it('pokazuje jedną pierwszą akcję, a nie listę braków', () => {
    render(
      <EmptyState
        action={<Button size="small">Dodaj</Button>}
        steps={[
          { label: 'Dodaj konto', done: true },
          { label: 'Ustal budżet miesiąca' },
          { label: 'Zapisz pierwszą transakcję' },
        ]}
        title="Zacznijmy od początku"
      />,
    );

    // Przycisk stoi przy pierwszym NIEwykonanym kroku i tylko przy nim.
    expect(screen.getAllByRole('button', { name: 'Dodaj' })).toHaveLength(1);
    const step = screen.getByText('Ustal budżet miesiąca').closest('li');
    expect(step).toContainElement(screen.getByRole('button', { name: 'Dodaj' }));
  });

  it('bez kroków pokazuje samą akcję', () => {
    render(<EmptyState action={<Button>Dodaj konto</Button>} title="Brak kont" />);

    expect(screen.getByRole('button', { name: 'Dodaj konto' })).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('kod błędu nie jest tytułem, a szczegóły są schowane', async () => {
    const user = userEvent.setup();
    render(
      <ErrorState
        details="ApiRequestError: 503"
        lastUpdatedAt="14:07"
        onRetry={vi.fn()}
        title="Nie udało się wczytać miesiąca"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się wczytać miesiąca');
    expect(screen.queryByText('ApiRequestError: 503')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Szczegóły techniczne' }));
    expect(screen.getByText('ApiRequestError: 503')).toBeInTheDocument();
  });

  it('tłumaczy, dlaczego nie pokazuje starych danych, i podaje godzinę', () => {
    render(<ErrorState lastUpdatedAt="14:07" title="Brak połączenia" />);

    expect(screen.getByRole('alert')).toHaveTextContent('mogły się już zmienić');
    expect(screen.getByRole('alert')).toHaveTextContent('14:07');
  });

  it('ponowienie wywołuje akcję', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} title="Brak połączenia" />);

    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
