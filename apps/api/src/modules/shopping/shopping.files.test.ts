import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { testConfig, testDb } from '../../../test/build-app.js';
import { householdFixture } from '../../../test/factories.js';
import { fixedClock } from '../../core/clock.js';
import { newId } from '../../core/id.js';
import type { DbHandle } from '../../db/client.js';
import { shoppingImports, shoppingLists } from '../../db/schema/shopping.js';
import {
  IMPORT_FILE_RETENTION_MS,
  parseImportFilePaths,
  purgeStaleImportFiles,
} from './shopping.files.js';

/** Testy sprzątania plików importów list zakupów (I-31, ADR-094). */

const NOW = new Date('2026-11-22T10:00:00.000Z');
const UPLOAD_DIR = testConfig().uploads.dir;

let handle: DbHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

describe('parseImportFilePaths', () => {
  it('czyta tablicę napisów, resztę pomija', () => {
    expect(parseImportFilePaths('["a.jpg", 3, "b.jpg"]')).toEqual(['a.jpg', 'b.jpg']);
    expect(parseImportFilePaths('{}')).toEqual([]);
    expect(parseImportFilePaths('nie-json')).toEqual([]);
  });
});

describe('purgeStaleImportFiles', () => {
  it('usuwa pliki zakończonych importów starszych niż 7 dni; świeże i w toku zostają', async () => {
    handle = testDb();
    const home = await householdFixture(handle, testConfig(), NOW);
    const at = NOW.getTime();
    const listId = newId();
    handle.db
      .insert(shoppingLists)
      .values({
        id: listId,
        householdId: home.householdId,
        name: 'L',
        createdAt: at,
        updatedAt: at,
      })
      .run();

    const old = at - IMPORT_FILE_RETENTION_MS - 1;
    const cases = [
      { status: 'failed', updatedAt: old, purge: true },
      { status: 'committed', updatedAt: old, purge: true },
      { status: 'failed', updatedAt: at, purge: false },
      { status: 'parsed', updatedAt: old, purge: false },
    ] as const;
    const rows = [];
    for (const [index, item] of cases.entries()) {
      const path = `shopping/2026/11/purge-${String(index)}.jpg`;
      const absolute = join(UPLOAD_DIR, path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, 'jpeg');
      const id = newId();
      handle.db
        .insert(shoppingImports)
        .values({
          id,
          householdId: home.householdId,
          listId,
          kind: 'list_photo',
          input: 'image',
          status: item.status,
          filePaths: JSON.stringify([path]),
          createdBy: home.userId,
          createdAt: item.updatedAt,
          updatedAt: item.updatedAt,
        })
        .run();
      rows.push({ id, absolute, purge: item.purge });
    }

    const purged = await purgeStaleImportFiles({
      db: handle,
      clock: fixedClock(NOW),
      uploadDir: UPLOAD_DIR,
    });
    expect(purged).toBe(2);
    for (const row of rows) {
      const left = handle.db
        .select()
        .from(shoppingImports)
        .all()
        .find((r) => r.id === row.id);
      if (row.purge) {
        await expect(access(row.absolute)).rejects.toThrow();
        expect(left?.filePaths).toBe('[]');
      } else {
        await expect(access(row.absolute)).resolves.toBeUndefined();
        expect(left?.filePaths).not.toBe('[]');
      }
    }
    expect(
      await purgeStaleImportFiles({ db: handle, clock: fixedClock(NOW), uploadDir: UPLOAD_DIR }),
    ).toBe(0);
  });
});
