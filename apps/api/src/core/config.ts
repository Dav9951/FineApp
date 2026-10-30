import { z } from 'zod';

/**
 * Walidacja zmiennych środowiskowych i typowany obiekt konfiguracji.
 *
 * Aplikacja **odmawia startu**, gdy konfiguracja jest niepoprawna — lepiej, żeby
 * kontener nie wstał z czytelnym komunikatem, niż żeby wstał z `JWT_SECRET` równym
 * wartości przykładowej ([09 §9](../../../../plans/09-security-auth.md#9-zarządzanie-sekretami)).
 * Komunikat z tego pliku jest tym, co widać w `docker compose logs app`, gdy kontener
 * restartuje się w pętli ([10](../../../../plans/10-deployment.md)) — dlatego wypisuje
 * wszystkie błędy naraz, a nie pierwszy z brzegu.
 *
 * Obiekt konfiguracji nie jest singletonem modułowym: powstaje w `index.ts`
 * i jest przekazywany dalej, zgodnie z jawnym grafem zależności z
 * [02 §5](../../../../plans/02-architecture.md#5-serwisy--wstrzykiwanie-zależności).
 */

/** Wartości, od których zaczynają się sekrety w `.env.example`. */
const PLACEHOLDER_PREFIX = 'CHANGE_ME';

/** Minimalna długość sekretu podpisującego tokeny ([09 §9](../../../../plans/09-security-auth.md)). */
const JWT_SECRET_MIN_LENGTH = 32;

/**
 * Buduje schemat flagi logicznej czytanej ze zmiennej środowiskowej.
 *
 * `z.coerce.boolean()` tu nie nadaje się do niczego: każdy niepusty napis, łącznie
 * z `"false"`, daje `true`. Przyjmujemy więc jawny zbiór wartości.
 *
 * @param defaultValue - Wartość przy braku zmiennej.
 * @returns Schemat Zod zwracający `boolean`.
 */
function envBoolean(defaultValue: boolean) {
  return z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1');
}

/**
 * Odmienia rzeczownik „znak" przez liczebnik.
 *
 * Komunikat konfiguracji czyta człowiek w logu kontenera, a „co najmniej 32 znaków"
 * kłuje w oczy tak samo jak literówka.
 *
 * @param count - Liczebnik.
 * @returns Forma dopasowana do liczby.
 */
function znakow(count: number): string {
  const last = count % 10;
  const lastTwo = count % 100;
  if (count === 1) return 'znak';
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'znaki';
  return 'znaków';
}

/**
 * Tłumaczy komunikaty Zoda na polski.
 *
 * Zod mówi po angielsku („Required", „Invalid url"), a komunikat startowy jest jedyną
 * wskazówką, jaką dostaje osoba stawiająca aplikację na VPS-ie
 * ([10](../../../../plans/10-deployment.md)). Własne komunikaty przekazane w schemacie
 * mają pierwszeństwo — mapa dotyka tylko tych, których sami nie napisaliśmy.
 *
 * @param issue - Problem zgłoszony przez Zoda.
 * @param ctx - Kontekst z domyślnym komunikatem.
 * @returns Komunikat po polsku albo domyślny, gdy przypadek nie jest obsłużony.
 */
const polishErrors: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code === z.ZodIssueCode.invalid_type) {
    if (issue.received === 'undefined') return { message: 'jest wymagana, a nie ustawiono jej' };
    return { message: `oczekiwano wartości typu ${issue.expected}` };
  }
  if (issue.code === z.ZodIssueCode.invalid_string && issue.validation === 'url') {
    return { message: 'musi być poprawnym adresem URL (np. https://budzet.example.com)' };
  }
  if (issue.code === z.ZodIssueCode.invalid_enum_value) {
    return { message: `dozwolone wartości: ${issue.options.join(', ')}` };
  }
  if (issue.code === z.ZodIssueCode.too_small && issue.type === 'number') {
    return { message: `musi być liczbą nie mniejszą niż ${String(issue.minimum)}` };
  }
  if (issue.code === z.ZodIssueCode.too_big && issue.type === 'number') {
    return { message: `musi być liczbą nie większą niż ${String(issue.maximum)}` };
  }
  return { message: ctx.defaultError };
};

/**
 * Buduje schemat sekretu, który musi być ustawiony i różny od wartości przykładowej.
 *
 * @param minLength - Minimalna długość.
 * @param label - Podpowiedź, jak wygenerować własną wartość.
 * @returns Schemat Zod dla sekretu.
 */
