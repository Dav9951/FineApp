import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind spięty z tokenami CSS z `src/styles/tokens.css`.
 *
 * Każdy kolor jest mapowany przez `hsl(var(--token))`, a nie przez wartość — dzięki temu
 * jedna klasa działa w obu motywach i można użyć modyfikatora przezroczystości
 * (`bg-warning/12`, `stroke-muted-foreground/45`).
 *
 * Wartości i uzasadnienia: `plans/15-design-system.md`. Ten plik ma mapować komplet
 * tokenów — token bez odpowiednika tutaj kusi, żeby sięgnąć po surowy kolor.
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        scrim: 'hsl(var(--scrim))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Semantyka finansowa — zestaw wymuszony przez domenę (15 §3.2).
        income: 'hsl(var(--income))',
        expense: 'hsl(var(--expense))',
        savings: 'hsl(var(--savings))',
        'chart-actual': 'hsl(var(--chart-actual))',
        'chart-plan': 'hsl(var(--chart-plan))',
        investment: 'hsl(var(--investment))',
        debt: 'hsl(var(--debt))',
        // Komunikaty.
        warning: 'hsl(var(--warning))',
        success: 'hsl(var(--success))',
        danger: 'hsl(var(--danger))',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-sm)',
        md: 'calc(var(--radius) - 4px)',
        lg: 'var(--radius)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        // Kafle dashboardu nie mają cienia — rozdziela je linia i odstęp (15 §3.5).
        sheet: 'var(--shadow-sheet)',
        fab: 'var(--shadow-fab)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        numeric: 'var(--font-numeric)',
      },
      fontSize: {
        // Skala z 15 §3.3 — para [rozmiar, interlinia].
        caption: ['12px', '1.35'],
        meta: ['13px', '1.4'],
        sm: ['14px', '1.45'],
        base: ['16px', '1.5'],
        lg: ['20px', '1.3'],
        xl: ['24px', '1.2'],
        amount: ['32px', '1.1'],
        hero: ['40px', '1.05'],
      },
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-top': 'env(safe-area-inset-top)',
        // Minimalny cel dotykowy (15 §2.6) jako nazwana wartość, żeby nie zgadywać.
        touch: '44px',
        // Wysokość dolnego paska zakładek — FAB i toast liczą od niej pozycję (15 §3.4).
        tabbar: 'var(--tabbar-height)',
      },
      maxWidth: {
        content: '1200px',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
