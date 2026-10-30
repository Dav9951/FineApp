import type { BudgetDraftDto, BudgetGroupDto, BudgetLineDto } from '@fineapp/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, testConfig, type TestApp } from '../../../test/build-app.js';
import {
  CSRF_HEADER,
  householdFixture,
  insertAccount,
  insertCategory,
  type HouseholdFixture,
} from '../../../test/factories.js';
import { mutableClock, type MutableClock } from '../../core/clock.js';
import { newId } from '../../core/id.js';
import { recurringRules, type RecurringRuleInsert } from '../../db/schema/recurring.js';
import { signAccessToken } from '../auth/auth.tokens.js';

/**
 * Testy układu szkicu: grupy i kolejność linii — `F9-11`
 * ([04 §14a](../../../../../../plans/04-api-spec.md#14a-planer-budżetu--apiv1budget-drafts),
 * [07 §13.10](../../../../../../plans/07-domain-rules.md#1310-układ-szkicu-grupy-i-kolejność),
 * ADR-081). Prawdziwe API i baza; reguły wstawiane wprost.
 */

/** 27 października 2026, 11:00 w Warszawie. */
const NOW = new Date('2026-10-27T10:00:00.000Z');
const BASE = '/api/v1/budget-drafts';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Aplikacja z gospodarstwem, kontem i zegarem. */
interface Setup {
  app: TestApp;
  home: HouseholdFixture;
  clock: MutableClock;
  checking: string;
}

/**
 * Buduje aplikację z gospodarstwem i kontem wydatkowym.
 *
 * @returns Kontekst testu.
 */
async function setup(): Promise<Setup> {
  const clock = mutableClock(NOW);
  const app = await buildTestApp({}, clock);
  harness = app;
  const home = await householdFixture(app.db, testConfig(), NOW);
  const checking = insertAccount(app.db, home, { name: 'ROR' });
  return { app, home, clock, checking };
}

/**
 * Wywołuje trasę planera.
 *
 * @param s - Kontekst.
 * @param method - Metoda HTTP.
 * @param url - Ścieżka względem `/budget-drafts`.
 * @param payload - Ciało żądania.
 * @returns Odpowiedź.
 */
async function call(
  s: Setup,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
): Promise<LightMyRequestResponse> {
  return s.app.app.inject({
    method,
    url: `${BASE}${url}`,
    headers: s.home.headers,
    ...(payload === undefined ? {} : { payload }),
  });
}

/**
 * Wywołuje trasę i zwraca szkic, sprawdzając status.
 *
 * @param s - Kontekst.
 * @param method - Metoda HTTP.
 * @param url - Ścieżka.
 * @param payload - Ciało.
 * @param status - Oczekiwany status.
 * @returns Szkic z odpowiedzi.
 */
async function draft(
  s: Setup,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
  status = 200,
): Promise<BudgetDraftDto> {
  const response = await call(s, method, url, payload);
  expect(response.statusCode, response.body).toBe(status);
  return response.json<{ data: BudgetDraftDto }>().data;
}

/**
 * Wstawia regułę wydatku 10. dnia od września.
 *
 * @param s - Kontekst.
 * @param values - Nadpisane pola.
 * @returns Identyfikator reguły.
 */
function insertRule(s: Setup, values: Partial<RecurringRuleInsert>): string {
  const id = newId();
  s.app.db.db
    .insert(recurringRules)
    .values({
      id,
      householdId: s.home.householdId,
      name: 'Reguła',
      flow: 'expense',
      amountMinor: 100_00,
      accountId: s.checking,
      frequency: 'monthly',
      dayOfMonth: 10,
      anchorDate: '2026-09-10',
      startMonth: '2026-09',
      createdAt: NOW.getTime(),
      updatedAt: NOW.getTime(),
      ...values,
    })
    .run();
  return id;
}

/**
 * Linia szkicu po nazwie.
 *
 * @param d - Szkic.
 * @param name - Nazwa linii.
 * @returns Linia.
 */
