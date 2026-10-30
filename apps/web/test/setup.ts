import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Wspólne przygotowanie testów frontu.
 *
 * `cleanup` po każdym teście jest obowiązkowe: Testing Library montuje drzewo
 * w `document.body` i bez sprzątania kolejny test widzi elementy poprzedniego,
 * przez co `getByRole` zaczyna zgłaszać wieloznaczność zamiast prawdziwego błędu.
 */
afterEach(() => {
  cleanup();
});

/**
 * `ResizeObserver` — jsdom go nie ma, a Radix `Switch` wewnątrz `<form>` mierzy nim
 * ukryte pole formularza. Obserwator bez działania wystarcza: w teście nic się nie
 * rozciąga, a pomiar służy wyłącznie wyglądowi.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
