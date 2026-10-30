import { render, screen } from '@testing-library/react';
import { StrictMode, useState, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  AmountInput,
  draftToMinor,
  formatDraft,
  minorToDraft,
  pressAmountKey,
  type AmountKey,
} from './amount-input.js';

/**
 * Testy pola kwoty ([15 §4.2](../../../../../plans/15-design-system.md#42-amountinput)).
 *
 * Mechanika bufora jest testowana osobno od renderu, bo to w niej siedzą reguły,
 * które psują się po cichu: trzecia cyfra groszy, drugi przecinek, wiodące zero.
 */

/**
 * Wpisuje ciąg klawiszy do bufora.
 *
 * @param keys - Klawisze, np. `12,34`.
 * @returns Bufor po wpisaniu.
 */
function type(keys: string): string {
  return [...keys].reduce<string>((draft, key) => pressAmountKey(draft, key as AmountKey), '');
}

describe('pressAmountKey', () => {
  it('składa kwotę z groszami', () => {
    expect(type('1234')).toBe('1234');
    expect(type('12,34')).toBe('12,34');
  });

  it('druga cyfra po przecinku kończy wpisywanie groszy', () => {
    expect(type('12,345')).toBe('12,34');
  });

  it('nie wpuszcza drugiego przecinka', () => {
    expect(type('12,3,4')).toBe('12,34');
  });

  it('przecinek na początku znaczy „zero i grosze"', () => {
    expect(type(',50')).toBe('0,50');
  });

  it('wiodące zero znika przy pierwszej cyfrze', () => {
    expect(type('05')).toBe('5');
    expect(type('0,5')).toBe('0,5');
  });

  it('ogranicza część całkowitą do dziewięciu cyfr', () => {
    expect(type('1234567890')).toBe('123456789');
  });

  it('cofa po jednym znaku, także przecinek', () => {
    expect(pressAmountKey('12,3', 'backspace')).toBe('12,');
    expect(pressAmountKey('12,', 'backspace')).toBe('12');
    expect(pressAmountKey('', 'backspace')).toBe('');
  });

  it('czyści całość', () => {
    expect(pressAmountKey('1234,56', 'clear')).toBe('');
  });
});

describe('draftToMinor', () => {
  it('przelicza bufor na grosze', () => {
    expect(draftToMinor('')).toBe(0);
    expect(draftToMinor('12')).toBe(1200);
    expect(draftToMinor('12,')).toBe(1200);
    expect(draftToMinor('12,3')).toBe(1230);
    expect(draftToMinor('12,34')).toBe(1234);
    expect(draftToMinor('0,05')).toBe(5);
  });

  it('jedna cyfra po przecinku to dziesiątki groszy, nie jednostki', () => {
    // Najłatwiejsza pomyłka w tym module: „12,5" to 12,50 zł, a nie 12,05 zł.
    expect(draftToMinor('12,5')).toBe(1250);
  });
});

describe('minorToDraft', () => {
  it('pomija zerowe grosze, żeby dało się dopisać złotówki', () => {
    expect(minorToDraft(0)).toBe('');
    expect(minorToDraft(1500)).toBe('15');
    expect(minorToDraft(1234)).toBe('12,34');
    expect(minorToDraft(5)).toBe('0,05');
  });

  it('jest odwrotnością draftToMinor', () => {
    for (const minor of [0, 5, 100, 1234, 99_999, 123_456_789]) {
      expect(draftToMinor(minorToDraft(minor))).toBe(minor);
    }
  });
});

describe('formatDraft', () => {
  it('grupuje tysiące spacją niełamliwą', () => {
    expect(formatDraft('1234567')).toBe(`1${' '}234${' '}567`);
  });

  it('nie domyka groszy w trakcie pisania', () => {
    // Domykanie sprawiłoby, że po wpisaniu „1" pod przecinkiem pojawia się „10".
    expect(formatDraft('12,3')).toBe('12,3');
    expect(formatDraft('12,')).toBe('12,');
  });

  it('pusty bufor pokazuje zero', () => {
    expect(formatDraft('')).toBe('0');
  });
});

describe('AmountInput', () => {
  it('składa kwotę z dotknięć klawiatury i zgłasza ją w groszach', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AmountInput onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: 'Przecinek' }));
    await user.click(screen.getByRole('button', { name: '5' }));

    expect(onChange).toHaveBeenLastCalledWith(1250);
    expect(screen.getByRole('textbox').textContent).toBe('12,5zł');
  });

  it('klawisz cofania ma etykietę i ikonę, a nie znak U+232B', () => {
    render(<AmountInput />);

    const backspace = screen.getByRole('button', { name: 'Usuń ostatnią cyfrę' });
    expect(backspace.textContent).toBe('');
    expect(backspace.querySelector('svg')).not.toBeNull();
  });

  it('klawiatura sprzętowa: kropka daje ten sam separator co przecinek', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AmountInput onChange={onChange} />);

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('7.5');

    expect(onChange).toHaveBeenLastCalledWith(750);
  });

  it('pokazuje błąd walidacji i przełącza kreskę na kolor błędu', () => {
    render(<AmountInput error="Podaj kwotę większą od zera" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Podaj kwotę większą od zera');
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('rodzic trzyma kwotę w stanie: bez zmiany stanu w trakcie renderowania', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Parent = (): ReactNode => {
      const [amountMinor, setAmountMinor] = useState(0);
      return (
        <>
          <AmountInput onChange={setAmountMinor} />
          <output>{amountMinor}</output>
        </>
      );
    };
    // Tryb ścisły wywołuje funkcje aktualizujące stan dwa razy — tak jak w aplikacji.
    render(
      <StrictMode>
        <Parent />
      </StrictMode>,
    );

    await user.click(screen.getByRole('button', { name: '4' }));
    await user.click(screen.getByRole('button', { name: '2' }));

    expect(screen.getByRole('status')).toHaveTextContent('4200');
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('kwota początkowa trafia do bufora', () => {
    render(<AmountInput defaultValueMinor={123_456} />);

    // `toHaveTextContent` normalizuje spację niełamliwą do zwykłej, a tu chodzi
    // właśnie o nią — dlatego porównanie idzie po surowej treści.
    expect(screen.getByRole('textbox').textContent).toBe(`1${' '}234,56zł`);
  });
});
