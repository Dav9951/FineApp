import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installStaleChunkReload,
  isStaleChunkError,
  reloadForStaleChunk,
  STALE_CHUNK_RELOAD_COOLDOWN_MS,
} from './stale-chunk.js';

/**
 * Testy odzyskiwania po wdrożeniu nowej wersji (ADR-090).
 */

/**
 * Pamięć w stylu `sessionStorage` na zwykłej mapie.
 *
 * @returns Obiekt z `getItem` i `setItem`.
 */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('isStaleChunkError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://fineapp.com.pl/assets/history-screen-awMuUaOc.js',
    'Importing a module script failed.',
    'error loading dynamically imported module: https://x/assets/a.js',
    'Unable to preload CSS for /assets/a.css',
  ])('rozpoznaje „%s"', (message) => {
    expect(isStaleChunkError(new TypeError(message))).toBe(true);
  });

  it('nie łapie innych błędów', () => {
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleChunkError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});

describe('reloadForStaleChunk', () => {
  it('przeładowuje za pierwszym razem', () => {
    const reload = vi.fn();
    expect(reloadForStaleChunk({ storage: memoryStorage(), reload, now: 1_000_000 })).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('nie wpada w pętlę: drugi błąd w oknie nie przeładowuje', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadForStaleChunk({ storage, reload, now: 1_000_000 });
    const again = reloadForStaleChunk({
      storage,
      reload,
      now: 1_000_000 + STALE_CHUNK_RELOAD_COOLDOWN_MS - 1,
    });
    expect(again).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('po upływie okna przeładowuje ponownie (kolejne wdrożenie)', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadForStaleChunk({ storage, reload, now: 1_000_000 });
    reloadForStaleChunk({ storage, reload, now: 1_000_000 + STALE_CHUNK_RELOAD_COOLDOWN_MS });
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('bez dostępnej pamięci nie przeładowuje', () => {
    const reload = vi.fn();
    const storage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    expect(reloadForStaleChunk({ storage, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('installStaleChunkReload', () => {
  it('na `vite:preloadError` tłumi błąd i zapisuje znacznik przeładowania', () => {
    // jsdom nie umie nawigować — przeładowanie kończy się tylko komunikatem w konsoli.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installStaleChunkReload();
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(window.sessionStorage.getItem('fineapp:stale-chunk-reload-at')).not.toBeNull();
  });
});
