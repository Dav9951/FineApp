import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/**
 * Pobieranie adresu podanego przez użytkownika — link do przepisu
 * ([09 §7a](../../../../plans/09-security-auth.md#7a-pobieranie-adresów-podanych-przez-użytkownika),
 * ADR-095).
 *
 * Pierwszy w aplikacji wychodzący `fetch` pod adres z zewnątrz, więc klasyczny cel SSRF:
 * serwer na VPS widzi sieć kontenerów, metadane chmury i własne porty. Ochrona:
 *
 * - tylko `http:` / `https:` na porcie domyślnym, bez danych logowania w adresie;
 * - **każdy** adres z DNS musi być publiczny — inaczej odmowa;
 * - połączenie idzie na **sprawdzony** adres: własna funkcja `lookup` w żądaniu, więc nie
 *   ma drugiego rozwiązania nazwy między sprawdzeniem a połączeniem (DNS rebinding);
 * - przekierowania ręcznie, najwyżej 3, każde sprawdzane od nowa;
 * - limit czasu na całość i limit rozmiaru (strumień przerywany), tylko HTML;
 * - bez ciasteczek i nagłówka `Authorization`, ogólny `User-Agent`.
 *
 * Zależności sieciowe (`lookup`, `request`) są wstrzykiwane — testy sprawdzają reguły bez
 * wychodzenia do internetu.
 */

/** Limity pobierania (09 §7a). */
export const SAFE_FETCH_LIMITS = {
  timeoutMs: 10_000,
  maxBytes: 3 * 1024 * 1024,
  maxRedirects: 3,
} as const;

/** Nagłówek przedstawiający aplikację — bez danych gospodarstwa. */
const USER_AGENT = 'FineApp/1.0 (recipe import)';

/** Przyczyna odmowy pobrania — trafia do `shopping_imports.error_code`. */
export type SafeFetchErrorCode = 'RECIPE_FETCH_BLOCKED' | 'RECIPE_FETCH_FAILED';

/** Odmowa albo nieudane pobranie. Komunikat do logu: tylko host i przyczyna, bez treści. */
export class SafeFetchError extends Error {
  /**
   * @param code - `RECIPE_FETCH_BLOCKED` — adres niedozwolony; `RECIPE_FETCH_FAILED` — reszta.
   * @param message - Opis techniczny (bez treści strony).
   */
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

/**
 * Zakresy, do których serwer nie może się łączyć: prywatne, pętla zwrotna, link-local,
 * CGNAT, benchmark, multicast, zarezerwowane, ULA — i ich odpowiedniki IPv4 w IPv6.
 */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['2001::', 32], // Teredo
  ['2001:10::', 28], // ORCHID
  ['2001:db8::', 32], // dokumentacja
  ['2002::', 16], // 6to4 — IPv4 w środku
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

/** IPv6 dopuszczone w ogóle: tylko globalny unicast (lista dozwolonych, nie zakazanych). */
const GLOBAL_UNICAST = new BlockList();
GLOBAL_UNICAST.addSubnet('2000::', 3, 'ipv6');

/**
 * Rozwija adres IPv6 do ośmiu 16-bitowych grup (z IPv4 na końcu, `::1.2.3.4`).
 *
 * @param address - Poprawny adres IPv6 (`isIP` = 6).
 * @returns Osiem grup albo `null`, gdy zapisu nie da się rozwinąć.
 */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  const tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    const octets = last.split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    tail.push((a << 8) | b, (c << 8) | d);
    // `::ffff:1.2.3.4` → `::ffff`, `::1.2.3.4` → `::` — grupy IPv4 dochodzą z `tail`.
    text = text.slice(0, lastColon + 1);
    if (!text.endsWith('::')) text = text.slice(0, -1);
  }
  const parse = (part: string): number[] =>
    part === '' ? [] : part.split(':').map((group) => parseInt(group, 16));
  const halves = text.split('::');
  const head = parse(halves[0] ?? '');
  const rest = halves.length > 1 ? parse(halves[1] ?? '') : [];
  const missing = 8 - tail.length - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest, ...tail];
}

