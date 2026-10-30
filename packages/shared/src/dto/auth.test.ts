import { describe, expect, it } from 'vitest';

import {
  ChangePinRequestSchema,
  EmailSchema,
  HouseholdDtoSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  PinSchema,
  UserDtoSchema,
} from './auth.js';

/**
 * Testy kontraktów uwierzytelniania
 * ([05 §4](../../../../plans/05-dto-contracts.md#4-auth--dtoauthdtots)).
 */

/** Poprawny identyfikator ULID do wypełniania przykładów. */
const ID = '01J9ZQK8WQ0000000000000000';

describe('EmailSchema', () => {
  it('normalizuje adres: przycina i sprowadza do małych liter', () => {
    expect(EmailSchema.parse('  Ja@Example.COM ')).toBe('ja@example.com');
  });

  it('odrzuca adres bez małpy, po polsku', () => {
    const result = EmailSchema.safeParse('bez-malpy');
    expect(result.success).toBe(false);
    expect(result.success ? '' : result.error.issues[0]?.message).toBe(
      'Nieprawidłowy adres e-mail',
    );
  });
});

describe('PinSchema', () => {
  it('przyjmuje od sześciu do ośmiu cyfr', () => {
    for (const pin of ['123456', '1234567', '12345678']) {
      expect(PinSchema.safeParse(pin).success).toBe(true);
    }
  });

  it('odrzuca krótsze, dłuższe i niecyfrowe', () => {
    for (const pin of ['12345', '123456789', '12345a', '', '12 3456']) {
      expect(PinSchema.safeParse(pin).success).toBe(false);
    }
  });
});

describe('LoginRequestSchema', () => {
  it('etykieta urządzenia jest opcjonalna i ograniczona długością', () => {
    expect(LoginRequestSchema.parse({ email: 'JA@example.com', pin: '483920' })).toEqual({
      email: 'ja@example.com',
      pin: '483920',
    });
    expect(
      LoginRequestSchema.safeParse({
        email: 'ja@e.com',
        pin: '483920',
        deviceLabel: 'x'.repeat(81),
      }).success,
    ).toBe(false);
  });
});

describe('UserDtoSchema', () => {
  it('kolor awatara i ostatnie logowanie mogą być puste', () => {
    expect(
      UserDtoSchema.parse({
        id: ID,
        email: 'ja@example.com',
        displayName: 'Adam',
        avatarColor: null,
        lastLoginAt: null,
      }).avatarColor,
    ).toBeNull();
  });

  it('odrzuca kolor spoza zapisu szesnastkowego', () => {
    const result = UserDtoSchema.safeParse({
      id: ID,
      email: 'ja@example.com',
      displayName: 'Adam',
      avatarColor: 'niebieski',
      lastLoginAt: null,
    });
    expect(result.success).toBe(false);
  });

  it('nie przepuszcza hasha PIN-u', () => {
    const parsed = UserDtoSchema.parse({
      id: ID,
      email: 'ja@example.com',
      displayName: 'Adam',
      avatarColor: '#3b82f6',
      lastLoginAt: 1_700_000_000_000,
      pinHash: '$argon2id$v=19$...',
    });
    expect(parsed).not.toHaveProperty('pinHash');
  });
});

describe('HouseholdDtoSchema', () => {
  it('pilnuje zakresów księgowania wstecz i dnia początku miesiąca', () => {
    const base = {
      id: ID,
      name: 'Dom',
      baseCurrency: 'PLN',
      timezone: 'Europe/Warsaw',
      locale: 'pl-PL',
      backPostingLimitMonths: 3,
      monthStartDay: 1,
      defaultExpenseAccountId: null,
    };
    expect(HouseholdDtoSchema.parse(base).monthStartDay).toBe(1);
    expect(HouseholdDtoSchema.safeParse({ ...base, monthStartDay: 29 }).success).toBe(false);
    expect(HouseholdDtoSchema.safeParse({ ...base, backPostingLimitMonths: 13 }).success).toBe(
      false,
    );
  });
});

describe('LoginResponseSchema', () => {
  it('składa profil i gospodarstwo w jedną odpowiedź', () => {
    const parsed = LoginResponseSchema.parse({
      accessToken: 'token',
      expiresIn: 900,
      user: {
        id: ID,
        email: 'ja@example.com',
        displayName: 'Adam',
        avatarColor: null,
        lastLoginAt: null,
      },
      household: {
        id: ID,
        name: 'Dom',
        baseCurrency: 'PLN',
        timezone: 'Europe/Warsaw',
        locale: 'pl-PL',
        backPostingLimitMonths: 3,
        monthStartDay: 1,
        defaultExpenseAccountId: null,
      },
    });
    expect(parsed.expiresIn).toBe(900);
  });
});

describe('ChangePinRequestSchema', () => {
  it('wymaga obu PIN-ów', () => {
    expect(ChangePinRequestSchema.safeParse({ currentPin: '483920' }).success).toBe(false);
    expect(
      ChangePinRequestSchema.safeParse({ currentPin: '483920', newPin: '571038' }).success,
    ).toBe(true);
  });
});
