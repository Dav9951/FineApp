import { loadConfig, type Config } from '../core/config.js';
import { isEntryPoint } from '../core/entry-point.js';
import { loadEnvFile } from '../core/env-file.js';
import { systemClock } from '../core/clock.js';
import { isAppError } from '../core/errors.js';
import { openDatabase, type DbHandle } from '../db/client.js';
import { resetPin } from '../modules/auth/auth.service.js';

/**
 * Skrypt `pnpm --filter @fineapp/api user:reset-pin`
 * ([09 §10.1](../../../../plans/09-security-auth.md#101-reset-zapomnianego-pin-u), ADR-092).
 *
 * Zapomniany PIN nie ma resetu przez e-mail — nowy ustawia osoba z dostępem do serwera.
 * Skrypt losuje PIN (albo przyjmuje `--pin`), wypisuje go **raz**, wylogowuje wszystkie
 * urządzenia tej osoby i zdejmuje blokadę po nieudanych próbach logowania.
 *
 * ```bash
 * pnpm --filter @fineapp/api user:reset-pin -- --email ja@example.com
 * docker compose exec app node dist/scripts/reset-pin.js --email ja@example.com
 * ```
 */

/** Rozpoznane argumenty wiersza poleceń. */
export interface ResetPinArgs {
  email: string;
  /** PIN podany ręcznie; brak oznacza wylosowanie. */
  pin?: string;
}

/** Tekst pomocy wypisywany przy błędzie i przy `--help`. */
export const USAGE = [
  'Ustawia nowy PIN użytkownika, który zapomniał obecnego.',
  '',
  'Użycie:',
  '  pnpm --filter @fineapp/api user:reset-pin -- --email <adres> [--pin <cyfry>]',
  '',
  '  --email   adres e-mail konta',
  '  --pin     nowy PIN; pominięty zostanie wylosowany i wypisany raz na ekran',
  '',
  'Wszystkie urządzenia tej osoby zostaną wylogowane.',
].join('\n');

/**
 * Rozpoznaje argumenty w postaci `--klucz wartość` — ta sama składnia co
 * `user:create`, łącznie ze zdjęciem separatora `--` przekazywanego przez pnpm.
 *
 * @param argv - Argumenty bez nazwy programu.
 * @returns Rozpoznane argumenty.
 * @throws {Error} Gdy brakuje adresu albo pojawił się nieznany argument.
 */
export function parseArgs(argv: readonly string[]): ResetPinArgs {
  const values = new Map<string, string>();
  const args = argv[0] === '--' ? argv.slice(1) : argv;

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === undefined) break;
    if (!key.startsWith('--')) {
      throw new Error(`Nieoczekiwany argument: ${key}`);
    }
    const name = key.slice(2);
    if (!['email', 'pin'].includes(name)) {
      throw new Error(`Nieznany argument: ${key}`);
    }
    if (value === undefined) {
      throw new Error(`Argument ${key} wymaga wartości.`);
    }
    values.set(name, value);
  }

  const email = values.get('email');
  if (email === undefined) throw new Error('Brak wymaganego argumentu --email.');
  const pin = values.get('pin');
  return { email, ...(pin === undefined ? {} : { pin }) };
}

/** Wynik przebiegu skryptu — do wypisania i do testów. */
export interface ResetPinReport {
  email: string;
  displayName: string;
  pin: string;
  pinGenerated: boolean;
  sessionsDeleted: number;
  attemptsCleared: number;
}

/**
 * Resetuje PIN na otwartej bazie — wydzielone z {@link main} dla testów na `:memory:`.
 *
 * @param handle - Uchwyt otwartej bazy.
 * @param config - Konfiguracja aplikacji.
 * @param args - Rozpoznane argumenty.
 * @returns Podsumowanie przebiegu.
 */
export async function runResetPin(
  handle: DbHandle,
  config: Config,
  args: ResetPinArgs,
): Promise<ResetPinReport> {
  const result = await resetPin(handle, config, systemClock, args);
  return {
    email: result.user.email,
    displayName: result.user.displayName,
    pin: result.pin,
    pinGenerated: result.pinGenerated,
    sessionsDeleted: result.sessionsDeleted,
    attemptsCleared: result.attemptsCleared,
  };
}

/**
 * Składa raport do wypisania na ekran.
 *
 * PIN idzie na **standardowe wyjście, nie do loggera** ([09 §7](../../../../plans/09-security-auth.md)).
 *
 * @param report - Podsumowanie przebiegu.
 * @returns Tekst gotowy do wypisania.
 */
export function formatReport(report: ResetPinReport): string {
  return [
    '',
    `  PIN zmieniony: ${report.displayName} <${report.email}>`,
    `  Wylogowane sesje:    ${String(report.sessionsDeleted)}`,
    `  Zdjęta blokada prób: ${report.attemptsCleared > 0 ? 'tak' : 'nie było'}`,
    '',
    report.pinGenerated
      ? `  Nowy PIN (wylosowany): ${report.pin}`
      : `  Nowy PIN (podany):     ${report.pin}`,
    '',
    '  Zapisz go teraz — nie da się go odczytać później, w bazie jest tylko hash.',
    '',
  ].join('\n');
}

/** Punkt wejścia `pnpm user:reset-pin`. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log(USAGE);
    return;
  }

  let handle: DbHandle | undefined;
  try {
    const args = parseArgs(argv);
    loadEnvFile();
    const config = loadConfig();
    handle = openDatabase(config.db.path);
    console.log(formatReport(await runResetPin(handle, config, args)));
  } catch (error) {
    const message = isAppError(error) || error instanceof Error ? error.message : String(error);
    console.error(`\n  ${message}\n`);
    if (!isAppError(error)) console.error(USAGE);
    process.exitCode = 1;
  } finally {
    handle?.close();
  }
}

// Uruchamiane jako skrypt, nie przy imporcie w testach.
if (isEntryPoint(import.meta.url)) {
  await main();
}
