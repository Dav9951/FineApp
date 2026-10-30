import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

/**
 * Minimalny komplet zmiennych, przy którym aplikacja ma prawo wstać.
 *
 * @param overrides - Zmienne nadpisujące komplet bazowy.
 * @returns Obiekt zmiennych środowiskowych do podstawienia w teście.
 */
function validEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    APP_URL: 'http://localhost:5173',
    DATABASE_PATH: './data/fineapp.db',
    UPLOAD_DIR: './data/uploads',
    JWT_SECRET: 'a'.repeat(48),
    IP_HASH_SALT: 'b'.repeat(24),
    AI_ENABLED: 'false',
    ...overrides,
  };
}

describe('loadConfig — wartości domyślne', () => {
  it('uzupełnia domyślne i grupuje tematycznie', () => {
    const config = loadConfig(validEnv());
    expect(config.env).toBe('development');
    expect(config.isProduction).toBe(false);
    expect(config.server.port).toBe(3000);
    expect(config.auth.pinMinLength).toBe(6);
    expect(config.auth.pinMaxLength).toBe(8);
    expect(config.defaults.timezone).toBe('Europe/Warsaw');
    expect(config.defaults.currency).toBe('PLN');
  });

  it('domyślny limit OCR zgadza się z .env.example (5 000 groszy)', () => {
    expect(loadConfig(validEnv()).ai.monthlyBudgetMinor).toBe(5_000);
  });

  it('WEB_DIST_PATH pominięte — API bez frontu (dev); podane — ścieżka frontu', () => {
    expect(loadConfig(validEnv()).web.distPath).toBeNull();
    expect(loadConfig(validEnv({ WEB_DIST_PATH: '/app/web' })).web.distPath).toBe('/app/web');
  });

  it('zwraca obiekt zamrożony', () => {
    const config = loadConfig(validEnv());
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.auth)).toBe(true);
  });
});

describe('loadConfig — sekrety', () => {
  it('odmawia startu przy pustym JWT_SECRET', () => {
    expect(() => loadConfig(validEnv({ JWT_SECRET: '' }))).toThrow(ConfigError);
  });

  it('odmawia startu przy JWT_SECRET krótszym niż 32 znaki', () => {
    expect(() => loadConfig(validEnv({ JWT_SECRET: 'a'.repeat(31) }))).toThrow(ConfigError);
  });

  it('odmawia startu przy wartości przykładowej z .env.example', () => {
    expect(() =>
      loadConfig(validEnv({ JWT_SECRET: 'CHANGE_ME_generate_with_openssl_rand_base64_48' })),
    ).toThrow(ConfigError);
  });

  it('nie wypisuje wartości sekretu w komunikacie błędu', () => {
    const secret = 'CHANGE_ME_tajne_haslo_ktore_nie_moze_wyciec_do_logu';
    try {
      loadConfig(validEnv({ JWT_SECRET: secret }));
      expect.unreachable('konfiguracja powinna zostać odrzucona');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).not.toContain(secret);
      expect((error as ConfigError).message).toContain('JWT_SECRET');
    }
  });
});

