import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../core/clock.js';
import { isAppError } from '../../core/errors.js';
import type { DbHandle } from '../../db/client.js';
import { seedDatabase } from '../../db/seed/index.js';
import { users } from '../../db/schema/users.js';
import { testConfig, testDb } from '../../../test/build-app.js';
import { verifyPin } from './auth.pin.js';
import { AVATAR_COLORS, createUser, MAX_ACTIVE_USERS, normalizeEmail } from './auth.service.js';

/**
 * Testy serwisu uwierzytelniania
 * ([09 §10](../../../../../../plans/09-security-auth.md#10-zakładanie-użytkowników)).
 */

const CLOCK = fixedClock('2026-09-22T10:00:00.000Z');

/**
 * Przygotowuje bazę z gospodarstwem.
 *
 * @returns Uchwyt bazy, konfiguracja i identyfikator gospodarstwa.
 */
function setup(): { handle: DbHandle; config: ReturnType<typeof testConfig>; householdId: string } {
  const handle = testDb();
  const config = testConfig();
  const { householdId } = seedDatabase(handle, config);
  return { handle, config, householdId };
}

describe('normalizeEmail', () => {
  it('przycina i sprowadza do małych liter', () => {
    expect(normalizeEmail('  Ja@Example.COM ')).toBe('ja@example.com');
  });

  it('odrzuca nieprawidłowy adres błędem walidacji ze wskazaniem pola', () => {
    let caught: unknown;
    try {
      normalizeEmail('bez-malpy');
    } catch (error) {
      caught = error;
    }

    expect(isAppError(caught)).toBe(true);
    // Zawężenie po `isAppError` daje dostęp do `details` bez rzutowania.
    if (!isAppError(caught)) return;
    expect(caught.statusCode).toBe(400);
    expect(caught.details?.[0]?.path).toBe('email');
  });
});

describe('createUser', () => {
  it('zapisuje użytkownika i zwraca PIN w postaci jawnej dokładnie raz', async () => {
    const { handle, config, householdId } = setup();

    const result = await createUser(handle, config, CLOCK, {
      email: '  Adam@Example.COM ',
      displayName: '  Adam  ',
      householdId,
    });

    expect(result.user.email).toBe('adam@example.com');
    expect(result.user.displayName).toBe('Adam');
    expect(result.pinGenerated).toBe(true);
    expect(result.pin).toMatch(/^\d{6}$/);

    const row = handle.db.select().from(users).get();
    expect(row?.pinHash).not.toContain(result.pin);
    await expect(verifyPin(row?.pinHash ?? '', result.pin)).resolves.toBe(true);
    handle.close();
  });

  it('profil nie niesie hasha PIN-u', async () => {
    const { handle, config, householdId } = setup();

    const { user } = await createUser(handle, config, CLOCK, {
      email: 'adam@example.com',
      displayName: 'Adam',
      householdId,
    });

    expect(user).not.toHaveProperty('pinHash');
    expect(Object.keys(user).sort()).toEqual([
      'avatarColor',
      'displayName',
      'email',
      'id',
      'lastLoginAt',
    ]);
    handle.close();
  });

  it('przyjmuje PIN podany ręcznie', async () => {
    const { handle, config, householdId } = setup();

    const result = await createUser(handle, config, CLOCK, {
      email: 'adam@example.com',
      displayName: 'Adam',
      householdId,
      pin: '483920',
    });

    expect(result.pin).toBe('483920');
    expect(result.pinGenerated).toBe(false);
    handle.close();
  });

  it('odrzuca PIN łamiący reguły z 09 §2.3, wskazując pole', async () => {
    const { handle, config, householdId } = setup();

    await expect(
      createUser(handle, config, CLOCK, {
        email: 'adam@example.com',
        displayName: 'Adam',
        householdId,
        pin: '123456',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    // Nieudane założenie nie zostawia po sobie wiersza.
    expect(handle.db.select().from(users).all()).toHaveLength(0);
    handle.close();
  });

  it('odrzuca pustą nazwę', async () => {
    const { handle, config, householdId } = setup();

    await expect(
      createUser(handle, config, CLOCK, {
        email: 'adam@example.com',
        displayName: '   ',
        householdId,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    handle.close();
  });

  it('nie wpuszcza dwóch kont na ten sam adres, także innej wielkości liter', async () => {
    const { handle, config, householdId } = setup();
    await createUser(handle, config, CLOCK, {
      email: 'adam@example.com',
      displayName: 'Adam',
      householdId,
    });

    await expect(
      createUser(handle, config, CLOCK, {
        email: 'ADAM@example.com',
        displayName: 'Adam raz jeszcze',
        householdId,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    handle.close();
  });

  it('wymusza limit dwóch aktywnych użytkowników', async () => {
    const { handle, config, householdId } = setup();
    await createUser(handle, config, CLOCK, {
      email: 'pierwszy@example.com',
      displayName: 'Pierwszy',
      householdId,
    });
    await createUser(handle, config, CLOCK, {
      email: 'drugi@example.com',
      displayName: 'Drugi',
      householdId,
    });

    await expect(
      createUser(handle, config, CLOCK, {
        email: 'trzeci@example.com',
        displayName: 'Trzeci',
        householdId,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(handle.db.select().from(users).all()).toHaveLength(MAX_ACTIVE_USERS);
    handle.close();
  });

  it('nadaje kolejne kolory awatarów z palety', async () => {
    const { handle, config, householdId } = setup();

    const first = await createUser(handle, config, CLOCK, {
      email: 'pierwszy@example.com',
      displayName: 'Pierwszy',
      householdId,
    });
    const second = await createUser(handle, config, CLOCK, {
      email: 'drugi@example.com',
      displayName: 'Drugi',
      householdId,
    });

    expect(first.user.avatarColor).toBe(AVATAR_COLORS[0]);
    expect(second.user.avatarColor).toBe(AVATAR_COLORS[1]);
    expect(first.user.avatarColor).not.toBe(second.user.avatarColor);
    handle.close();
  });

  it('przyjmuje kolor podany z zewnątrz', async () => {
    const { handle, config, householdId } = setup();

    const result = await createUser(handle, config, CLOCK, {
      email: 'adam@example.com',
      displayName: 'Adam',
      householdId,
      avatarColor: '#123456',
    });

    expect(result.user.avatarColor).toBe('#123456');
    handle.close();
  });

  it('zapisuje czas z zegara, nie z systemu', async () => {
    const { handle, config, householdId } = setup();

    await createUser(handle, config, CLOCK, {
      email: 'adam@example.com',
      displayName: 'Adam',
      householdId,
    });

    const row = handle.db.select().from(users).get();
    expect(row?.createdAt).toBe(CLOCK.now().getTime());
    expect(row?.pinUpdatedAt).toBe(CLOCK.now().getTime());
    handle.close();
  });

  it('szanuje zakres długości PIN-u z konfiguracji', async () => {
    const { handle, householdId } = setup();
    const config = testConfig({
      auth: { ...testConfig().auth, pinMinLength: 8, pinMaxLength: 8 },
    });

    await expect(
      createUser(handle, config, CLOCK, {
        email: 'adam@example.com',
        displayName: 'Adam',
        householdId,
        pin: '483920',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const result = await createUser(handle, config, CLOCK, {
      email: 'adam@example.com',
      displayName: 'Adam',
      householdId,
    });
    expect(result.pin).toMatch(/^\d{8}$/);
    handle.close();
  });
});