const secret = (minLength: number, label: string) =>
  z
    .string()
    .min(minLength, `musi mieć co najmniej ${minLength} ${znakow(minLength)}`)
    .refine((value) => !value.startsWith(PLACEHOLDER_PREFIX), {
      message: `nadal ma wartość przykładową z .env.example — wygeneruj własną (${label})`,
    });

/** Schemat surowych zmiennych środowiskowych. */
const envSchema = z
  .object({
    // --- Runtime ---
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    APP_URL: z.string().url(),

    // --- Baza danych ---
    DATABASE_PATH: z.string().min(1),

    // --- Pliki ---
    UPLOAD_DIR: z.string().min(1),
    UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),

    // --- Auth ---
    JWT_SECRET: secret(JWT_SECRET_MIN_LENGTH, 'openssl rand -base64 48'),
    IP_HASH_SALT: secret(16, 'dowolny losowy napis'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
    PIN_MIN_LENGTH: z.coerce.number().int().min(4).max(12).default(6),
    PIN_MAX_LENGTH: z.coerce.number().int().min(4).max(12).default(8),
    AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
    AUTH_LOCKOUT_SECONDS: z.coerce.number().int().positive().default(900),
    COOKIE_SECURE: envBoolean(false),
    COOKIE_DOMAIN: z.string().default(''),

    // --- AI / OCR ---
    ANTHROPIC_API_KEY: z.string().default(''),
    AI_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
    // Model myśli adaptacyjnie, a myślenie liczy się do limitu — 4096 z 08 §8 ucinało
    // dłuższe wyciągi (ADR-059).
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(16_000),
    AI_ENABLED: envBoolean(true),
    // Kwota w groszach — sufiks `Minor` zgodnie z regułą jednostek (02 §8).
    AI_MONTHLY_BUDGET_MINOR: z.coerce.number().int().min(0).default(5_000),
    // Stawki w groszach za milion tokenów — konfiguracja, nie stała (08 §9). Domyślne
    // odpowiadają claude-sonnet-5-5 ($2 / $10) po kursie z zapasem ~4 zł/$.
    AI_INPUT_COST_MINOR_PER_MTOK: z.coerce.number().int().min(0).default(800),
    AI_OUTPUT_COST_MINOR_PER_MTOK: z.coerce.number().int().min(0).default(4_000),

    // --- Domena ---
    DEFAULT_CURRENCY: z.literal('PLN').default('PLN'),
    DEFAULT_TIMEZONE: z.string().min(1).default('Europe/Warsaw'),
    DEFAULT_LOCALE: z.string().min(1).default('pl-PL'),
    /** Katalog zbudowanego frontu; pusty — API bez SPA (dev, gdzie front serwuje Vite). */
    WEB_DIST_PATH: z.string().default(''),
  })
  .superRefine((env, ctx) => {
    if (env.PIN_MIN_LENGTH > env.PIN_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PIN_MIN_LENGTH'],
        message: `nie może być większe od PIN_MAX_LENGTH (${env.PIN_MAX_LENGTH})`,
      });
    }
    // Włączone OCR bez klucza to awaria widoczna dopiero przy pierwszym paragonie —
    // lepiej nie wstać teraz niż zawieść użytkownika w trakcie pracy.
    if (env.AI_ENABLED && env.ANTHROPIC_API_KEY.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_API_KEY'],
        message: 'jest wymagany, gdy AI_ENABLED=true (albo ustaw AI_ENABLED=false)',
      });
    }
    if (env.REFRESH_TOKEN_TTL_SECONDS <= env.ACCESS_TOKEN_TTL_SECONDS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REFRESH_TOKEN_TTL_SECONDS'],
        message: 'musi być dłuższy niż ACCESS_TOKEN_TTL_SECONDS',
      });
    }
    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'musi być `true` w produkcji — bez tego ciasteczko sesji idzie po HTTP',
      });
    }
    // Ten sam powód co wyżej, od strony adresu: `APP_URL` trafia do listy CORS, a po HTTP
    // przeglądarka i tak nie odeśle ciasteczka `Secure` (10 §9, 09 §11).
    if (env.NODE_ENV === 'production' && !env.APP_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_URL'],
        message: 'musi zaczynać się od https:// w produkcji',
      });
    }
  });

