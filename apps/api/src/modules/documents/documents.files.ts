import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import sharp from 'sharp';

import { DomainRuleViolationError, UnsupportedMediaTypeError } from '../../core/errors.js';

/**
 * Pliki dokumentów: rozpoznanie typu, normalizacja, zapis na dysk
 * ([08 §3, §12](../../../../../plans/08-ocr-ai-pipeline.md#12-przechowywanie-plików),
 * [09 §7](../../../../../plans/09-security-auth.md#7-bezpieczeństwo-uploadów), `F7-1`, `F7-2`).
 *
 * Typ rozpoznajemy **po zawartości**, nie po nagłówku `Content-Type` ani rozszerzeniu —
 * oba ustawia klient. Zdjęcie przechodzi przez `sharp` jeszcze przed zapisem: obrót
 * z EXIF, ponowne zakodowanie do JPEG i **bez metadanych** (GPS ze sklepu nie trafia ani
 * na dysk, ani do usługi zewnętrznej). Ponowne kodowanie usuwa też wszystko, co ktoś
 * dokleił do pliku za danymi obrazu.
 */

/** Typy przyjmowane przy wrzuceniu (04 §13). */
export type UploadMediaType =
  'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'application/pdf';

/** Najwięcej stron PDF-u (08 §3). */
export const PDF_MAX_PAGES = 5;

/** Dłuższy bok miniatury (08 §12). */
const THUMBNAIL_EDGE_PX = 320;

/** Jakość JPEG-a zapisywanego jako oryginał — kompromis rozmiaru i czytelności drobnego druku. */
const STORED_JPEG_QUALITY = 85;

/** Marki kontenera ISO-BMFF oznaczające HEIC/HEIF ze zdjęć telefonu. */
const HEIF_BRANDS: ReadonlySet<string> = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
]);

/**
 * Rozpoznaje typ pliku po pierwszych bajtach („magic bytes").
 *
 * @param bytes - Początek pliku (wystarczy 16 bajtów).
 * @returns Typ albo `null`, gdy to nic z obsługiwanych.
 */