function line(d: BudgetDraftDto, name: string): BudgetLineDto {
  const found = d.lines.find((item) => item.name === name);
  if (found === undefined) throw new Error(`brak linii ${name}`);
  return found;
}

/**
 * Grupa szkicu po nazwie.
 *
 * @param d - Szkic.
 * @param name - Nazwa grupy.
 * @returns Grupa.
 */
function group(d: BudgetDraftDto, name: string): BudgetGroupDto {
  const found = d.groups.find((item) => item.name === name);
  if (found === undefined) throw new Error(`brak grupy ${name}`);
  return found;
}

/**
 * Wydatki szkicu w kolejności z odpowiedzi, z nazwą grupy.
 *
 * @param d - Szkic.
 * @returns Pary `[nazwa linii, nazwa grupy albo null]`.
 */
function expenses(d: BudgetDraftDto): [string, string | null][] {
  const names = new Map(d.groups.map((item) => [item.id, item.name]));
  return d.lines
    .filter((item) => item.flow === 'expense' && !item.isExcluded)
    .map((item) => [item.name, item.groupId === null ? null : (names.get(item.groupId) ?? '?')]);
}

/**
 * Szkic października: czynsz, prąd, rata (reguły) i dwie linie własne.
 *
 * @returns Kontekst ze szkicem października.
 */
async function seeded(): Promise<Setup & { october: BudgetDraftDto }> {
  const s = await setup();
  insertRule(s, { name: 'Czynsz', amountMinor: 1_850_00 });
  insertRule(s, { name: 'Prąd', amountMinor: 120_00, dayOfMonth: 12 });
  insertRule(s, { name: 'Rata', amountMinor: 900_00, dayOfMonth: 15 });
  insertRule(s, { name: 'Pensja', flow: 'income', amountMinor: 9_800_00, dayOfMonth: 1 });
  await draft(s, 'POST', '/2026-10', {}, 201);
  await draft(
    s,
    'POST',
    '/2026-10/lines',
    { flow: 'expense', name: 'Jedzenie', amountMinor: 1_900_00 },
    201,
  );
  const october = await draft(
    s,
    'POST',
    '/2026-10/lines',
    { flow: 'expense', name: 'Prezent', amountMinor: 300_00 },
    201,
  );
  return { ...s, october };
}

