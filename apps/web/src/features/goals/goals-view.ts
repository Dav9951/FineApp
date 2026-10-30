import type { GoalDto, GoalKind, GoalPurpose, MonthKey } from '@fineapp/shared';
import {
  Car,
  GraduationCap,
  Hammer,
  Home,
  Landmark,
  Plane,
  Shield,
  Target,
  type LucideIcon,
} from 'lucide-react';

/**
 * Czyste reguły ekranu celów — bez Reacta i bez sieci
 * ([06 §3.5](../../../../../plans/06-ui-views.md#35-cele--goals), `F5-5`).
 *
 * Kwoty nie są tu formatowane: tekst obok kwoty składa komponent z `<Money>` (reguła
 * wizualna z `CLAUDE.md`). Tutaj powstaje, **co** powiedzieć.
 */

/** Etykiety przeznaczeń celu. */
export const GOAL_PURPOSE_LABEL: Readonly<Record<GoalPurpose, string>> = {
  down_payment: 'Wkład własny',
  emergency_fund: 'Poduszka bezpieczeństwa',
  vacation: 'Wakacje',
  car: 'Samochód',
  renovation: 'Remont',
  retirement: 'Emerytura',
  education: 'Edukacja',
  custom: 'Inny',
};

/** Kolejność przeznaczeń w formularzu. */
export const GOAL_PURPOSE_ORDER: readonly GoalPurpose[] = [
  'down_payment',
  'emergency_fund',
  'vacation',
  'car',
  'renovation',
  'retirement',
  'education',
  'custom',
];

/** Ikony przeznaczeń — glif 1,5 px jak w całej aplikacji (15 §6). */
export const GOAL_PURPOSE_ICON: Readonly<Record<GoalPurpose, LucideIcon>> = {
  down_payment: Home,
  emergency_fund: Shield,
  vacation: Plane,
  car: Car,
  renovation: Hammer,
  retirement: Landmark,
  education: GraduationCap,
  custom: Target,
};

/** Etykiety rodzaju celu — zakładki ekranu. */
export const GOAL_KIND_LABEL: Readonly<Record<GoalKind, string>> = {
  savings: 'Oszczędności',
  investment: 'Inwestycje',
};

/**
 * Ikona celu z przeznaczenia; bez przeznaczenia — tarcza celu.
 *
 * @param goal - Cel.
 * @param goal.purpose - Przeznaczenie.
 * @returns Komponent ikony.
 */
export function goalIcon(goal: Pick<GoalDto, 'purpose'>): LucideIcon {
  return goal.purpose === null ? Target : GOAL_PURPOSE_ICON[goal.purpose];
}

/**
 * Procent z jednym miejscem po przecinku — tak pokazujemy przeliczenie (07 §3, pkt 3:
 * „17,0%", nie cztery cyfry). Minus typograficzny dla wartości ujemnych.
 *
 * @param bps - Udział w punktach bazowych.
 * @returns Tekst, np. `17,0%`.
 */
