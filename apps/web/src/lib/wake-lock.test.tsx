import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWakeLock } from './wake-lock.js';

/** „Nie wygaszaj ekranu" (06 §3.15) — także wyścig szybkiego włącz/wyłącz. */

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock');
});

describe('useWakeLock', () => {
  it('bez API przełącznik jest niedostępny', () => {
    const { result } = renderHook(() => useWakeLock());
    expect(result.current.supported).toBe(false);
  });

  it('blokada, która przyszła po wyłączeniu, jest zwalniana od razu', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    let resolve: (value: { release: () => Promise<void> }) => void = () => undefined;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: vi.fn(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        ),
      },
    });
    const { result } = renderHook(() => useWakeLock());
    expect(result.current.supported).toBe(true);
    act(() => {
      result.current.toggle();
    });
    expect(result.current.active).toBe(true);
    act(() => {
      result.current.toggle();
    });
    await act(async () => {
      resolve({ release });
      await Promise.resolve();
    });
    expect(release).toHaveBeenCalledTimes(1);
  });
});