describe('grupy szkicu (07 §13.10)', () => {
  it('szkic bez grup — kolejność dopisania, groupId null', async () => {
    const s = await seeded();
    expect(s.october.groups).toEqual([]);
    expect(expenses(s.october)).toEqual([
      ['Czynsz', null],
      ['Prąd', null],
      ['Rata', null],
      ['Jedzenie', null],
      ['Prezent', null],
    ]);
  });

  it('nowa grupa, przeniesienie linii polem groupId — na koniec grupy', async () => {
    const s = await seeded();
    let d = await draft(s, 'POST', '/2026-10/groups', { section: 'expense', name: 'Dom' }, 201);
    const home = group(d, 'Dom');
    expect(home).toMatchObject({ section: 'expense', sortOrder: 0 });
    d = await draft(s, 'PATCH', `/2026-10/lines/${line(d, 'Prąd').id}`, { groupId: home.id });
    d = await draft(s, 'PATCH', `/2026-10/lines/${line(d, 'Czynsz').id}`, { groupId: home.id });
    // Grupy przed liniami bez grupy; w grupie — kolejność dołączenia.
    expect(expenses(d)).toEqual([
      ['Prąd', 'Dom'],
      ['Czynsz', 'Dom'],
      ['Rata', null],
      ['Jedzenie', null],
      ['Prezent', null],
    ]);
    // Suma sekcji bez zmian — grupy nie wchodzą do bilansu.
    expect(d.summary.expenseMinor).toBe(s.october.summary.expenseMinor);
    d = await draft(s, 'PATCH', `/2026-10/lines/${line(d, 'Prąd').id}`, { groupId: null });
    expect(line(d, 'Prąd').groupId).toBeNull();
  });

  it('nowa linia od razu w grupie', async () => {
    const s = await seeded();
    let d = await draft(s, 'POST', '/2026-10/groups', { section: 'expense', name: 'Dom' }, 201);
    d = await draft(
      s,
      'POST',
      '/2026-10/lines',
      { flow: 'expense', name: 'Woda', amountMinor: 80_00, groupId: group(d, 'Dom').id },
      201,
    );
    expect(line(d, 'Woda').groupId).toBe(group(d, 'Dom').id);
  });

  it('linia w grupie innej sekcji albo nieznanej → 422 (I-25)', async () => {
    const s = await seeded();
    const d = await draft(s, 'POST', '/2026-10/groups', { section: 'income', name: 'Pensje' }, 201);
    const wrong = await call(s, 'PATCH', `/2026-10/lines/${line(d, 'Czynsz').id}`, {
      groupId: group(d, 'Pensje').id,
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.body).toContain('grupie swojej sekcji');
    const unknown = await call(s, 'POST', '/2026-10/lines', {
      flow: 'expense',
      name: 'Woda',
      amountMinor: 80_00,
      groupId: newId(),
    });
    expect(unknown.statusCode).toBe(422);
  });

  it('nazwa zajęta bez względu na wielkość liter → 422; zmiana nazwy', async () => {
    const s = await seeded();
    await draft(s, 'POST', '/2026-10/groups', { section: 'expense', name: 'Raty' }, 201);
    const twice = await call(s, 'POST', '/2026-10/groups', { section: 'expense', name: ' raty ' });
    expect(twice.statusCode).toBe(422);
    expect(twice.body).toContain('już jest w tej sekcji');
    // W innej sekcji ta sama nazwa wolna.
    await draft(s, 'POST', '/2026-10/groups', { section: 'pools', name: 'Raty' }, 201);
    let d = await draft(s, 'POST', '/2026-10/groups', { section: 'expense', name: 'Dom' }, 201);
    expect(
      (await call(s, 'PATCH', `/2026-10/groups/${group(d, 'Dom').id}`, { name: 'RATY' }))
        .statusCode,
    ).toBe(422);
    // Własna nazwa innymi literami — wolno.
    d = await draft(s, 'PATCH', `/2026-10/groups/${group(d, 'Raty').id}`, { name: 'RATY' });
    expect(d.groups.map((item) => item.name)).toEqual(['RATY', 'Dom', 'Raty']);
    expect((await call(s, 'PATCH', `/2026-10/groups/${newId()}`, { name: 'X' })).statusCode).toBe(
      404,
    );
    expect(
      (await call(s, 'POST', '/2026-10/groups', { section: 'expense', name: '' })).statusCode,
    ).toBe(400);
  });

  it('usunięcie grupy: linie w „Bez grupy", kolejność między nimi bez zmian; „Cofnij"', async () => {
    const s = await seeded();
    let d = await draft(
      s,
      'POST',
      '/2026-10/groups',
      { section: 'expense', name: 'Pierwsza' },
      201,
    );
    d = await draft(
      s,
      'POST',
      '/2026-10/groups',
      {
        section: 'expense',
        name: 'Dom',
        lineIds: [line(d, 'Prąd').id, line(d, 'Czynsz').id],
      },
      201,
    );
    const lineIds = [line(d, 'Prąd').id, line(d, 'Czynsz').id];
    expect(expenses(d).slice(0, 2)).toEqual([
      ['Prąd', 'Dom'],
      ['Czynsz', 'Dom'],
    ]);
    d = await draft(s, 'DELETE', `/2026-10/groups/${group(d, 'Dom').id}`);
    expect(d.groups.map((item) => item.name)).toEqual(['Pierwsza']);
    const loose = expenses(d).map(([name]) => name);
    expect(loose.indexOf('Prąd')).toBeLessThan(loose.indexOf('Czynsz'));
    expect(line(d, 'Czynsz').groupId).toBeNull();

    // „Cofnij": ta sama grupa z tymi samymi liniami na pierwszym miejscu.
    d = await draft(
      s,
      'POST',
      '/2026-10/groups',
      { section: 'expense', name: 'Dom', lineIds, position: 0 },
      201,
    );
    expect(d.groups.map((item) => [item.name, item.sortOrder])).toEqual([
      ['Dom', 0],
      ['Pierwsza', 1],
    ]);
    expect(expenses(d).slice(0, 2)).toEqual([
      ['Prąd', 'Dom'],
      ['Czynsz', 'Dom'],
    ]);
  });

  it('nowa grupa z linią spoza sekcji albo podaną dwa razy → 422', async () => {
    const s = await seeded();
    const salary = line(s.october, 'Pensja').id;
    const rent = line(s.october, 'Czynsz').id;
    for (const lineIds of [[salary], [rent, rent], [newId()]]) {
      const response = await call(s, 'POST', '/2026-10/groups', {
        section: 'expense',
        name: 'Dom',
        lineIds,
      });
      expect(response.statusCode, JSON.stringify(lineIds)).toBe(422);
    }
  });

  it('pominięta linia zostaje w grupie i wraca do niej po „Przywróć"', async () => {
    const s = await seeded();
    let d = await draft(
      s,
      'POST',
      '/2026-10/groups',
      { section: 'expense', name: 'Dom', lineIds: [line(s.october, 'Prąd').id] },
      201,
    );
    const power = line(d, 'Prąd').id;
    d = await draft(s, 'DELETE', `/2026-10/lines/${power}`);
    expect(line(d, 'Prąd')).toMatchObject({ isExcluded: true, groupId: group(d, 'Dom').id });
    // Układ nie musi obejmować linii pominiętej.
    await draft(s, 'PATCH', '/2026-10/layout', {
      section: 'expense',
      groups: [{ id: group(d, 'Dom').id, lineIds: [] }],
      ungroupedLineIds: d.lines
        .filter((item) => item.flow === 'expense' && !item.isExcluded)
        .map((item) => item.id),
    });
    d = await draft(s, 'PATCH', `/2026-10/lines/${power}`, { isExcluded: false });
    expect(expenses(d)[0]).toEqual(['Prąd', 'Dom']);
  });
});

describe('PATCH …/layout (07 §13.10)', () => {
  it('zapisuje kolejność grup i linii jednej sekcji', async () => {
    const s = await seeded();
    let d = await draft(s, 'POST', '/2026-10/groups', { section: 'expense', name: 'Dom' }, 201);
    d = await draft(s, 'POST', '/2026-10/groups', { section: 'expense', name: 'Raty' }, 201);
    const id = (name: string): string => line(d, name).id;
    d = await draft(s, 'PATCH', '/2026-10/layout', {
      section: 'expense',
      groups: [
        { id: group(d, 'Raty').id, lineIds: [id('Rata')] },
        { id: group(d, 'Dom').id, lineIds: [id('Prąd'), id('Czynsz')] },
      ],
      ungroupedLineIds: [id('Prezent'), id('Jedzenie')],
    });
    expect(d.groups.map((item) => item.name)).toEqual(['Raty', 'Dom']);
    expect(expenses(d)).toEqual([
      ['Rata', 'Raty'],
      ['Prąd', 'Dom'],
      ['Czynsz', 'Dom'],
      ['Prezent', null],
      ['Jedzenie', null],
    ]);
    // Inne sekcje nietknięte.
    expect(line(d, 'Pensja').groupId).toBeNull();
    // Odczyt daje ten sam układ.
    expect(expenses(await draft(s, 'GET', '/2026-10'))).toEqual(expenses(d));
  });

  it('układ bez linii, z linią dwa razy, z obcą grupą albo bez grupy sekcji → 422', async () => {
    const s = await seeded();
    const d = await draft(s, 'POST', '/2026-10/groups', { section: 'expense', name: 'Dom' }, 201);
    const all = expenses(d).map(([name]) => line(d, name).id);
    const home = group(d, 'Dom').id;
    const bodies = [
      { section: 'expense', groups: [{ id: home, lineIds: [] }], ungroupedLineIds: all.slice(1) },
      {
        section: 'expense',
        groups: [{ id: home, lineIds: [all[0]] }],
        ungroupedLineIds: all,
      },
      { section: 'expense', groups: [], ungroupedLineIds: all },
      {
        section: 'expense',
        groups: [
          { id: home, lineIds: [] },
          { id: home, lineIds: [] },
        ],
        ungroupedLineIds: all,
      },
      {
        section: 'expense',
        groups: [
          { id: home, lineIds: [] },
          { id: newId(), lineIds: [] },
        ],
        ungroupedLineIds: all,
      },
      {
        section: 'expense',
        groups: [{ id: home, lineIds: [] }],
        ungroupedLineIds: [...all, line(d, 'Pensja').id],
      },
    ];
    for (const body of bodies) {
      const response = await call(s, 'PATCH', '/2026-10/layout', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(422);
      expect(response.body).toContain('odśwież ekran');
    }
  });

  it('szkic minionego miesiąca — układ i grupy tylko do odczytu (409)', async () => {
    const s = await seeded();
    const d = await draft(s, 'POST', '/2026-10/groups', { section: 'expense', name: 'Dom' }, 201);
    s.clock.advance(Date.parse('2026-11-02T10:00:00.000Z') - NOW.getTime());
    // Token z chwili startu wygasł — podpisujemy nowy dla tej samej osoby.
    const token = await signAccessToken(
      testConfig(),
      { sub: s.home.userId, hid: s.home.householdId, sid: newId() },
      s.clock.now(),
    );
    s.home = { ...s.home, headers: { ...s.home.headers, authorization: `Bearer ${token}` } };
    const home = group(d, 'Dom').id;
    const attempts: [Parameters<typeof call>[1], string, object | undefined][] = [
      ['POST', '/2026-10/groups', { section: 'expense', name: 'Raty' }],
      ['POST', '/2026-10/groups/by-origin', { section: 'expense' }],
      ['PATCH', `/2026-10/groups/${home}`, { name: 'Mieszkanie' }],
      ['DELETE', `/2026-10/groups/${home}`, undefined],
      [
        'PATCH',
        '/2026-10/layout',
        { section: 'expense', groups: [{ id: home, lineIds: [] }], ungroupedLineIds: [] },
      ],
    ];
    for (const [method, url, body] of attempts) {
      const response = await call(s, method, url, body);
      expect(response.statusCode, `${method} ${url}`).toBe(409);
    }
    // Odczyt dalej pokazuje grupy.
    expect((await draft(s, 'GET', '/2026-10')).groups).toHaveLength(1);
  });

  it('bez tokenu → 401', async () => {
    const s = await seeded();
    const response = await s.app.app.inject({
      method: 'PATCH',
      url: `${BASE}/2026-10/layout`,
      headers: CSRF_HEADER,
      payload: { section: 'expense', groups: [], ungroupedLineIds: [] },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST …/groups/by-origin — szybki start', () => {
  it('Stałe i Zmienne bez pustych Planowanych; druga próba → 422', async () => {
    const s = await seeded();
    const d = await draft(s, 'POST', '/2026-10/groups/by-origin', { section: 'expense' }, 201);
    expect(d.groups.map((item) => item.name)).toEqual(['Stałe', 'Zmienne']);
    expect(expenses(d)).toEqual([
      ['Czynsz', 'Stałe'],
      ['Prąd', 'Stałe'],
      ['Rata', 'Stałe'],
      ['Jedzenie', 'Zmienne'],
      ['Prezent', 'Zmienne'],
    ]);
    const again = await call(s, 'POST', '/2026-10/groups/by-origin', { section: 'expense' });
    expect(again.statusCode).toBe(422);
    expect(again.body).toContain('ma już grupy');
  });

  it('sekcja bez pozycji → 422', async () => {
    const s = await seeded();
    const response = await call(s, 'POST', '/2026-10/groups/by-origin', { section: 'pools' });
    expect(response.statusCode).toBe(422);
  });
});

describe('układ przechodzi na nowy szkic (07 §13.10)', () => {
  /**
   * Październik z grupami: Dom (prąd, czynsz), Raty (rata), pusta grupa i jedzenie bez grupy.
   *
   * @returns Kontekst z ułożonym październikiem.
   */
  async function arranged(): Promise<Setup> {
    const s = await seeded();
    let d = await draft(s, 'POST', '/2026-10/groups', { section: 'expense', name: 'Dom' }, 201);
    d = await draft(s, 'POST', '/2026-10/groups', { section: 'expense', name: 'Raty' }, 201);
    d = await draft(s, 'POST', '/2026-10/groups', { section: 'expense', name: 'Pusta' }, 201);
    const id = (name: string): string => line(d, name).id;
    await draft(s, 'PATCH', '/2026-10/layout', {
      section: 'expense',
      groups: [
        { id: group(d, 'Dom').id, lineIds: [id('Prąd'), id('Czynsz')] },
        { id: group(d, 'Raty').id, lineIds: [id('Rata')] },
        { id: group(d, 'Pusta').id, lineIds: [] },
      ],
      ungroupedLineIds: [id('Jedzenie'), id('Prezent')],
    });
    return s;
  }

  it('„Utwórz z danych": te same grupy i miejsca; nowa reguła na końcu bez grupy', async () => {
    const s = await arranged();
    insertRule(s, { name: 'Siłownia', amountMinor: 149_00, startMonth: '2026-11' });
    const november = await draft(s, 'POST', '/2026-11', {}, 201);
    expect(november.groups.map((item) => [item.name, item.section, item.sortOrder])).toEqual([
      ['Dom', 'expense', 0],
      ['Raty', 'expense', 1],
      ['Pusta', 'expense', 2],
    ]);
    // Nowe identyfikatory grup — listopad nie dzieli grup z październikiem.
    const october = await draft(s, 'GET', '/2026-10');
    expect(november.groups.map((item) => item.id)).not.toContain(group(october, 'Dom').id);
    expect(expenses(november)).toEqual([
      ['Prąd', 'Dom'],
      ['Czynsz', 'Dom'],
      ['Rata', 'Raty'],
      ['Siłownia', null],
    ]);
  });

  it('„Skopiuj z października": linie własne wracają na swoje miejsca', async () => {
    const s = await arranged();
    const november = await draft(s, 'POST', '/2026-11', { copyManualFrom: '2026-10' }, 201);
    expect(expenses(november)).toEqual([
      ['Prąd', 'Dom'],
      ['Czynsz', 'Dom'],
      ['Rata', 'Raty'],
      ['Jedzenie', null],
      ['Prezent', null],
    ]);
  });

  it('„Zacznij od zera": puste grupy skopiowane', async () => {
    const s = await arranged();
    const november = await draft(s, 'POST', '/2026-11', { fillFromSources: false }, 201);
    expect(november.lines).toEqual([]);
    expect(november.groups.map((item) => item.name)).toEqual(['Dom', 'Raty', 'Pusta']);
  });

  it('układ z najbliższego wcześniejszego planu, nie z późniejszego', async () => {
    const s = await arranged();
    await draft(s, 'POST', '/2026-12', { fillFromSources: false }, 201);
    await draft(s, 'POST', '/2026-12/groups', { section: 'expense', name: 'Grudniowa' }, 201);
    const november = await draft(s, 'POST', '/2026-11', { fillFromSources: false }, 201);
    expect(november.groups.map((item) => item.name)).toEqual(['Dom', 'Raty', 'Pusta']);
  });

  it('linia ze średniej trafia do grupy po kategorii i nazwie', async () => {
    const s = await setup();
    const food = insertCategory(s.app.db, s.home, { name: 'Jedzenie', kind: 'expense' });
    await draft(s, 'POST', '/2026-10', { averageLines: [{ categoryId: food }] }, 201);
    const d = await draft(s, 'GET', '/2026-10');
    await draft(
      s,
      'POST',
      '/2026-10/groups',
      { section: 'expense', name: 'Codzienne', lineIds: [line(d, 'Jedzenie').id] },
      201,
    );
    const november = await draft(
      s,
      'POST',
      '/2026-11',
      { averageLines: [{ categoryId: food }] },
      201,
    );
    expect(expenses(november)).toEqual([['Jedzenie', 'Codzienne']]);
  });
});
