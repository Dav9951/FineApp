import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Home, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, TEST_SESSION } from '../../../test/render-screen.js';
import * as authApi from '../../features/auth/api.js';
import * as settingsApi from '../../features/settings/api.js';
import { THEME_STORAGE_KEY } from '../../lib/theme.js';
import {
  Sidebar,
  SIDEBAR_FOLDED_KEY,
  SIDEBAR_STORAGE_KEY,
  useSidebarCollapsed,
} from './sidebar.js';

/**
 * Testy paska bocznego: zwijanie do szyny ikon (ADR-067), profil, klaster ustawień,
 * przełącznik motywu i „Wyloguj" (ADR-082).
 */

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const primary = [{ to: '/m/2026-09', label: 'Miesiąc', icon: Home }] as const;
const planning = [
  { to: '/accounts', label: 'Konta', icon: Home, nested: true },
  { to: '/budget', label: 'Budżet', icon: Home, nested: true },
] as const;
const settings = [{ to: '/settings', label: 'Ustawienia', icon: Settings }] as const;

/**
 * Pasek sterowany prawdziwym hookiem stanu.
 *
 * @returns Drzewo testowe.
 */
function Harness(): ReactNode {
  const { collapsed, toggle } = useSidebarCollapsed();
  return (
    <Sidebar
      collapsed={collapsed}
      onToggleCollapsed={toggle}
      planning={planning}
      primary={primary}
      settings={settings}
    />
  );
}

/** Domownicy: zalogowany Adam i Basia. */
function mockMembers(): void {
  vi.spyOn(settingsApi, 'fetchSettings').mockResolvedValue({
    household: TEST_SESSION.household,
    users: [
      { ...TEST_SESSION.user, isCurrent: true },
      {
        id: '01J9ZQK8WQ2222222222222222',
        email: 'basia@example.com',
        displayName: 'Basia',
        avatarColor: null,
        isCurrent: false,
        lastLoginAt: null,
      },
    ],
    appVersion: '0.0.0-test',
  });
}

/**
 * Renderuje pasek z sesją testową.
 *
 * @returns Router z testu.
 */
function renderSidebar(): ReturnType<typeof renderScreen> {
  mockMembers();
  return renderScreen('/m/2026-09', [{ path: '*', element: <Harness /> }]);
}

describe('Sidebar', () => {
  it('złożona grupa pokazuje tylko bieżącą stronę; złożenie zapamiętane', async () => {
    const user = userEvent.setup();
    mockMembers();
    renderScreen('/budget/2026-11', [{ path: '*', element: <Harness /> }]);
    const header = await screen.findByRole('button', { name: 'Planowanie' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Konta' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Budżet' })).toBeInTheDocument();
    expect(window.localStorage.getItem(SIDEBAR_FOLDED_KEY)).toBe('["Planowanie"]');
    await user.click(header);
    expect(screen.getByRole('link', { name: 'Konta' })).toBeInTheDocument();
  });

  it('profil: inicjały, gospodarstwo nad imieniem, drugi domownik; prowadzi do Ustawień', async () => {
    renderSidebar();
    const profile = await screen.findByRole('link', {
      name: 'Profil: Adam, gospodarstwo Dom, razem z: Basia',
    });
    expect(profile).toHaveAttribute('href', '/settings');
    expect(within(profile).getByText('Dom')).toBeInTheDocument();
    expect(within(profile).getByText('A')).toBeInTheDocument();
    expect(within(profile).getByText('B')).toBeInTheDocument();
  });

  it('zwija się, zostawia nazwę pozycji dla czytnika i zapamiętuje stan', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(await screen.findByRole('button', { name: 'Zwiń pasek boczny' }));
    expect(screen.getByRole('link', { name: 'Miesiąc' })).toHaveAttribute('title', 'Miesiąc');
    expect(screen.queryByText('Planowanie')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wyloguj' })).toHaveAttribute('title', 'Wyloguj');
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('collapsed');
    expect(screen.getByRole('button', { name: 'Rozwiń pasek boczny' })).toBeInTheDocument();
  });

  it('przełącznik motywu: dwa pola, wybór zapisany', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const group = await screen.findByRole('group', { name: 'Motyw' });
    await user.click(within(group).getByRole('button', { name: 'Motyw jasny' }));
    expect(within(group).getByRole('button', { name: 'Motyw jasny' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    await user.click(within(group).getByRole('button', { name: 'Motyw ciemny' }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('„Wyloguj" kończy sesję', async () => {
    const user = userEvent.setup();
    const logout = vi.spyOn(authApi, 'logout').mockResolvedValue(undefined);
    renderSidebar();
    await user.click(await screen.findByRole('button', { name: 'Wyloguj' }));
    await waitFor(() => {
      expect(logout).toHaveBeenCalled();
    });
  });
});
