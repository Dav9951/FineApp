import { describe, expect, it } from 'vitest';

import { cn } from './cn.js';

/**
 * Testy składania klas.
 *
 * Regresja, którą ten plik pilnuje: własne stopnie pisma z `15 §3.3` nie są częścią
 * domyślnej skali Tailwinda, więc `twMerge` bez douczenia traktuje je jak kolor tekstu
 * i wycina przy pierwszej klasie koloru obok.
 */

describe('cn', () => {
  it('rozstrzyga zwykłe konflikty na rzecz ostatniej klasy', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('własny stopień pisma przeżywa sąsiedztwo koloru', () => {
    expect(cn('text-hero', 'text-expense')).toBe('text-hero text-expense');
    expect(cn('text-amount', 'text-muted-foreground')).toBe('text-amount text-muted-foreground');
    expect(cn('text-caption', 'text-warning')).toBe('text-caption text-warning');
    expect(cn('text-meta', 'text-income')).toBe('text-meta text-income');
  });

  it('dwa stopnie pisma nadal się wykluczają', () => {
    expect(cn('text-hero', 'text-amount')).toBe('text-amount');
    expect(cn('text-caption', 'text-lg')).toBe('text-lg');
  });

  it('dwa kolory tekstu nadal się wykluczają', () => {
    expect(cn('text-income', 'text-expense')).toBe('text-expense');
  });

  it('zachowuje klasy, które nie kolidują', () => {
    expect(cn('rounded-lg', 'bg-card')).toBe('rounded-lg bg-card');
  });

  it('pomija wartości fałszywe', () => {
    expect(cn('bg-card', false, undefined, null, '')).toBe('bg-card');
  });

  it('przyjmuje mapy warunkowe i tablice', () => {
    expect(cn(['bg-card', 'p-4'], { 'text-income': true, 'text-expense': false })).toBe(
      'bg-card p-4 text-income',
    );
  });
});