describe('loadConfig — reguły łączone', () => {
  it('odrzuca PIN_MIN_LENGTH większe od PIN_MAX_LENGTH', () => {
    expect(() => loadConfig(validEnv({ PIN_MIN_LENGTH: '8', PIN_MAX_LENGTH: '6' }))).toThrow(
      ConfigError,
    );
  });

  it('wymaga klucza Anthropica, gdy OCR jest włączone', () => {
    expect(() => loadConfig(validEnv({ AI_ENABLED: 'true', ANTHROPIC_API_KEY: '' }))).toThrow(
      ConfigError,
    );
  });

  it('pozwala wystartować bez klucza, gdy OCR jest wyłączone', () => {
    expect(loadConfig(validEnv({ AI_ENABLED: 'false' })).ai.enabled).toBe(false);
  });

  it('wymaga, by token odświeżający żył dłużej niż access token', () => {
    expect(() =>
      loadConfig(validEnv({ ACCESS_TOKEN_TTL_SECONDS: '900', REFRESH_TOKEN_TTL_SECONDS: '900' })),
    ).toThrow(ConfigError);
  });

  it('w produkcji wymusza COOKIE_SECURE', () => {
    const production = validEnv({
      NODE_ENV: 'production',
      APP_URL: 'https://fineapp.example.com',
      COOKIE_SECURE: 'false',
    });
    expect(() => loadConfig(production)).toThrow(ConfigError);
    expect(loadConfig({ ...production, COOKIE_SECURE: 'true' }).isProduction).toBe(true);
  });

  it('w produkcji wymusza APP_URL po HTTPS', () => {
    const production = validEnv({
      NODE_ENV: 'production',
      APP_URL: 'http://fineapp.example.com',
      COOKIE_SECURE: 'true',
    });
    expect(() => loadConfig(production)).toThrow(/APP_URL: musi zaczynać się od https:\/\//u);
    // Poza produkcją lokalny adres po HTTP jest w porządku.
    expect(loadConfig(validEnv({ APP_URL: 'http://localhost:5173' })).server.appUrl).toBe(
      'http://localhost:5173',
    );
  });
});

describe('loadConfig — flagi logiczne', () => {
  it('traktuje napis "false" jako fałsz', () => {
    // z.coerce.boolean() dałoby tu `true` — dlatego flagi mają własny schemat.
    expect(loadConfig(validEnv({ COOKIE_SECURE: 'false' })).auth.cookieSecure).toBe(false);
    expect(loadConfig(validEnv({ COOKIE_SECURE: '0' })).auth.cookieSecure).toBe(false);
    expect(loadConfig(validEnv({ COOKIE_SECURE: 'true' })).auth.cookieSecure).toBe(true);
    expect(loadConfig(validEnv({ COOKIE_SECURE: '1' })).auth.cookieSecure).toBe(true);
  });

  it('odrzuca wartość, która nie jest flagą', () => {
    expect(() => loadConfig(validEnv({ COOKIE_SECURE: 'tak' }))).toThrow(ConfigError);
  });
});

describe('loadConfig — komunikaty po polsku', () => {
  it('nie przepuszcza angielskich komunikatów Zoda', () => {
    try {
      loadConfig({ JWT_SECRET: 'CHANGE_ME_x' });
      expect.unreachable('konfiguracja powinna zostać odrzucona');
    } catch (error) {
      const text = (error as ConfigError).issues.join('\n');
      expect(text).not.toMatch(/Required|Invalid|Expected|String must contain/);
      expect(text).toContain('jest wymagana');
    }
  });

  it('odmienia liczebnik w komunikacie o długości sekretu', () => {
    try {
      loadConfig(validEnv({ JWT_SECRET: 'a'.repeat(10) }));
      expect.unreachable('konfiguracja powinna zostać odrzucona');
    } catch (error) {
      // 32 -> „znaki", nie „znaków".
      expect((error as ConfigError).issues.join('\n')).toContain('co najmniej 32 znaki');
    }
  });

  it('tłumaczy niepoprawny adres URL', () => {
    try {
      loadConfig(validEnv({ APP_URL: 'nie-url' }));
      expect.unreachable('konfiguracja powinna zostać odrzucona');
    } catch (error) {
      expect((error as ConfigError).issues.join('\n')).toContain('poprawnym adresem URL');
    }
  });
});

describe('ConfigError', () => {
  it('wymienia wszystkie problemy naraz, nie pierwszy z brzegu', () => {
    try {
      loadConfig({ JWT_SECRET: 'za-krotki' });
      expect.unreachable('konfiguracja powinna zostać odrzucona');
    } catch (error) {
      const { issues } = error as ConfigError;
      expect(issues.length).toBeGreaterThan(1);
      expect(issues.join('\n')).toContain('APP_URL');
      expect(issues.join('\n')).toContain('JWT_SECRET');
    }
  });
});