/**
 * Czy adres IP jest publiczny (wolno się z nim łączyć).
 *
 * IPv6 tylko z globalnego unicastu (`2000::/3`) poza zakresami tunelującymi IPv4 —
 * każdy inny zapis (`::7f00:1`, `::ffff:0:7f00:1`, NAT64, ULA, link-local) odpada.
 * Jedynie IPv4 zmapowane (`::ffff:a.b.c.d`, także szesnastkowo) jest sprawdzane jako IPv4.
 *
 * @param address - Adres IPv4 albo IPv6.
 * @returns `true` dla adresu publicznego.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, 'ipv4');
  if (family !== 6) return false;
  const groups = ipv6Groups(address);
  if (groups?.length !== 8) return false;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return isPublicAddress(
      `${String(high >> 8)}.${String(high & 255)}.${String(low >> 8)}.${String(low & 255)}`,
    );
  }
  return GLOBAL_UNICAST.check(address, 'ipv6') && !BLOCKED.check(address, 'ipv6');
}

/** Rozwiązanie nazwy na wszystkie adresy (wstrzykiwane w testach). */
export type ResolveAll = (hostname: string) => Promise<LookupAddress[]>;

/** Wykonanie jednego żądania GET (wstrzykiwane w testach). */
export type RequestGet = (
  url: URL,
  options: { lookup: LookupFunction; headers: Record<string, string>; signal: AbortSignal },
) => Promise<IncomingMessage>;

/** Zależności sieciowe. */
export interface SafeFetchDeps {
  readonly resolveAll: ResolveAll;
  readonly get: RequestGet;
}

/** Domyślne zależności — prawdziwy DNS i `http`/`https`. */
export const defaultSafeFetchDeps: SafeFetchDeps = {
  resolveAll: (hostname) =>
    new Promise((resolve, reject) => {
      dnsLookup(hostname, { all: true }, (error, addresses) => {
        if (error) reject(error);
        else resolve(addresses);
      });
    }),
  get: (url, options) =>
    new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const request = client.get(url, {
        lookup: options.lookup,
        headers: options.headers,
        signal: options.signal,
        // Bez agenta z pulą połączeń: każde żądanie rozwiązuje nazwę naszym `lookup`.
        agent: false,
      });
      request.on('response', resolve);
      request.on('error', reject);
    }),
};

/**
 * Sprawdza adres przed połączeniem i zwraca sprawdzone IP do `lookup`.
 *
 * @param url - Adres.
 * @param deps - Zależności sieciowe.
 * @returns Adresy publiczne (co najmniej jeden).
 * @throws {SafeFetchError} Gdy adres jest niedozwolony albo nazwa się nie rozwiązuje.
 */
async function checkedAddresses(url: URL, deps: SafeFetchDeps): Promise<LookupAddress[]> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('RECIPE_FETCH_BLOCKED', `Schemat ${url.protocol} niedozwolony`);
  }
  if (url.port !== '') {
    throw new SafeFetchError('RECIPE_FETCH_BLOCKED', `Port ${url.port} niedozwolony`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new SafeFetchError('RECIPE_FETCH_BLOCKED', 'Dane logowania w adresie');
  }
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  let addresses: LookupAddress[];
  if (isIP(host) !== 0) {
    addresses = [{ address: host, family: isIP(host) }];
  } else {
    try {
      addresses = await deps.resolveAll(host);
    } catch {
      throw new SafeFetchError('RECIPE_FETCH_FAILED', `Nie rozwiązano nazwy ${host}`);
    }
  }
  if (addresses.length === 0 || !addresses.every((entry) => isPublicAddress(entry.address))) {
    throw new SafeFetchError('RECIPE_FETCH_BLOCKED', `Adres ${host} nie jest publiczny`);
  }
  return addresses;
}

/**
 * Funkcja `lookup`, która zwraca **wyłącznie** wcześniej sprawdzone adresy.
 *
 * @param addresses - Sprawdzone adresy.
 * @returns `lookup` dla `http.get`.
 */
function pinnedLookup(addresses: readonly LookupAddress[]): LookupFunction {
  return ((
    _hostname: string,
    options: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) => {
    const [first] = addresses;
    if (options.all === true) callback(null, addresses);
    else callback(null, first?.address, first?.family);
  }) as LookupFunction;
}

/**
 * Dekoduje stronę według kodowania z `Content-Type`, a bez niego — z `<meta charset>`
 * w pierwszym kilobajcie; domyślnie UTF-8 (strony w ISO-8859-2 i windows-1250 dawały
 * „m�ka", ADR-102). Nieznana nazwa kodowania → UTF-8.
 *
 * @param bytes - Treść.
 * @param contentType - Nagłówek `Content-Type`.
 * @returns Tekst strony.
 */
