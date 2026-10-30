import type { Config } from '../../core/config.js';

/**
 * Limit prób logowania i blokada wykładnicza
 * ([09 §2.5](../../../../../../plans/09-security-auth.md#25-limitowanie-prób)).
 *
 * Sześciocyfrowy PIN to milion kombinacji. Sam argon2id (~150 ms na próbę) daje
 * atakującemu kilkanaście lat, ale dopiero limit prób sprawia, że **nie opłaca się
 * nawet zacząć**. To jest druga z trzech warstw z `09 §2.1`.
 */

/** Pojedyncza reguła: ile nieudanych prób w jakim oknie i na jak długo blokuje. */
export interface AttemptRule {
  /** Zakres, którego dotyczy reguła. */
  scope: 'email' | 'ip';
  /** Okno obserwacji w sekundach. */
  windowSeconds: number;
  /** Liczba nieudanych prób, przy której reguła się uruchamia. */
  threshold: number;
  /** Długość blokady liczona od **ostatniej** nieudanej próby. */
  blockSeconds: number;
}

/** Sekunda, minuta, godzina i doba w sekundach — żeby tabela reguł czytała się sama. */
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Buduje tabelę reguł z `09 §2.5`.
 *
 * Pierwszy próg bierze się z konfiguracji (`AUTH_MAX_FAILED_ATTEMPTS`,
 * `AUTH_LOCKOUT_SECONDS`), bo to jedyny, który realnie się stroi. Progi dalsze są stałe:
 * to one czynią blokadę **wykładniczą** i ich strojenie przez zmienną środowiskową
 * skończyłoby się wyłączeniem ochrony przez pomyłkę.
 *
 * @param config - Konfiguracja aplikacji.
 * @returns Reguły w kolejności od najkrótszego okna.
 */
export function attemptRules(config: Config): readonly AttemptRule[] {
  const { maxFailedAttempts, lockoutSeconds } = config.auth;
  return [
    {
      scope: 'email',
      windowSeconds: 15 * MINUTE,
      threshold: maxFailedAttempts,
      blockSeconds: lockoutSeconds,
    },
    { scope: 'email', windowSeconds: HOUR, threshold: 10, blockSeconds: HOUR },
    { scope: 'email', windowSeconds: DAY, threshold: 20, blockSeconds: DAY },
    { scope: 'ip', windowSeconds: 15 * MINUTE, threshold: 20, blockSeconds: 15 * MINUTE },
  ];
}

/** Próba logowania w postaci potrzebnej do decyzji. */
export interface AttemptRecord {
  /** Czy próba się powiodła. */
  succeeded: boolean;
  /** Chwila próby w milisekundach epoki. */
  createdAt: number;
}

/** Decyzja bramki logowania. */
export type LoginGate =
  { allowed: true } | { allowed: false; retryAfterSeconds: number; rule: AttemptRule };

/**
 * Rozstrzyga, czy wolno podjąć próbę logowania.
 *
 * ## Dlaczego zakresy liczą się inaczej
 *
 * `09 §2.5` mówi: „udane logowanie **nie kasuje** historii prób — kasuje jedynie bieżącą
 * blokadę. Dzięki temu atakujący, który trafi jeden PIN, nie zeruje sobie licznika dla
 * drugiego konta". Rozpisane na dwa zakresy znaczy to:
 *
 * - **e-mail** — liczymy nieudane próby **po ostatniej udanej**. Właściciel konta, który
 *   pomylił PIN cztery razy i za piątym trafił, nie chodzi z licznikiem na czwórce.
 * - **IP** — liczymy **wszystkie** nieudane próby w oknie, niezależnie od sukcesów.
 *   Inaczej atakujący, który zgadł PIN do jednego konta, wyzerowałby sobie licznik
 *   i mógłby dalej dobijać się do drugiego z tego samego adresu.
 *
 * Blokada biegnie od **ostatniej** nieudanej próby, nie od pierwszej: kto próbuje dalej,
 * ten sam sobie przedłuża blokadę, zamiast czekać na wygaśnięcie okna.
 *
 * @param rules - Reguły z {@link attemptRules}.
 * @param emailAttempts - Próby dla adresu, od najnowszej lub najstarszej — kolejność bez znaczenia.
 * @param ipAttempts - Próby dla adresu IP.
 * @param now - Chwila bieżąca w milisekundach epoki.
 * @returns Zgoda albo liczba sekund do odblokowania wraz z regułą, która zadziałała.
 */
export function checkLoginAllowed(
  rules: readonly AttemptRule[],
  emailAttempts: readonly AttemptRecord[],
  ipAttempts: readonly AttemptRecord[],
  now: number,
): LoginGate {
  let blocked: { retryAfterSeconds: number; rule: AttemptRule } | undefined;

  for (const rule of rules) {
    const source = rule.scope === 'email' ? emailAttempts : ipAttempts;
    const windowStart = now - rule.windowSeconds * 1000;
    const inWindow = source.filter((attempt) => attempt.createdAt >= windowStart);

    // Dla adresu e-mail patrzymy wyłącznie na to, co wydarzyło się PO ostatnim sukcesie.
    const floor =
      rule.scope === 'email'
        ? inWindow.reduce(
            (latest, attempt) =>
              attempt.succeeded && attempt.createdAt > latest ? attempt.createdAt : latest,
            -1,
          )
        : -1;

    const failures = inWindow.filter((attempt) => !attempt.succeeded && attempt.createdAt > floor);
    if (failures.length < rule.threshold) continue;

    const lastFailure = failures.reduce(
      (latest, attempt) => Math.max(latest, attempt.createdAt),
      0,
    );
    const retryAfterSeconds = Math.ceil((lastFailure + rule.blockSeconds * 1000 - now) / 1000);
    if (retryAfterSeconds <= 0) continue;

    // Z kilku zadziałałych reguł wygrywa ta, która każe czekać najdłużej.
    if (!blocked || retryAfterSeconds > blocked.retryAfterSeconds) {
      blocked = { retryAfterSeconds, rule };
    }
  }

  return blocked ? { allowed: false, ...blocked } : { allowed: true };
}

/**
 * Zwraca najdłuższe okno spośród reguł.
 *
 * Tyle historii wystarczy pobrać z bazy, żeby podjąć decyzję — starsze wiersze nie mogą
 * już na nic wpłynąć.
 *
 * @param rules - Reguły z {@link attemptRules}.
 * @returns Długość najdłuższego okna w sekundach.
 */
export function longestWindowSeconds(rules: readonly AttemptRule[]): number {
  return rules.reduce((longest, rule) => Math.max(longest, rule.windowSeconds), 0);
}
