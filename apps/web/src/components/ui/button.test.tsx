import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button, IconButton } from './button.js';

/**
 * Testy przycisków ([15 §4.3](../../../../../plans/15-design-system.md#43-button-i-iconbutton)).
 *
 * Sprawdzane są reguły, które łatwo zgubić przy zmianie wyglądu: cel dotykowy 44 px
 * niezależnie od rozmiaru wizualnego i `aria-disabled` obok samego `disabled`.
 */

describe('Button', () => {
  it('duży i średni rozmiar trzymają cel dotykowy 44 px', () => {
    render(
      <>
        <Button size="large">Duży</Button>
        <Button size="medium">Średni</Button>
      </>,
    );

    for (const name of ['Duży', 'Średni']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-touch');
    }
  });

  it('mały odnośnik powiększa obszar dotyku ujemnym marginesem', () => {
    render(
      <Button size="small" variant="link">
        Edytuj
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Edytuj' })).toHaveClass('min-h-touch', '-my-2');
  });

  it('mały przycisk z tłem: tło 36 px, dotyk 44 px z pseudoelementu, bez ujemnego marginesu', () => {
    render(
      <>
        <Button size="small">Główny</Button>
        <Button size="small" variant="soft">
          Wpłać
        </Button>
        <Button size="small" variant="ghost">
          Zmień
        </Button>
      </>,
    );

    for (const name of ['Główny', 'Wpłać', 'Zmień']) {
      const button = screen.getByRole('button', { name });
      // 36 px tła + 2 × 4 px pseudoelementu = 44 px celu dotykowego.
      expect(button).toHaveClass('relative', 'h-9', 'after:absolute', 'after:-inset-y-1');
      expect(button).not.toHaveClass('-my-2');
    }
  });

  it('stan wyłączony niesie aria-disabled, nie samo wyszarzenie', () => {
    render(<Button disabled>Zapisz</Button>);

    const button = screen.getByRole('button', { name: 'Zapisz' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('ładowanie zostawia tekst na miejscu i blokuje ponowne kliknięcie', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Księguję
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Księguję' });
    expect(button).toHaveAttribute('aria-busy', 'true');

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('ikona bez etykiety nie istnieje dla czytnika — etykieta jest wymagana', () => {
    render(
      <IconButton label="Dodaj transakcję">
        <svg />
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Dodaj transakcję' })).toHaveClass(
      'min-h-touch',
      'w-touch',
    );
  });
});
