import { LogOut, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../features/auth/auth-context.js';
import { useSettings } from '../../features/settings/hooks/use-settings.js';
import { initials } from '../../features/transactions/history-view.js';
import { cn } from '../../lib/cn.js';
import { useTheme } from '../../lib/theme.js';

/**
 * Profil, przełącznik motywu i „Wyloguj" — wspólne dla paska bocznego i ekranu „Więcej"
 * ([06 §2](../../../../../plans/06-ui-views.md#2-nawigacja), ADR-082).
 *
 * Kółka mają kolor akcentu z tokenów, nie `avatarColor`: paleta awatarów nie ma jeszcze
 * tokenów, a surowych kolorów w interfejsie nie używamy (Z-43).
 */

/** Właściwości profilu. */
export interface ProfileBadgeProps {
  /** Same kółka — zwinięta szyna paska. */
  compact?: boolean;
  className?: string;
}

/**
 * Profil: inicjały, nazwa gospodarstwa nad imieniem i małe kółko drugiego domownika.
 * Prowadzi do Ustawień (imię, PIN, urządzenia).
 *
 * @param props - Właściwości komponentu.
 * @param props.compact - Same kółka.
 * @param props.className - Dodatkowe klasy.
 * @returns Odnośnik profilu albo nic przed zalogowaniem.
 */
export function ProfileBadge({ compact = false, className }: ProfileBadgeProps): ReactNode {
  const { user, household } = useAuth();
  const settings = useSettings();
  if (user === null) return null;
  const others = settings.data?.users.filter((member) => !member.isCurrent) ?? [];
  const partner = others[0];
  const label = [
    `Profil: ${user.displayName}`,
    household === null ? null : `gospodarstwo ${household.name}`,
    others.length === 0
      ? null
      : `razem z: ${others.map((member) => member.displayName).join(', ')}`,
  ]
    .filter((part) => part !== null)
    .join(', ');
  return (
    <Link
      aria-label={label}
      className={cn(
        'flex min-h-touch items-center gap-3 rounded-md p-1 transition-colors hover:bg-muted/60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        compact && 'justify-center',
        className,
      )}
      title={compact ? label : undefined}
      to="/settings"
    >
      <span aria-hidden="true" className="relative shrink-0">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/15 text-[15px] font-bold tracking-wide text-primary ring-1 ring-inset ring-primary/25">
          {initials(user.displayName)}
        </span>
        {partner === undefined ? null : (
          <span className="absolute -bottom-1 -right-1.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground ring-2 ring-background">
            {initials(partner.displayName).slice(0, 1)}
          </span>
        )}
      </span>
      {compact ? null : (
        <span aria-hidden="true" className="flex min-w-0 flex-col gap-0.5">
          {household === null ? null : (
            <span className="truncate text-[11px] font-semibold uppercase tracking-[.1em] text-muted-foreground">
              {household.name}
            </span>
          )}
          <span className="truncate text-base font-semibold">{user.displayName}</span>
        </span>
      )}
    </Link>
  );
}

/** Właściwości przełącznika motywu. */
export interface ThemeSwitchProps {
  /**
   * `full` — dwa pola z podpisami (ekran „Więcej"); `icons` — dwa pola z samymi ikonami
   * (rząd obok „Wyloguj" w pasku); `single` — jeden przycisk słońce / księżyc (szyna).
   */
  variant?: 'full' | 'icons' | 'single';
  className?: string;
}

/** Opcje przełącznika. */
const THEMES = [
  { value: 'light', label: 'Jasny', aria: 'Motyw jasny', icon: Sun },
  { value: 'dark', label: 'Ciemny', aria: 'Motyw ciemny', icon: Moon },
] as const;

/**
 * Przełącznik motywu: dwa pola z przesuwanym podkładem — stan widać bez czytania ikony.
 * Ustawia jawny wybór; „Systemowy" zostaje w Ustawieniach → Wygląd (ADR-067, ADR-082).
 *
 * @param props - Właściwości komponentu.
 * @param props.variant - Wielkość: z podpisami, same ikony albo jeden przycisk.
 * @param props.className - Dodatkowe klasy.
 * @returns Element przełącznika.
 */
export function ThemeSwitch({ variant = 'full', className }: ThemeSwitchProps): ReactNode {
  const theme = useTheme();
  const dark = theme.resolved === 'dark';
  if (variant === 'single') {
    const label = dark ? 'Włącz motyw jasny' : 'Włącz motyw ciemny';
    const Icon = dark ? Sun : Moon;
    return (
      <button
        aria-label={label}
        className={cn(
          'mx-auto grid h-touch w-touch place-items-center rounded-full bg-muted text-muted-foreground hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        onClick={theme.toggle}
        title={label}
        type="button"
      >
        <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
      </button>
    );
  }
  const iconsOnly = variant === 'icons';
  return (
    <div
      aria-label="Motyw"
      className={cn(
        'relative grid h-touch shrink-0 grid-cols-2 rounded-full bg-muted p-1',
        iconsOnly && 'w-[92px]',
        className,
      )}
      role="group"
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-card shadow-sm transition-transform duration-200 motion-reduce:transition-none',
          dark && 'translate-x-full',
        )}
      />
      {THEMES.map((option) => {
        const selected = theme.resolved === option.value;
        const Icon = option.icon;
        return (
          <button
            aria-label={iconsOnly ? option.aria : undefined}
            aria-pressed={selected}
            className={cn(
              'relative z-[1] flex items-center justify-center gap-1.5 rounded-full text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'font-semibold text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            key={option.value}
            onClick={() => {
              theme.setPreference(option.value);
            }}
            title={iconsOnly ? option.aria : undefined}
            type="button"
          >
            <Icon aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.5} />
            {iconsOnly ? null : option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Właściwości przycisku wylogowania. */
export interface LogoutButtonProps {
  /** Sama ikona — zwinięta szyna paska. */
  compact?: boolean;
  className?: string;
}

/**
 * „Wyloguj" w kolorze `--danger`, bez potwierdzenia — wylogowanie wraca jednym PIN-em
 * (ADR-082).
 *
 * @param props - Właściwości komponentu.
 * @param props.compact - Sama ikona.
 * @param props.className - Dodatkowe klasy.
 * @returns Przycisk.
 */
export function LogoutButton({ compact = false, className }: LogoutButtonProps): ReactNode {
  const { signOut } = useAuth();
  return (
    <button
      aria-label={compact ? 'Wyloguj' : undefined}
      className={cn(
        'flex min-h-touch w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-danger transition-colors hover:bg-danger/10',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        compact && 'justify-center px-0',
        className,
      )}
      onClick={() => {
        void signOut();
      }}
      title={compact ? 'Wyloguj' : undefined}
      type="button"
    >
      <LogOut aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={1.5} />
      {compact ? null : 'Wyloguj'}
    </button>
  );
}
