import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { testConfig, testDb } from '../../test/build-app.js';
import { systemClock } from '../core/clock.js';
import type { DbHandle } from '../db/client.js';
import { authAttempts, authSessions, users } from '../db/schema/users.js';
import { login } from '../modules/auth/auth.service.js';
import { runUserCreate } from './create-user.js';
import { formatReport, parseArgs, runResetPin, USAGE } from './reset-pin.js';

/**
 * Testy skryptu resetu PIN-u
 * ([09 §10.1](../../../../plans/09-security-auth.md#101-reset-zapomnianego-pin-u), ADR-092).
 */

describe('parseArgs', () => {
  it('rozpoznaje adres i opcjonalny PIN', () => {
    expect(parseArgs(['--email', 'ja@example.com'])).toEqual({ email: 'ja@example.com' });
    expect(parseArgs(['--email', 'ja@example.com', '--pin', '583920'])).toEqual({
      email: 'ja@example.com',
      pin: '583920',
    });
  });

  it('zdejmuje separator `--` z pnpm', () => {
    expect(parseArgs(['--', '--email', 'ja@example.com'])).toEqual({ email: 'ja@example.com' });
  });

  it('odrzuca brak adresu i nieznane argumenty', () => {
    expect(() => parseArgs([])).toThrow(/--email/);
    expect(() => parseArgs(['--email', 'a@b.pl', '--name', 'A'])).toThrow(/Nieznany argument/);
    expect(() => parseArgs(['--email'])).toThrow(/wymaga wartości/);
    expect(() => parseArgs(['email', 'a@b.pl'])).toThrow(/Nieoczekiwany argument/);
  });

  it('pomoc wymienia argumenty i ostrzega o wylogowaniu', () => {
    expect(USAGE).toContain('--email');
    expect(USAGE).toContain('--pin');
    expect(USAGE).toContain('wylogowane');
  });
});

describe('runResetPin', () => {
  const config = testConfig();
  const OLD_PIN = '483920';

  /**
   * Baza z kontem, jedną sesją i nieudanymi próbami logowania.
   *
   * @returns Uchwyt bazy.
   */
  async function seeded(): Promise<DbHandle> {
    const handle = testDb();
    await runUserCreate(handle, config, { email: 'adam@example.com', name: 'Adam', pin: OLD_PIN });
    await login(handle, config, systemClock, {
      email: 'adam@example.com',
      pin: OLD_PIN,
      ip: '10.0.0.1',
    });
    for (let i = 0; i < 3; i += 1) {
      await login(handle, config, systemClock, {
        email: 'adam@example.com',
        pin: '000001',
        ip: '10.0.0.1',
      }).catch(() => undefined);
    }
    return handle;
  }

  it('ustawia wylosowany PIN: stary przestaje działać, nowy działa', async () => {
    const handle = await seeded();

    const report = await runResetPin(handle, config, { email: 'Adam@Example.com' });

    expect(report.pinGenerated).toBe(true);
    expect(report.pin).toMatch(/^\d{6}$/);
    await expect(
      login(handle, config, systemClock, { email: 'adam@example.com', pin: OLD_PIN }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      login(handle, config, systemClock, { email: 'adam@example.com', pin: report.pin }),
    ).resolves.toBeDefined();
    handle.close();
  });

  it('wylogowuje wszystkie urządzenia i zdejmuje blokadę prób na ten adres', async () => {
    const handle = await seeded();
    const user = handle.db.select().from(users).get();
    expect(handle.db.select().from(authSessions).all()).toHaveLength(1);

    const report = await runResetPin(handle, config, { email: 'adam@example.com', pin: '583920' });

    expect(report.sessionsDeleted).toBe(1);
    expect(report.attemptsCleared).toBe(4);
    expect(
      handle.db
        .select()
        .from(authSessions)
        .where(eq(authSessions.userId, user?.id ?? ''))
        .all(),
    ).toHaveLength(0);
    expect(handle.db.select().from(authAttempts).all()).toHaveLength(0);
    handle.close();
  });

  it('nie rusza prób logowania na inny adres', async () => {
    const handle = await seeded();
    await login(handle, config, systemClock, { email: 'ktos@example.com', pin: '000001' }).catch(
      () => undefined,
    );

    await runResetPin(handle, config, { email: 'adam@example.com' });

    expect(handle.db.select().from(authAttempts).all()).toHaveLength(1);
    handle.close();
  });

  it('podany PIN przechodzi przez reguły słabych PIN-ów', async () => {
    const handle = await seeded();
    await expect(
      runResetPin(handle, config, { email: 'adam@example.com', pin: '123456' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    // Stary PIN nadal działa — nic nie zostało zmienione.
    await expect(
      login(handle, config, systemClock, { email: 'adam@example.com', pin: OLD_PIN }),
    ).resolves.toBeDefined();
    handle.close();
  });

  it('nieznany adres → 404', async () => {
    const handle = await seeded();
    await expect(runResetPin(handle, config, { email: 'nikt@example.com' })).rejects.toMatchObject({
      statusCode: 404,
    });
    handle.close();
  });

  it('konto wyłączone → odmowa, PIN bez zmian', async () => {
    const handle = await seeded();
    handle.db.update(users).set({ isActive: false }).run();
    const before = handle.db.select().from(users).get()?.pinHash;

    await expect(runResetPin(handle, config, { email: 'adam@example.com' })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(handle.db.select().from(users).get()?.pinHash).toBe(before);
    handle.close();
  });
});

describe('formatReport', () => {
  it('wypisuje nowy PIN, liczbę wylogowanych sesji i ostrzeżenie', () => {
    const text = formatReport({
      email: 'adam@example.com',
      displayName: 'Adam',
      pin: '583920',
      pinGenerated: true,
      sessionsDeleted: 2,
      attemptsCleared: 3,
    });
    expect(text).toContain('583920');
    expect(text).toContain('wylosowany');
    expect(text).toContain('Wylogowane sesje:    2');
    expect(text).toContain('tylko hash');
  });
});
