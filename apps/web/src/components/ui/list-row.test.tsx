import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ListRow } from './list-row.js';
import { Money } from './money.js';

/**
 * Testy wiersza listy ([15 §4.8](../../../../../plans/15-design-system.md#48-listrow)).
 *
 * Reguła podziału miejsca na 390 px: **kwota nigdy się nie skraca, skraca się nazwa
 * obok niej** — dlatego to nazwa dostaje `truncate`, a kwota `shrink-0`.
 */

describe('ListRow', () => {
  it('kwota nie kurczy się, nazwa owszem', () => {
    render(
      <ListRow
        amount={<Money amountMinor={8990} variant="expense" />}
        caption="22 września · Wspólne"
        name="Biedronka"
      />,
    );

    expect(screen.getByText('Biedronka')).toHaveClass('truncate');
    expect(screen.getByText('−89,90 zł').parentElement?.parentElement).toHaveClass('shrink-0');
  });

  it('nazwa kategorii zawija się zamiast urywać', () => {
    render(<ListRow name="Oprogramowanie i narzędzia" wrapName />);

    const name = screen.getByText('Oprogramowanie i narzędzia');
    expect(name).toHaveClass('break-words');
    expect(name).not.toHaveClass('truncate');
  });

  it('trzyma cel dotykowy niezależnie od ilości danych', () => {
    const { container: full } = render(
      <ListRow caption="22 września" name="Biedronka" amount={<span>10 zł</span>} />,
    );
    const { container: bare } = render(<ListRow name="Biedronka" />);

    expect(full.firstElementChild).toHaveClass('min-h-touch');
    expect(bare.firstElementChild).toHaveClass('min-h-touch');
  });

  it('wiersz z akcją jest przyciskiem, bez akcji zwykłym blokiem', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ListRow name="Biedronka" onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: /Biedronka/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('pierwszy wiersz grupy nie ma górnej linii', () => {
    const { container: first } = render(<ListRow first name="Pierwszy" />);
    const { container: next } = render(<ListRow name="Kolejny" />);

    expect(first.firstElementChild).not.toHaveClass('border-t');
    expect(next.firstElementChild).toHaveClass('border-t');
  });
});
