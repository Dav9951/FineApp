import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '../../../test/render-screen.js';
import * as documentsApi from '../../features/scan/api.js';
import { AppShell } from './app-shell.js';

/**
 * Testy powłoki ([06 §2](../../../../../plans/06-ui-views.md#2-nawigacja)).
 *
 * jsdom nie liczy układu, więc sprawdzamy regułę, nie piksele: treść trasy siedzi
 * w kontenerze, który przycina poziomy nadmiar (ADR-074). Bez tego jeden za szeroki
 * element poszerzał na Androidzie obszar układu i FAB lądował za prawą krawędzią.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppShell', () => {
  it('treść trasy przycina poziomy nadmiar, a FAB jest poza nią', async () => {
    vi.spyOn(documentsApi, 'fetchAiUsage').mockRejectedValue(new Error('brak'));
    renderScreen('/x', [
      {
        path: '/',
        element: <AppShell />,
        children: [{ path: 'x', element: <p>Treść ekranu</p> }],
      },
    ]);

    const content = (await screen.findByText('Treść ekranu')).parentElement;
    // `relative`: `clip` przycina tylko elementy pozycjonowane względem kontenera —
    // absolutny tekst `sr-only` bez pozycjonowanego przodka uciekał spod przycięcia.
    expect(content).toHaveClass('overflow-x-clip', 'relative');
    // `hidden` zrobiłby z treści kontener przewijania i zepsułby `sticky`.
    expect(content).not.toHaveClass('overflow-x-hidden');

    const fab = screen.getByRole('button', { name: 'Dodaj transakcję' });
    expect(content?.contains(fab)).toBe(false);
  });
});
