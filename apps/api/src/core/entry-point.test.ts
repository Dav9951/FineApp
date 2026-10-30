import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isEntryPoint } from './entry-point.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fineapp entry '));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isEntryPoint', () => {
  it('rozpoznaje skrypt po ścieżce ze spacją (kodowanie jak w loaderze ESM)', () => {
    const script = join(dir, 'migrate.js');
    writeFileSync(script, '');
    const url = pathToFileURL(script).href;

    expect(url).toContain('%20');
    expect(`file://${script}` === url).toBe(false);
    expect(isEntryPoint(url, script)).toBe(true);
  });

  it('rozpoznaje skrypt uruchomiony przez dowiązanie symboliczne', () => {
    const script = join(dir, 'migrate.js');
    const link = join(dir, 'link.js');
    writeFileSync(script, '');
    symlinkSync(script, link);

    expect(isEntryPoint(pathToFileURL(script).href, link)).toBe(true);
  });

  it('zwraca false przy imporcie z innego punktu wejścia', () => {
    const script = join(dir, 'migrate.js');
    writeFileSync(script, '');

    expect(isEntryPoint(pathToFileURL(script).href, join(dir, 'vitest.mjs'))).toBe(false);
    expect(isEntryPoint(pathToFileURL(script).href, undefined)).toBe(false);
  });
});