export function decodeHtml(bytes: Buffer, contentType: string): string {
  const charsetIn = (text: string): string | null =>
    /charset\s*=\s*["']?([\w.:-]{1,40})/iu.exec(text)?.[1] ?? null;
  const label = charsetIn(contentType) ?? charsetIn(bytes.subarray(0, 1024).toString('latin1'));
  try {
    return new TextDecoder(label ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Czyta treść odpowiedzi z limitem rozmiaru — przerywa strumień po przekroczeniu.
 *
 * @param response - Odpowiedź.
 * @param maxBytes - Limit.
 * @returns Treść zdekodowana według kodowania strony.
 * @throws {SafeFetchError} Gdy strona jest za duża.
 */
async function readLimited(response: IncomingMessage, maxBytes: number): Promise<string> {
  const declared = Number(response.headers['content-length'] ?? '0');
  if (declared > maxBytes) {
    response.destroy();
    throw new SafeFetchError('RECIPE_FETCH_FAILED', 'Strona za duża');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.length;
    if (total > maxBytes) {
      response.destroy();
      throw new SafeFetchError('RECIPE_FETCH_FAILED', 'Strona za duża');
    }
    chunks.push(buffer);
  }
  return decodeHtml(Buffer.concat(chunks), String(response.headers['content-type'] ?? ''));
}

/** Limity pobrania. */
export interface SafeFetchLimits {
  /** Czas całego pobrania. */
  readonly timeoutMs: number;
  /** Najwięcej bajtów treści. */
  readonly maxBytes: number;
  /** Najwięcej przekierowań. */
  readonly maxRedirects: number;
}

/** Wynik pobrania. */
export interface SafeFetchResult {
  /** Ostateczny adres po przekierowaniach. */
  readonly url: string;
  readonly html: string;
}

/**
 * Pobiera stronę HTML spod adresu podanego przez użytkownika.
 *
 * @param rawUrl - Adres od użytkownika.
 * @param deps - Zależności sieciowe (testy).
 * @param limits - Limity (testy).
 * @returns Adres końcowy i treść HTML.
 * @throws {SafeFetchError} Przy adresie niedozwolonym albo nieudanym pobraniu.
 */
export async function safeFetchHtml(
  rawUrl: string,
  deps: SafeFetchDeps = defaultSafeFetchDeps,
  limits: SafeFetchLimits = SAFE_FETCH_LIMITS,
): Promise<SafeFetchResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError('RECIPE_FETCH_BLOCKED', 'Niepoprawny adres');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, limits.timeoutMs);
  try {
    for (let redirect = 0; ; redirect += 1) {
      const addresses = await checkedAddresses(url, deps);
      let response: IncomingMessage;
      try {
        response = await deps.get(url, {
          lookup: pinnedLookup(addresses),
          headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
          signal: controller.signal,
        });
      } catch {
        throw new SafeFetchError(
          'RECIPE_FETCH_FAILED',
          controller.signal.aborted ? 'Przekroczony czas' : `Połączenie z ${url.hostname} nieudane`,
        );
      }
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location !== undefined) {
        response.destroy();
        if (redirect >= limits.maxRedirects) {
          throw new SafeFetchError('RECIPE_FETCH_FAILED', 'Za dużo przekierowań');
        }
        try {
          url = new URL(response.headers.location, url);
        } catch {
          throw new SafeFetchError('RECIPE_FETCH_FAILED', 'Zły adres przekierowania');
        }
        continue;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        throw new SafeFetchError('RECIPE_FETCH_FAILED', `Status ${String(status)}`);
      }
      const type = String(response.headers['content-type'] ?? '').toLowerCase();
      if (!type.startsWith('text/html') && !type.startsWith('application/xhtml+xml')) {
        response.destroy();
        throw new SafeFetchError('RECIPE_FETCH_FAILED', 'To nie jest strona HTML');
      }
      try {
        return { url: url.toString(), html: await readLimited(response, limits.maxBytes) };
      } catch (error) {
        if (error instanceof SafeFetchError) throw error;
        throw new SafeFetchError(
          'RECIPE_FETCH_FAILED',
          controller.signal.aborted ? 'Przekroczony czas' : 'Przerwane pobieranie',
        );
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
