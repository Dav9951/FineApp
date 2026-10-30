import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findEnvFile, loadEnvFile } from './env-file.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fineapp-env-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), '');
  mkdirSync(join(root, 'apps', 'api'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.FINEAPP_ENV_FILE_TEST;
});

describe('findEnvFile', () => {
  it('znajduje .env w korzeniu repozytorium, gdy pnpm uruchamia skrypt z apps/api', () => {
    writeFileSync(join(root, '.env'), '');

    expect(findEnvFile(join(root, 'apps', 'api'))).toBe(join(root, '.env'));
  });

  it('bliższy .env ma pierwszeństwo', () => {
    writeFileSync(join(root, '.env'), '');
    writeFileSync(join(root, 'apps', 'api', '.env'), '');

    expect(findEnvFile(join(root, 'apps', 'api'))).toBe(join(root, 'apps', 'api', '.env'));
  });

  it('nie wychodzi ponad korzeń repozytorium', () => {
    const nested = join(root, 'repo');
    mkdirSync(join(nested, 'apps'), { recursive: true });
    writeFileSync(join(nested, 'pnpm-workspace.yaml'), '');
    writeFileSync(join(root, '.env'), '');

    expect(findEnvFile(join(nested, 'apps'))).toBeNull();
  });
});

describe('loadEnvFile', () => {
  it('wczytuje zmienne, ale nie nadpisuje ustawionych w środowisku', () => {
    writeFileSync(join(root, '.env'), 'FINEAPP_ENV_FILE_TEST=z-pliku\n');

    expect(loadEnvFile(join(root, 'apps', 'api'))).toBe(join(root, '.env'));
    expect(process.env.FINEAPP_ENV_FILE_TEST).toBe('z-pliku');

    process.env.FINEAPP_ENV_FILE_TEST = 'ze-srodowiska';
    loadEnvFile(join(root, 'apps', 'api'));
    expect(process.env.FINEAPP_ENV_FILE_TEST).toBe('ze-srodowiska');
  });

  it('bez pliku nie robi nic (obraz Dockera)', () => {
    expect(loadEnvFile(join(root, 'apps', 'api'))).toBeNull();
  });
});
