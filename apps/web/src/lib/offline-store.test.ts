import { afterEach, describe, expect, it } from 'vitest';

import {
  claimOfflineStore,
  clearOfflineStore,
  readOffline,
  writeOffline,
} from './offline-store.js';

/** Magazyn offline należy do zalogowanej osoby (ADR-099). */

afterEach(() => {
  clearOfflineStore();
  window.localStorage.removeItem('inne');
});

describe('offline-store', () => {
  it('inna osoba na tym samym urządzeniu nie dostaje cudzych danych', () => {
    claimOfflineStore('A');
    writeOffline('shopping.outbox', [1]);
    claimOfflineStore('A');
    expect(readOffline('shopping.outbox')).toEqual([1]);
    claimOfflineStore('B');
    expect(readOffline('shopping.outbox')).toBeUndefined();
  });

  it('czyszczenie dotyka tylko własnych kluczy; uszkodzony JSON to brak wartości', () => {
    window.localStorage.setItem('inne', 'zostaje');
    window.localStorage.setItem('fineapp.offline.zle', '{');
    expect(readOffline('zle')).toBeUndefined();
    clearOfflineStore();
    expect(window.localStorage.getItem('inne')).toBe('zostaje');
    expect(window.localStorage.getItem('fineapp.offline.zle')).toBeNull();
  });
});
