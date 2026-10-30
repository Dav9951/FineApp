import { loadConfig, type Config } from '../core/config.js';
import { isEntryPoint } from '../core/entry-point.js';
import { loadEnvFile } from '../core/env-file.js';
import { systemClock } from '../core/clock.js';
import { isAppError } from '../core/errors.js';
import { openDatabase, type DbHandle } from '../db/client.js';
import { seedDatabase } from '../db/seed/index.js';
import { createUser } from '../modules/auth/auth.service.js';

/**
 * Skrypt `pnpm --filter @fineapp/api user:create`
 * ([09 §10](../../../../plans/09-security-auth.md#10-zakładanie-użytkowników)).
 *
 * Aplikacja **nie ma rejestracji** — konta zakłada ta jedna droga. Skrypt losuje PIN,
 * wypisuje go **raz** na standardowe wyjście i zapisuje wyłącznie hash; jeśli ktoś ten
 * PIN zgubi, jedynym wyjściem jest ustawienie nowego.
 *
 * Pierwsze uruchomienie tworzy też gospodarstwo i kategorie domyślne, wołając seed —
 * idempotentnie, więc drugie uruchomienie niczego nie duplikuje.
 *
 * ```bash
 * pnpm --filter @fineapp/api user:create -- --email ja@example.com --name "Adam"
 * ```
 */

/** Rozpoznane argumenty wiersza poleceń. */
export interface UserCreateArgs {
  email: string;
  name: string;
  /** PIN podany ręcznie; brak oznacza wylosowanie. */
  pin?: string;
  /** Kolor awatara w zapisie `#rrggbb`. */
  color?: string;
}

/** Tekst pomocy wypisywany przy błędzie i przy `--help`. */
export const USAGE = [
  'Zakłada użytkownika aplikacji.',
  '',
  'Użycie:',
  '  pnpm --filter @fineapp/api user:create -- --email <adres> --name <nazwa> [--pin <cyfry>] [--color <#rrggbb>]',
  '',
  '  --email   adres e-mail; zostanie sprowadzony do małych liter',
  '  --name    nazwa widoczna w interfejsie',
  '  --pin     PIN; pominięty zostanie wylosowany i wypisany raz na ekran',
  '  --color   kolor awatara; pominięty zostanie wybrany z palety',
].join('\n');

/**
 * Rozpoznaje argumenty w postaci `--klucz wartość`.
 *
 * Świadomie **nie** obsługuje `--klucz=wartość` ani skrótów jednoliterowych: to jest
 * skrypt uruchamiany dwa razy w życiu projektu, a każdy wariant składni to kolejna
 * ścieżka, którą trzeba przetestować.
 *
 * @param argv - Argumenty bez nazwy programu.
 * @returns Rozpoznane argumenty.
 * @throws {Error} Gdy brakuje wymaganego argumentu albo pojawił się nieznany.
 */
export function parseArgs(argv: readonly string[]): UserCreateArgs {
  const values = new Map<string, string>();

  // `pnpm run user:create -- --email …` przekazuje separator `--` dalej, do skryptu.
  // Dokumentacja (09 §10) podaje właśnie taką postać wywołania, więc separator trzeba
  // zdjąć tutaj — inaczej udokumentowane polecenie kończy się „Nieznany argument: --".
  const args = argv[0] === '--' ? argv.slice(1) : argv;

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === undefined) break;
    if (!key.startsWith('--')) {
      throw new Error(`Nieoczekiwany argument: ${key}`);
    }
    const name = key.slice(2);
    if (!['email', 'name', 'pin', 'color'].includes(name)) {
      throw new Error(`Nieznany argument: ${key}`);
    }
    if (value === undefined) {
      throw new Error(`Argument ${key} wymaga wartości.`);
    }
    values.set(name, value);
  }

  const email = values.get('email');
  const name = values.get('name');
  if (email === undefined) throw new Error('Brak wymaganego argumentu --email.');
  if (name === undefined) throw new Error('Brak wymaganego argumentu --name.');

  const pin = values.get('pin');
  const color = values.get('color');
  return {
    email,
    name,
    ...(pin === undefined ? {} : { pin }),
    ...(color === undefined ? {} : { color }),
  };
}

/** Wynik przebiegu skryptu — do wypisania i do testów. */
export interface UserCreateReport {
  email: string;
  displayName: string;
  userId: string;
  pin: string;
  pinGenerated: boolean;
  householdCreated: boolean;
  categoriesInserted: number;
}

/**
 * Zakłada użytkownika na otwartej bazie.
 *
 * Wydzielone z {@link main}, żeby dało się to przetestować na bazie `:memory:`
 * bez uruchamiania procesu.
 *
 * @param handle - Uchwyt otwartej bazy.
 * @param config - Konfiguracja aplikacji.
 * @param args - Rozpoznane argumenty.
 * @returns Podsumowanie przebiegu.
 */
export async function runUserCreate(
  handle: DbHandle,
  config: Config,
  args: UserCreateArgs,
): Promise<UserCreateReport> {
  // Seed jest idempotentny: przy drugim uruchomieniu nie tworzy niczego ponownie,
  // a przy pierwszym daje gospodarstwo, do którego użytkownik ma należeć.
  const seed = seedDatabase(handle, config);

  const result = await createUser(handle, config, systemClock, {
    email: args.email,
    displayName: args.name,
    householdId: seed.householdId,
    ...(args.pin === undefined ? {} : { pin: args.pin }),
    ...(args.color === undefined ? {} : { avatarColor: args.color }),
  });

  return {
    email: result.user.email,
    displayName: result.user.displayName,
    userId: result.user.id,
    pin: result.pin,
    pinGenerated: result.pinGenerated,
    householdCreated: seed.householdCreated,
    categoriesInserted: seed.categoriesInserted,
  };
}

/**
 * Składa raport do wypisania na ekran.
 *
 * PIN idzie na **standardowe wyjście, nie do loggera**: logger pisze do pliku i do
 * systemu zbierania logów, a PIN nie ma prawa się tam znaleźć
 * ([09 §7](../../../../plans/09-security-auth.md)).
 *
 * @param report - Podsumowanie przebiegu.
 * @returns Tekst gotowy do wypisania.
 */
export function formatReport(report: UserCreateReport): string {
  const lines = [
    '',
    `  Użytkownik założony: ${report.displayName} <${report.email}>`,
    `  Identyfikator:       ${report.userId}`,
  ];
  if (report.householdCreated) {
    lines.push(
      `  Gospodarstwo:        utworzone wraz z ${String(report.categoriesInserted)} kategoriami`,
    );
  }
  lines.push(
    '',
    report.pinGenerated
      ? `  PIN (wylosowany):    ${report.pin}`
      : `  PIN (podany):        ${report.pin}`,
    '',
    '  Zapisz go teraz — nie da się go odczytać później, w bazie jest tylko hash.',
    '',
  );
  return lines.join('\n');
}

/** Punkt wejścia `pnpm user:create`. */
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
    console.log(formatReport(await runUserCreate(handle, config, args)));
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
