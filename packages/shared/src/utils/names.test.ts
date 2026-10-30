import { describe, expect, it } from 'vitest';

import { foldForSearch, sameName } from './names.js';

describe('sameName', () => {
  it('ignoruje wielkość liter także w polskich znakach i białe znaki na brzegach', () => {
    expect(sameName('Żabka', ' żabka ')).toBe(true);
    expect(sameName('ŁÓDŹ', 'łódź')).toBe(true);
  });

  it('nie zrównuje liter z ogonkiem z literami bez', () => {
    expect(sameName('Łódź', 'Lodz')).toBe(false);
  });
});

describe('foldForSearch', () => {
  it('zrównuje wielkość liter i polskie znaki z ich odpowiednikami bez ogonków', () => {
    expect(foldForSearch('Żabka')).toBe('zabka');
    expect(foldForSearch('ŁÓDŹ Częstochowa')).toBe('lodz czestochowa');
    expect(foldForSearch('ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ')).toBe('acelnoszz acelnoszz');
  });

  it('zostawia cyfry i znaki interpunkcyjne', () => {
    expect(foldForSearch('Lidl #123, 50%')).toBe('lidl #123, 50%');
  });
});