export function sniffMediaType(bytes: Uint8Array): UploadMediaType | null {
  const ascii = (from: number, to: number): string =>
    String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)
  ) {
    return 'image/png';
  }
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(8, 12))) {
    return 'image/heic';
  }
  if (bytes.length >= 5 && ascii(0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

/**
 * Liczy strony PDF-u bez biblioteki do PDF-ów.
 *
 * Czyta słowniki `/Type /Pages` z `/Count` (największy to korzeń drzewa stron), a gdy
 * ich nie ma — liczy obiekty `/Type /Page`. PDF z drzewem stron w skompresowanym
 * strumieniu obiektów nie odsłania ani jednego, wtedy wynik to `null` i dokument
 * przechodzi dalej: usługa AI sama ma limit stron, a pomylenie się w dół (odrzucenie
 * poprawnego wyciągu) byłoby gorsze niż w górę (ADR-059).
 *
 * @param bytes - Zawartość pliku.
 * @returns Liczba stron albo `null`, gdy nie da się jej odczytać.
 */
export function countPdfPages(bytes: Uint8Array): number | null {
  const text = Buffer.from(bytes).toString('latin1');
  let maxCount = 0;
  for (const match of text.matchAll(
    /\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/gu,
  )) {
    const count = Number(match[1] ?? match[2]);
    if (count > maxCount) maxCount = count;
  }
  if (maxCount > 0) return maxCount;
  const pages = text.match(/\/Type\s*\/Page(?![a-zA-Z])/gu)?.length ?? 0;
  return pages > 0 ? pages : null;
}

/** Plik po normalizacji — gotowy do zapisu. */
export interface NormalizedUpload {
  /** Zawartość do zapisania jako oryginał. */
  readonly bytes: Buffer;
  /** Typ zapisanego pliku — zdjęcia zawsze jako JPEG. */
  readonly mimeType: 'image/jpeg' | 'application/pdf';
  readonly pageCount: number | null;
  /** Miniatura 320 px; PDF jej nie ma. */
  readonly thumbnail: Buffer | null;
}

/**
 * Normalizuje wrzucony plik: zdjęcie → JPEG bez metadanych + miniatura; PDF → bez zmian
 * po sprawdzeniu liczby stron.
 *
 * `sharp` bez `withMetadata()` nie przenosi EXIF-u, a `rotate()` bez argumentów najpierw
 * obraca zdjęcie według znacznika orientacji — inaczej po usunięciu EXIF-u paragon
 * zrobiony w pionie leżałby na boku.
 *
 * @param bytes - Zawartość wrzuconego pliku.
 * @param mediaType - Typ rozpoznany po zawartości.
 * @returns Plik do zapisania.
 * @throws {UnsupportedMediaTypeError} Gdy zdjęcia nie da się odczytać (np. HEIC bez dekodera).
 * @throws {DomainRuleViolationError} Gdy PDF ma więcej niż 5 stron.
 */
export async function normalizeUpload(
  bytes: Buffer,
  mediaType: UploadMediaType,
): Promise<NormalizedUpload> {
  if (mediaType === 'application/pdf') {
    const pageCount = countPdfPages(bytes);
    if (pageCount !== null && pageCount > PDF_MAX_PAGES) {
      throw new DomainRuleViolationError(
        `Wyciąg ma więcej niż ${String(PDF_MAX_PAGES)} stron. Podziel plik.`,
        [{ path: 'file', message: `Stron: ${String(pageCount)}` }],
      );
    }
    return { bytes, mimeType: 'application/pdf', pageCount, thumbnail: null };
  }

  try {
    const stored = await sharp(bytes).rotate().jpeg({ quality: STORED_JPEG_QUALITY }).toBuffer();
    const thumbnail = await sharp(stored)
      .resize({ width: THUMBNAIL_EDGE_PX, height: THUMBNAIL_EDGE_PX, fit: 'inside' })
      .jpeg({ quality: 70 })
      .toBuffer();
    return { bytes: stored, mimeType: 'image/jpeg', pageCount: 1, thumbnail };
  } catch {
    // Prekompilowany `sharp` nie ma dekodera HEVC — HEIC z iPhone'a zamienia na JPEG
    // przeglądarka przed wysyłką (`F7-9`). Tu trafia tylko to, czego nie umiała.
    throw new UnsupportedMediaTypeError(
      mediaType === 'image/heic'
        ? 'Nie udało się odczytać zdjęcia HEIC. Wybierz zdjęcie w formacie JPG albo zmień w aparacie format na „Najbardziej zgodny".'
        : 'Nie udało się odczytać zdjęcia. Plik jest uszkodzony albo nie jest obrazem.',
    );
  }
}

/**
 * Buduje ścieżkę pliku względem `UPLOAD_DIR`: `RRRR/MM/<id>.<rozszerzenie>`.
 *
 * Ścieżka powstaje wyłącznie z ULID-a i daty, więc przejście katalogu jest niemożliwe
 * z samej konstrukcji — nazwa pliku od klienta nie jest nigdzie użyta (09 §7).
 *
 * @param documentId - Identyfikator dokumentu.
 * @param uploadedOn - Dzień wrzucenia `YYYY-MM-DD` w strefie gospodarstwa.
 * @param mimeType - Typ zapisywanego pliku.
 * @returns Ścieżka względna.
 */
export function storagePathFor(
  documentId: string,
  uploadedOn: string,
  mimeType: NormalizedUpload['mimeType'],
): string {
  const extension = mimeType === 'application/pdf' ? 'pdf' : 'jpg';
  return `${uploadedOn.slice(0, 4)}/${uploadedOn.slice(5, 7)}/${documentId}.${extension}`;
}

/**
 * Ścieżka miniatury obok oryginału: `<id>.thumb.jpg`.
 *
 * @param storagePath - Ścieżka oryginału względem `UPLOAD_DIR`.
 * @returns Ścieżka miniatury.
 */
export function thumbnailPathFor(storagePath: string): string {
  return storagePath.replace(/\.[a-z]+$/u, '.thumb.jpg');
}

/**
 * Zamienia ścieżkę względną na bezwzględną, pilnując, żeby nie wyszła poza `UPLOAD_DIR`.
 *
 * Ścieżki budujemy sami, więc to obrona na wypadek przyszłego błędu, nie ataku z dziś.
 *
 * @param uploadDir - Katalog uploadów.
 * @param relativePath - Ścieżka względna z bazy.
 * @returns Ścieżka bezwzględna.
 * @throws {Error} Gdy ścieżka wychodzi poza katalog.
 */
export function resolveStoredPath(uploadDir: string, relativePath: string): string {
  const root = resolve(uploadDir);
  const full = resolve(root, relativePath);
  const rel = relative(root, full);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Ścieżka pliku poza katalogiem uploadów.');
  }
  return full;
}

/**
 * Zapisuje plik (i miniaturę) na dysk, tworząc katalogi.
 *
 * @param uploadDir - Katalog uploadów.
 * @param storagePath - Ścieżka względna oryginału.
 * @param file - Znormalizowany plik.
 */
export async function writeStoredFiles(
  uploadDir: string,
  storagePath: string,
  file: NormalizedUpload,
): Promise<void> {
  const full = resolveStoredPath(uploadDir, storagePath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, file.bytes, { flag: 'wx' });
  if (file.thumbnail !== null) {
    await writeFile(resolveStoredPath(uploadDir, thumbnailPathFor(storagePath)), file.thumbnail);
  }
}

/**
 * Czyta zapisany plik albo jego miniaturę.
 *
 * @param uploadDir - Katalog uploadów.
 * @param storagePath - Ścieżka względna oryginału.
 * @param variant - `original` albo `thumb`.
 * @returns Zawartość pliku.
 */
export async function readStoredFile(
  uploadDir: string,
  storagePath: string,
  variant: 'original' | 'thumb' = 'original',
): Promise<Buffer> {
  const path = variant === 'thumb' ? thumbnailPathFor(storagePath) : storagePath;
  return readFile(resolveStoredPath(uploadDir, path));
}

/**
 * Usuwa oryginał i miniaturę; brak pliku nie jest błędem.
 *
 * @param uploadDir - Katalog uploadów.
 * @param storagePath - Ścieżka względna oryginału.
 */
export async function removeStoredFiles(uploadDir: string, storagePath: string): Promise<void> {
  await rm(resolveStoredPath(uploadDir, storagePath), { force: true });
  await rm(resolveStoredPath(uploadDir, thumbnailPathFor(storagePath)), { force: true });
}
