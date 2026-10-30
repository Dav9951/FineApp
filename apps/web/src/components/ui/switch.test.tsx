import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './checkbox.js';
import { Switch } from './switch.js';

/**
 * Testy przełącznika i pola wyboru
 * ([15 §4.10](../../../../../plans/15-design-system.md#410-pozostałe)).
 *
 * Oba są wizualnie mniejsze od progu 44 px, więc obszar dotyku muszą powiększać same —
 * przełącznik pseudoelementem, pole wyboru etykietą obejmującą cały wiersz.
 */

describe('Switch', () => {
  it('cel dotykowy sięga 44 px mimo wysokości 24 px', () => {
    render(<Switch checked={false} label="Motyw ciemny" onCheckedChange={vi.fn()} />);

    const element = screen.getByRole('switch', { name: 'Motyw ciemny' });
    expect(element).toHaveClass('h-6', 'w-11');
    expect(element.className).toContain('after:h-touch');
  });

  it('stan niesie też pozycja uchwytu, nie tylko kolor', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} label="Motyw ciemny" onCheckedChange={onCheckedChange} />);

    const element = screen.getByRole('switch', { name: 'Motyw ciemny' });
    expect(element).toHaveAttribute('data-state', 'unchecked');
    expect(element.firstElementChild?.className).toContain('data-[state=checked]:translate-x');

    await user.click(element);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('stan wyłączony niesie aria-disabled', () => {
    render(<Switch checked disabled label="Motyw ciemny" onCheckedChange={vi.fn()} />);

    expect(screen.getByRole('switch', { name: 'Motyw ciemny' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('Checkbox', () => {
  it('zaznaczenie maluje się tokenem, nie własnym błękitem przeglądarki', () => {
    // Natywne pole wyboru ignoruje `color` i używa `accent-color`. Bez tego
    // przeglądarka wstawia swój jaskrawy błękit — surowy kolor spoza tokenów.
    render(
      <Checkbox checked onCheckedChange={vi.fn()}>
        Uwzględnij transakcje planowane
      </Checkbox>,
    );

    expect(screen.getByRole('checkbox')).toHaveClass('accent-primary');
  });

  it('obszar dotyku obejmuje cały wiersz z etykietą', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Checkbox checked={false} onCheckedChange={onCheckedChange}>
        Uwzględnij transakcje planowane
      </Checkbox>,
    );

    const label = screen.getByText('Uwzględnij transakcje planowane').closest('label');
    expect(label).toHaveClass('min-h-touch');

    await user.click(screen.getByText('Uwzględnij transakcje planowane'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
