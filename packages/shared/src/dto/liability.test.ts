import { describe, expect, it } from 'vitest';

import {
  CreateLiabilityRequestSchema,
  LiabilityFieldsSchema,
  liabilityIssues,
  RebaseLiabilityRequestSchema,
  UpdateLiabilityRequestSchema,
} from './liability.js';

/**
 * Testy kontraktów zobowiązań
 * ([05 §8](../../../../plans/05-dto-contracts.md#8-zobowiązania--dtoliabilitydtots), ADR-047).
 */

const ROR = '01J9ZQK8WQ0000000000000000';

/** Telefon na raty z 06 §3.8. */
const PHONE = {
  name: 'Telefon na raty',
  kind: 'installment',
  openingBalanceMinor: 250_000,
  balanceAsOf: '2026-09-01',
  monthlyPaymentMinor: 50_000,
} as const;

describe('LiabilityFieldsSchema', () => {
  it('uzupełnia wartości domyślne, przycina tekst', () => {
    const parsed = LiabilityFieldsSchema.parse({ ...PHONE, creditor: '  Play ', notes: '' });
    expect(parsed).toMatchObject({ createRecurringRule: false, creditor: 'Play', notes: null });
  });

  it('bez walidacji krzyżowej — reguła bez konta przechodzi (422 z serwisu)', () => {
    expect(LiabilityFieldsSchema.safeParse({ ...PHONE, createRecurringRule: true }).success).toBe(
      true,
    );
  });

  it('odrzuca kwotę zero, nieznany rodzaj i dzień 32', () => {
    expect(LiabilityFieldsSchema.safeParse({ ...PHONE, openingBalanceMinor: 0 }).success).toBe(
      false,
    );
    expect(LiabilityFieldsSchema.safeParse({ ...PHONE, kind: 'lease' }).success).toBe(false);
    expect(LiabilityFieldsSchema.safeParse({ ...PHONE, paymentDay: 32 }).success).toBe(false);
  });
});

describe('liabilityIssues i CreateLiabilityRequestSchema', () => {
  it('reguła na ratę wymaga konta i dnia płatności', () => {
    expect(liabilityIssues({ ...PHONE, createRecurringRule: true }).map((i) => i.path)).toEqual([
      'paymentAccountId',
      'paymentDay',
    ]);
    expect(
      liabilityIssues({
        ...PHONE,
        createRecurringRule: true,
        paymentAccountId: ROR,
        paymentDay: 20,
      }),
    ).toEqual([]);
  });

  it('pierwsza rata nie przed punktem odniesienia — formularz dostaje ten sam błąd', () => {
    const result = CreateLiabilityRequestSchema.safeParse({
      ...PHONE,
      firstPaymentOn: '2026-08-31',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['firstPaymentOn']);
  });
});

describe('UpdateLiabilityRequestSchema i RebaseLiabilityRequestSchema', () => {
  it('edycja bez wartości domyślnych i bez createRecurringRule', () => {
    expect(UpdateLiabilityRequestSchema.parse({})).toEqual({});
    expect(UpdateLiabilityRequestSchema.parse({ createRecurringRule: true })).toEqual({});
  });

  it('korekta do zera dozwolona, ujemna nie', () => {
    expect(
      RebaseLiabilityRequestSchema.safeParse({ remainingMinor: 0, asOf: '2026-09-01' }).success,
    ).toBe(true);
    expect(
      RebaseLiabilityRequestSchema.safeParse({ remainingMinor: -1, asOf: '2026-09-01' }).success,
    ).toBe(false);
  });
});
