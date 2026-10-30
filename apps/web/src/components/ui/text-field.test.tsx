import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TextField } from './text-field.js';

/**
 * Testy pola tekstowego ([15 §4.10](../../../../../plans/15-design-system.md#410-pozostałe)).
 */

describe('TextField', () => {
  it('etykieta nazywa pole, a cel dotykowy ma 44 px', () => {
    render(<TextField label="Nazwa" onChange={vi.fn()} value="" />);
    const input = screen.getByRole('textbox', { name: 'Nazwa' });
    expect(input).toHaveClass('min-h-touch');
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('przekazuje wpisany tekst', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Nazwa" onChange={onChange} value="" />);
    await user.type(screen.getByRole('textbox', { name: 'Nazwa' }), 'R');
    expect(onChange).toHaveBeenCalledWith('R');
  });

  it('błąd jest powiązany z polem i zastępuje podpis', () => {
    render(
      <TextField
        error="Nazwa jest wymagana"
        hint="Podpis"
        label="Nazwa"
        onChange={vi.fn()}
        value=""
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Nazwa' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Nazwa jest wymagana');
    expect(input).toHaveClass('border-danger');
    expect(screen.queryByText('Podpis')).not.toBeInTheDocument();
  });

  it('podpis bez błędu opisuje pole', () => {
    render(<TextField hint="Widoczna na liście" label="Nazwa" onChange={vi.fn()} value="" />);
    expect(screen.getByRole('textbox', { name: 'Nazwa' })).toHaveAccessibleDescription(
      'Widoczna na liście',
    );
  });
});

describe('TextField — wiele wierszy', () => {
  it('`rows` daje pole wielowierszowe z tą samą etykietą i błędem', async () => {
    const onChange = vi.fn();
    render(
      <TextField error="Za długie" label="Podpowiedzi" onChange={onChange} rows={3} value="" />,
    );
    const field = screen.getByRole('textbox', { name: 'Podpowiedzi' });
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveAttribute('rows', '3');
    expect(field).toHaveAccessibleDescription('Za długie');
    await userEvent.type(field, 'L');
    expect(onChange).toHaveBeenCalledWith('L');
  });
});
