import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  parseThemePreference,
  resolveTheme,
  setThemePreference,
  THEME_STORAGE_KEY,
  useTheme,
} from './theme.js';

/**
 * Testy motywu (ADR-067): ciemny domyślny (06 §1.5), wybór zapamiętany na urządzeniu,
 * wspólny stan dla przełącznika w pasku bocznym i wyboru w ustawieniach.
 */

afterEach(() => {
  act(() => {
    setThemePreference('dark');
  });
  window.localStorage.clear();
});

describe('parseThemePreference', () => {
  it('przepuszcza poprawne wartości', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference('dark')).toBe('dark');
  });

  it('brak wpisu i śmieci dają domyślny ciemny', () => {
    expect(parseThemePreference(null)).toBe('dark');
    expect(parseThemePreference('niebieski')).toBe('dark');
  });
});

describe('resolveTheme', () => {
  it('jawny wybór wygrywa z systemem', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('„system" podąża za preferencją systemu', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('setThemePreference', () => {
  it('nakłada klasę, kolor paska i zapisuje wybór', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);

    setThemePreference('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(meta.content).toBe('#f8f6f2');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    setThemePreference('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(meta.content).toBe('#1a1714');
    meta.remove();
  });
});

/**
 * Dwa niezależne odczyty motywu — jak pasek boczny i ustawienia.
 *
 * @returns Drzewo testowe.
 */
function TwoConsumers(): ReactNode {
  const first = useTheme();
  const second = useTheme();
  return (
    <>
      <button onClick={first.toggle} type="button">
        przełącz
      </button>
      <output>{second.resolved}</output>
    </>
  );
}

describe('useTheme', () => {
  it('zmiana w jednym miejscu jest widoczna w drugim', () => {
    render(<TwoConsumers />);
    expect(screen.getByRole('status')).toHaveTextContent('dark');
    act(() => {
      screen.getByRole('button', { name: 'przełącz' }).click();
    });
    expect(screen.getByRole('status')).toHaveTextContent('light');
  });
});
