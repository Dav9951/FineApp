import { describe, expect, it } from 'vitest';

import { testConfig, testDb } from '../../test/build-app.js';
import { users } from '../db/schema/users.js';
import { formatReport, parseArgs, runUserCreate, USAGE } from './create-user.js';

/**
 * Testy skryptu zakładania użytkownika
 * ([09 §10](../../../../plans/09-security-auth.md#10-zakładanie-użytkowników)).
 *
 * Skrypt jest jedyną drogą do konta — aplikacja nie ma rejestracji. Jeśli przestanie
 * działać, nie da się wejść do aplikacji na świeżym wdrożeniu.
 */

describe('parseArgs', () => {
  it('rozpoznaje komplet argumentów', () => {
    expect(parseArgs(['--email', 'ja@example.com', '--name', 'Adam', '--pin', '483920'])).toEqual({
      email: 'ja@example.com',
      name: 'Adam',
      pin: '483920',
    });
  });

  it('PIN i kolor są opcjonalne', () => {
    expect(parseArgs(['--email', 'ja@example.com', '--name', 'Adam'])).toEqual({
      email: 'ja@example.com',
      name: 'Adam',
    });
  });

  it('upomina się o wymagane argumenty', () => {
    expect(() => parseArgs(['--name', 'Adam'])).toThrow(/--email/);
    expect(() => parseArgs(['--email', 'ja@example.com'])).toThrow(/--name/);
  });

  it('odrzuca nieznane i niekompletne argumenty', () => {
    expect(() => parseArgs(['--haslo', 'x', '--email', 'a@b.pl', '--name', 'A'])).toThrow(
      /Nieznany argument/,
    );
    expect(() => parseArgs(['--email'])).toThrow(/wymaga wartości/);
    expect(() => parseArgs(['email', 'ja@example.com'])).toThrow(/Nieoczekiwany argument/);
  });

  it('zdejmuje separator `--`, który pnpm przekazuje do skryptu', () => {
    // Regresja: udokumentowane wywołanie z 09 §10 kończyło się „Nieznany argument: --".
    expect(parseArgs(['--', '--email', 'ja@example.com', '--name', 'Adam'])).toEqual({
      email: 'ja@example.com',
      name: 'Adam',
    });
  });

  it('pomoc wymienia wszystkie argumenty', () => {
    for (const flag of ['--email', '--name', '--pin', '--color']) {
      expect(USAGE).toContain(flag);
    }
  });
});

describe('runUserCreate', () => {
  it('pierwsze uruchomienie zakłada gospodarstwo, kategorie i użytkownika', async () => {
    const handle = testDb();
    const config = testConfig();

    const report = await runUserCreate(handle, config, {
      email: 'Adam@Example.com',
      name: 'Adam',
    });

    expect(report.householdCreated).toBe(true);
    expect(report.categoriesInserted).toBeGreaterThan(0);
    expect(report.email).toBe('adam@example.com');
    expect(report.pin).toMatch(/^\d{6}$/);
    expect(report.pinGenerated).toBe(true);
    handle.close();
  });

  it('drugie uruchomienie nie duplikuje gospodarstwa ani kategorii', async () => {
    const handle = testDb();
    const config = testConfig();
    await runUserCreate(handle, config, { email: 'pierwszy@example.com', name: 'Pierwszy' });

    const second = await runUserCreate(handle, config, {
      email: 'drugi@example.com',
      name: 'Drugi',
    });

    expect(second.householdCreated).toBe(false);
    expect(second.categoriesInserted).toBe(0);
    expect(handle.db.select().from(users).all()).toHaveLength(2);
    handle.close();
  });

  it('przekazuje PIN i kolor podane w argumentach', async () => {
    const handle = testDb();

    const report = await runUserCreate(handle, testConfig(), {
      email: 'adam@example.com',
      name: 'Adam',
      pin: '483920',
      color: '#123456',
    });

    expect(report.pin).toBe('483920');
    expect(report.pinGenerated).toBe(false);
    expect(handle.db.select().from(users).get()?.avatarColor).toBe('#123456');
    handle.close();
  });

  it('trzecie konto odbija się o limit produktowy', async () => {
    const handle = testDb();
    const config = testConfig();
    await runUserCreate(handle, config, { email: 'a@example.com', name: 'A' });
    await runUserCreate(handle, config, { email: 'b@example.com', name: 'B' });

    await expect(
      runUserCreate(handle, config, { email: 'c@example.com', name: 'C' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    handle.close();
  });
});

describe('formatReport', () => {
  const base = {
    email: 'adam@example.com',
    displayName: 'Adam',
    userId: '01J9ZQK8WQ0000000000000000',
    pin: '483920',
    pinGenerated: true,
    householdCreated: false,
    categoriesInserted: 0,
  };

  it('wypisuje PIN i ostrzega, że nie da się go odczytać później', () => {
    const text = formatReport(base);

    expect(text).toContain('483920');
    expect(text).toContain('wylosowany');
    expect(text).toContain('tylko hash');
  });

  it('odróżnia PIN podany od wylosowanego', () => {
    expect(formatReport({ ...base, pinGenerated: false })).toContain('podany');
  });

  it('o gospodarstwie wspomina tylko przy pierwszym uruchomieniu', () => {
    expect(formatReport(base)).not.toContain('Gospodarstwo');
    expect(formatReport({ ...base, householdCreated: true, categoriesInserted: 94 })).toContain(
      '94 kategoriami',
    );
  });
});