export function percentOneDecimal(bps: number): string {
  const text = (Math.abs(bps) / 100).toLocaleString('pl-PL', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${bps < 0 ? '−' : ''}${text}%`;
}

/**
 * Procent bez miejsc po przecinku — przy pasku postępu celu („35%").
 *
 * @param bps - Udział w punktach bazowych.
 * @returns Tekst, np. `35%`.
 */
export function percentWhole(bps: number): string {
  return `${String(Math.round(bps / 100))}%`;
}

/** Stan wpłat w miesiącu — etykieta pod paskiem (15 §5: „✓ wrzesień", „⚠ brak wpłaty"). */
export type GoalMonthState =
  /** Plan wykonany. */
  | 'met'
  /** Wpłacono, ale mniej niż plan. */
  | 'partial'
  /** Plan jest, wpłaty nie było. */
  | 'missing'
  /** Z celu wypłacono więcej, niż wpłacono. */
  | 'withdrawn'
  /** Bez planu, z wpłatą. */
  | 'free'
  /** Bez planu i bez wpłaty — nic do powiedzenia. */
  | 'idle';

/**
 * Ocenia wpłaty celu w miesiącu.
 *
 * Plan zerowy (procent wpływów przy braku wpływów) nie jest „brakiem wpłaty" — nie było
 * czego wpłacić, więc cel bez wpłat jest wtedy `idle`, a nie ostrzeżeniem.
 *
 * @param contribution - Plan i wpłaty miesiąca.
 * @returns Stan.
 */
export function goalMonthState(contribution: GoalDto['contribution']): GoalMonthState {
  const { plannedAmountMinor: planned, contributedThisMonthMinor: paid } = contribution;
  if (paid < 0) return 'withdrawn';
  if (planned === null || planned === 0) return paid > 0 ? 'free' : 'idle';
  if (paid >= planned) return 'met';
  return paid > 0 ? 'partial' : 'missing';
}

/** Linia prognozy na karcie celu. */
export type GoalProjectionLine =
  | { readonly kind: 'achieved' }
  /** „Przy tym tempie: grudzień 2029". */
  | { readonly kind: 'pace'; readonly month: MonthKey }
  /** „Przy tym tempie cel nie zostanie osiągnięty" — brak tempa albo ponad sto lat. */
  | { readonly kind: 'never' }
  | { readonly kind: 'none' };

/**
 * Linia prognozy: kiedy cel zostanie osiągnięty przy bieżącym tempie (07 §4.2).
 *
 * @param goal - Cel.
 * @returns Linia do pokazania.
 */
export function projectionLine(
  goal: Pick<GoalDto, 'status' | 'remainingMinor' | 'projection'>,
): GoalProjectionLine {
  if (goal.status === 'achieved' || goal.remainingMinor === 0) return { kind: 'achieved' };
  if (goal.remainingMinor === null) return { kind: 'none' };
  const month = goal.projection.projectedCompletionMonth;
  return month === null ? { kind: 'never' } : { kind: 'pace', month };
}

/**
 * Ostrzeżenie o terminie (07 §4.2): konkretna liczba, na którą można zareagować —
 * „Cel na czerwiec 2028 → potrzeba 3 714 zł/mies.", nie samo „nie zdążysz".
 *
 * @param goal - Cel.
 * @returns Miesiąc terminu i wymagana wpłata albo `null`, gdy tempo wystarcza.
 */
export function deadlineWarning(
  goal: Pick<GoalDto, 'status' | 'targetDate' | 'projection'>,
): { readonly targetMonth: MonthKey; readonly requiredMinor: number } | null {
  const required = goal.projection.requiredMonthlyToHitTargetDateMinor;
  if (goal.status === 'achieved' || goal.targetDate === null || required === null) return null;
  if (goal.projection.isOnTrack !== false) return null;
  return { targetMonth: goal.targetDate.slice(0, 7), requiredMinor: required };
}

/**
 * Cele jednego rodzaju w kolejności priorytetu: aktywne, wstrzymane, osiągnięte, archiwum.
 *
 * @param goals - Cele z API (już po priorytecie).
 * @param kind - Rodzaj z zakładki.
 * @returns Cele do pokazania.
 */
export function goalsOfKind(goals: readonly GoalDto[], kind: GoalKind): GoalDto[] {
  const rank: Readonly<Record<GoalDto['status'], number>> = {
    active: 0,
    paused: 1,
    achieved: 2,
    archived: 3,
  };
  return goals
    .map((goal, index) => ({ goal, index }))
    .filter(({ goal }) => goal.kind === kind)
    .sort((a, b) => rank[a.goal.status] - rank[b.goal.status] || a.index - b.index)
    .map(({ goal }) => goal);
}

/**
 * Plan i wpłaty miesiąca w jednym rodzaju celów — „Zaplanowano · wpłacono" (06 §3.5).
 *
 * @param goals - Cele jednego rodzaju.
 * @returns Sumy celów aktywnych.
 */
export function monthTotals(goals: readonly GoalDto[]): {
  readonly plannedMinor: number;
  readonly contributedMinor: number;
} {
  const active = goals.filter((goal) => goal.status === 'active');
  return {
    plannedMinor: active.reduce(
      (sum, goal) => sum + (goal.contribution.plannedAmountMinor ?? 0),
      0,
    ),
    contributedMinor: active.reduce(
      (sum, goal) => sum + goal.contribution.contributedThisMonthMinor,
      0,
    ),
  };
}
