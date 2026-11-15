import type { AiLogEntryDto, AiLogLevel } from '@fineapp/shared';

/**
 * Prezentacja dziennika odczytu dokumentów (ADR-086, 06 §3.12).
 *
 * Dziennik czyta człowiek, który szuka przyczyny nieudanego odczytu — dlatego klucze
 * szczegółów mają polskie podpisy, czas jest w sekundach, a rozmiar w KB. Nieznany klucz
 * zostaje pokazany surowo: lepiej `foo: 3` niż nic, gdy API dopisze nowy szczegół.
 */

/** Podpisy znanych szczegółów. */
const DETAIL_LABEL: Readonly<Record<string, string>> = {
  model: 'model',
  kind: 'rodzaj',
  mimeType: 'typ pliku',
  byteSize: 'rozmiar pliku',
  pageCount: 'strony',
  sourceWidth: 'szer. oryginału',
  sourceHeight: 'wys. oryginału',
  width: 'szer. wysłana',
  height: 'wys. wysłana',
  sentKb: 'wysłano',
  categoryCount: 'kategorie w kontekście',
  durationMs: 'czas',
  timeoutMs: 'limit czasu próby',
  maxRetries: 'ponowienia',
  stopReason: 'stop_reason',
  inputTokens: 'tokeny wejścia',
  outputTokens: 'tokeny wyjścia',
  maxOutputTokens: 'limit tokenów wyjścia',
  itemCount: 'pozycje',
  costMinor: 'koszt (gr)',
  requestId: 'id żądania',
  errorCode: 'kod błędu',
  httpStatus: 'status HTTP',
  errorType: 'typ błędu',
  apiMessage: 'komunikat usługi',
  reason: 'przyczyna',
  budgetMinor: 'limit (gr)',
  maxBytes: 'limit rozmiaru',
  maxPages: 'limit stron',
  staleAfterMs: 'uznana za przerwaną po',
};

/**
 * Wartość szczegółu w czytelnej postaci.
 *
 * @param key - Klucz szczegółu.
 * @param value - Wartość z API.
 * @returns Napis do wyświetlenia.
 */
export function detailValue(key: string, value: string | number | boolean | null): string {
  if (value === null) return '—';
  if (typeof value === 'number') {
    if (key === 'durationMs' || key === 'timeoutMs' || key === 'staleAfterMs') {
      return `${(value / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} s`;
    }
    if (key === 'byteSize' || key === 'maxBytes') {
      return `${Math.round(value / 1024).toLocaleString('pl-PL')} KB`;
    }
    if (key === 'sentKb') return `${value.toLocaleString('pl-PL')} KB`;
    if (key === 'sourceWidth' || key === 'sourceHeight' || key === 'width' || key === 'height') {
      return `${String(value)} px`;
    }
    return value.toLocaleString('pl-PL');
  }
  if (typeof value === 'boolean') return value ? 'tak' : 'nie';
  return value;
}

/**
 * Szczegóły wpisu jako pary podpis–wartość, w kolejności z API.
 *
 * @param entry - Wpis dziennika.
 * @returns Pary do listy definicji.
 */
export function detailRows(entry: AiLogEntryDto): { label: string; value: string }[] {
  return Object.entries(entry.details).map(([key, value]) => ({
    label: DETAIL_LABEL[key] ?? key,
    value: detailValue(key, value),
  }));
}

/** Ton plakietki dla wagi wpisu. */
export const LEVEL_TONE: Readonly<Record<AiLogLevel, 'neutral' | 'warning' | 'danger'>> = {
  info: 'neutral',
  warn: 'warning',
  error: 'danger',
};

/** Podpis wagi wpisu. */
export const LEVEL_LABEL: Readonly<Record<AiLogLevel, string>> = {
  info: 'info',
  warn: 'uwaga',
  error: 'błąd',
};

/**
 * Chwila wpisu: dzień i godzina z sekundami — kolejność etapów jednej analizy widać
 * dopiero po sekundach.
 *
 * @param epochMs - Znacznik czasu.
 * @param timezone - Strefa gospodarstwa.
 * @returns Np. „15.11, 17:42:05".
 */
export function logTime(epochMs: number, timezone?: string): string {
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...(timezone === undefined ? {} : { timeZone: timezone }),
  }).format(new Date(epochMs));
}
