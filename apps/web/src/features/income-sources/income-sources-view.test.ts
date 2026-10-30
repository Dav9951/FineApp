import type { HouseholdMemberDto, IncomeSourceDto } from '@fineapp/shared';
import { describe, expect, it } from 'vitest';

import {
  emptyIncomeSourceForm,
  incomeSourceCaption,
  incomeSourceFormFrom,
  SHARED_OWNER,
  splitArchived,
  toCreateIncomeSource,
  toUpdateIncomeSource,
  withKind,
} from './income-sources-view.js';

/**
 * Testy reguł ekranu źródeł przychodu — `F8-1`.
 */

const ME = '01J9ZQK8WQ0000000000000000';
const BASIA = '01J9ZQK8WQ3333333333333333';

const MEMBERS: HouseholdMemberDto[] = [
  {
    id: ME,
    email: 'd@example.com',
    displayName: 'Adam',
    avatarColor: null,
    isCurrent: true,
    lastLoginAt: null,
  },
  {
    id: BASIA,
    email: 'm@example.com',
    displayName: 'Basia',
    avatarColor: null,
    isCurrent: false,
    lastLoginAt: null,
  },
];

/**
 * Źródło w kształcie z kontraktu.
 *
 * @param overrides - Nadpisane pola.
 * @returns Źródło.
 */
function source(overrides: Partial<IncomeSourceDto> = {}): IncomeSourceDto {
  return {
    id: '01J9ZQK8WQ6666666666666666',
    name: 'Pensja',
    kind: 'salary',
    ownerUserId: null,
    countsTowardAllocation: true,
    isArchived: false,
    sortOrder: 0,
    ...overrides,
  };
}

describe('withKind', () => {
  it('nowe źródło — zwrot domyślnie poza podstawą celów, pensja w niej', () => {
    const refund = withKind(emptyIncomeSourceForm(), 'refund', true);
    expect(refund.countsTowardAllocation).toBe(false);
    expect(withKind(refund, 'salary', true).countsTowardAllocation).toBe(true);
  });

  it('edycja — przełącznik zostaje, jak go ustawiono', () => {
    const state = { ...incomeSourceFormFrom(source()), countsTowardAllocation: true };
    expect(withKind(state, 'refund', false).countsTowardAllocation).toBe(true);
  });
});

describe('toCreateIncomeSource', () => {
  it('wspólne → `ownerUserId: null`; nazwa przycięta', () => {
    expect(toCreateIncomeSource({ ...emptyIncomeSourceForm(), name: ' Pensja ' })).toEqual({
      ok: true,
      body: { name: 'Pensja', kind: 'salary', ownerUserId: null, countsTowardAllocation: true },
    });
  });

  it('domownik jako właściciel', () => {
    const result = toCreateIncomeSource({ ...emptyIncomeSourceForm(), name: 'X', owner: BASIA });
    expect(result.ok && result.body.ownerUserId).toBe(BASIA);
  });

  it('pusta nazwa — błąd przy polu', () => {
    expect(toCreateIncomeSource(emptyIncomeSourceForm())).toEqual({
      ok: false,
      errors: { name: 'Nazwa jest wymagana' },
    });
  });
});

describe('toUpdateIncomeSource', () => {
  it('bez zmian — puste ciało', () => {
    const saved = source({ ownerUserId: ME });
    expect(toUpdateIncomeSource(saved, incomeSourceFormFrom(saved))).toEqual({
      ok: true,
      body: {},
    });
  });

  it('tylko zmienione pola; zmiana na wspólne wysyła `null`', () => {
    const saved = source({ ownerUserId: ME });
    expect(
      toUpdateIncomeSource(saved, {
        ...incomeSourceFormFrom(saved),
        owner: SHARED_OWNER,
        countsTowardAllocation: false,
      }),
    ).toEqual({ ok: true, body: { ownerUserId: null, countsTowardAllocation: false } });
  });

  it('błąd nazwy przechodzi dalej', () => {
    const saved = source();
    expect(toUpdateIncomeSource(saved, { ...incomeSourceFormFrom(saved), name: '' }).ok).toBe(
      false,
    );
  });
});

describe('incomeSourceCaption', () => {
  it('rodzaj · czyje · poza podstawą', () => {
    expect(incomeSourceCaption(source(), MEMBERS)).toBe('Pensja · wspólne');
    expect(incomeSourceCaption(source({ ownerUserId: BASIA }), MEMBERS)).toBe('Pensja · Basia');
    expect(
      incomeSourceCaption(source({ kind: 'refund', countsTowardAllocation: false }), MEMBERS),
    ).toBe('Zwrot · wspólne · poza podstawą celów');
  });

  it('właściciel spoza listy (wyłączony) — „domownik"', () => {
    expect(
      incomeSourceCaption(source({ ownerUserId: '01J9ZQK8WQ9999999999999999' }), MEMBERS),
    ).toBe('Pensja · domownik');
  });
});

describe('splitArchived', () => {
  it('zachowuje kolejność w obu grupach', () => {
    const a = source({ id: 'a' });
    const b = source({ id: 'b', isArchived: true });
    const c = source({ id: 'c' });
    expect(splitArchived([a, b, c])).toEqual({ active: [a, c], archived: [b] });
  });
});