/** Konfiguracja aplikacji — pogrupowana tematycznie, tylko do odczytu. */
export interface Config {
  readonly env: 'development' | 'test' | 'production';
  readonly isProduction: boolean;
  readonly server: {
    readonly port: number;
    readonly host: string;
    readonly appUrl: string;
    readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  };
  readonly db: {
    readonly path: string;
  };
  readonly uploads: {
    readonly dir: string;
    readonly maxBytes: number;
  };
  readonly auth: {
    readonly jwtSecret: string;
    readonly ipHashSalt: string;
    readonly accessTokenTtlSeconds: number;
    readonly refreshTokenTtlSeconds: number;
    readonly pinMinLength: number;
    readonly pinMaxLength: number;
    readonly maxFailedAttempts: number;
    readonly lockoutSeconds: number;
    readonly cookieSecure: boolean;
    /** Pusty napis oznacza „nie ustawiaj atrybutu Domain". */
    readonly cookieDomain: string;
  };
  readonly ai: {
    readonly enabled: boolean;
    readonly apiKey: string;
    readonly model: string;
    readonly maxOutputTokens: number;
    /** Miesięczny limit kosztów w groszach; `0` oznacza brak limitu. */
    readonly monthlyBudgetMinor: number;
    /** Stawka za milion tokenów wejścia, w groszach. */
    readonly inputCostMinorPerMTok: number;
    /** Stawka za milion tokenów wyjścia, w groszach. */
    readonly outputCostMinorPerMTok: number;
  };
  readonly web: {
    /** Katalog zbudowanego SPA (`apps/web/dist`); `null` — API go nie serwuje. */
    readonly distPath: string | null;
  };
  readonly defaults: {
    readonly currency: 'PLN';
    readonly timezone: string;
    readonly locale: string;
  };
}

/**
 * Błąd konfiguracji — jedyny, który wolno rzucić przed startem serwera.
 *
 * Nie dziedziczy po `AppError`, bo nie ma odbiorcy HTTP: nikt go nie zobaczy
 * w odpowiedzi, tylko w logu kontenera.
 */
export class ConfigError extends Error {
  /**
   * @param issues - Lista czytelnych opisów `ZMIENNA: problem`.
   */
  constructor(readonly issues: readonly string[]) {
    super(
      [
        'Nieprawidłowa konfiguracja — aplikacja nie wystartuje.',
        ...issues.map((issue) => `  • ${issue}`),
        'Wzorzec zmiennych: .env.example',
      ].join('\n'),
    );
    this.name = 'ConfigError';
  }
}

/**
 * Waliduje zmienne środowiskowe i buduje obiekt konfiguracji.
 *
 * Funkcja jest czysta względem podanego źródła — w testach podstawiamy własny obiekt
 * zamiast `process.env`, dzięki czemu da się sprawdzić odrzucenia bez dotykania
 * środowiska procesu.
 *
 * @param source - Źródło zmiennych; domyślnie `process.env`.
 * @returns Zamrożony obiekt konfiguracji.
 * @throws {ConfigError} Gdy którakolwiek zmienna jest niepoprawna. Komunikat wymienia
 *   **wszystkie** problemy i nigdy nie zawiera wartości sekretów.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source, { errorMap: polishErrors });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const name = issue.path.join('.') || '(nieznana zmienna)';
      return `${name}: ${issue.message}`;
    });
    throw new ConfigError(issues);
  }

  const env = parsed.data;

  return Object.freeze({
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    server: Object.freeze({
      port: env.PORT,
      host: env.HOST,
      appUrl: env.APP_URL,
      logLevel: env.LOG_LEVEL,
    }),
    db: Object.freeze({ path: env.DATABASE_PATH }),
    uploads: Object.freeze({
      dir: env.UPLOAD_DIR,
      maxBytes: env.UPLOAD_MAX_BYTES,
    }),
    auth: Object.freeze({
      jwtSecret: env.JWT_SECRET,
      ipHashSalt: env.IP_HASH_SALT,
      accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
      pinMinLength: env.PIN_MIN_LENGTH,
      pinMaxLength: env.PIN_MAX_LENGTH,
      maxFailedAttempts: env.AUTH_MAX_FAILED_ATTEMPTS,
      lockoutSeconds: env.AUTH_LOCKOUT_SECONDS,
      cookieSecure: env.COOKIE_SECURE,
      cookieDomain: env.COOKIE_DOMAIN,
    }),
    ai: Object.freeze({
      enabled: env.AI_ENABLED,
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.AI_MODEL,
      maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
      monthlyBudgetMinor: env.AI_MONTHLY_BUDGET_MINOR,
      inputCostMinorPerMTok: env.AI_INPUT_COST_MINOR_PER_MTOK,
      outputCostMinorPerMTok: env.AI_OUTPUT_COST_MINOR_PER_MTOK,
    }),
    web: Object.freeze({ distPath: env.WEB_DIST_PATH === '' ? null : env.WEB_DIST_PATH }),
    defaults: Object.freeze({
      currency: env.DEFAULT_CURRENCY,
      timezone: env.DEFAULT_TIMEZONE,
      locale: env.DEFAULT_LOCALE,
    }),
  });
}
