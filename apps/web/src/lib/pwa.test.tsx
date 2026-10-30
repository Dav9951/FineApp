import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OfflineBanner } from '../components/layout/offline-banner.js';
import { captureInstallPrompt, isIos, useInstallOption, useOnline } from './pwa.js';

/**
 * Testy stanu PWA — `F8-3`: baner offline i instalacja
 * ([06 §5](../../../../plans/06-ui-views.md#5-zachowanie-mobilne--szczegóły)).
 */

/**
 * Ustawia `navigator.onLine` i rozsyła zdarzenie zmiany.
 *
 * @param online - Nowy stan sieci.
 */
function setOnline(online: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useOnline i OfflineBanner', () => {
  it('baner pojawia się bez sieci i znika po jej powrocie', () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();

    setOnline(false);
    expect(screen.getByRole('status')).toHaveTextContent('Brak połączenia');

    setOnline(true);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('hook oddaje bieżący stan', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(false);
  });
});

describe('isIos', () => {
  it('rozpoznaje iPhone i iPad, nie Androida', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true);
    expect(isIos('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe(true);
    expect(isIos('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe(false);
  });
});

describe('useInstallOption', () => {
  it('bez zdarzenia przeglądarki na desktopie — niedostępna', () => {
    const { result } = renderHook(() => useInstallOption());
    expect(result.current.kind).toBe('unavailable');
  });

  it('zapamiętane `beforeinstallprompt` daje przycisk; po wyborze znika', async () => {
    captureInstallPrompt();
    const { result } = renderHook(() => useInstallOption());

    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.kind).toBe('prompt');

    const option = result.current;
    if (option.kind !== 'prompt') throw new Error('brak opcji instalacji');
    let accepted = false;
    await act(async () => {
      accepted = await option.install();
    });
    expect(accepted).toBe(true);
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(result.current.kind).toBe('unavailable');
  });

  it('w oknie zainstalowanej aplikacji — nic do zrobienia', () => {
    window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    try {
      const { result } = renderHook(() => useInstallOption());
      expect(result.current.kind).toBe('installed');
    } finally {
      Reflect.deleteProperty(window, 'matchMedia');
    }
  });
});
