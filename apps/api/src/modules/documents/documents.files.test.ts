import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  countPdfPages,
  normalizeUpload,
  readStoredFile,
  removeStoredFiles,
  resolveStoredPath,
  sniffMediaType,
  storagePathFor,
  thumbnailPathFor,
  writeStoredFiles,
} from './documents.files.js';
import { tinyPdf } from '../../../test/documents-fixtures.js';

/**
 * Testy plików dokumentów (`F7-1`, `F7-2`, 09 §7).
 */

/**
 * Zdjęcie JPEG 40×20 z EXIF-em (GPS i orientacja „obrót o 90°").
 *
 * @returns Zawartość pliku.
 */
async function photoWithExif(): Promise<Buffer> {
  const withGps = await sharp({
    create: { width: 40, height: 20, channels: 3, background: '#ffffff' },
  })
    .jpeg()
    .withExif({ IFD0: { Make: 'Telefon' }, IFD3: { GPSLatitudeRef: 'N' } })
    .toBuffer();
  // `withMetadata` zachowuje EXIF źródła i dokłada znacznik orientacji.
  return sharp(withGps).withMetadata({ orientation: 6 }).jpeg().toBuffer();
}

describe('sniffMediaType', () => {
  it('rozpoznaje typ po zawartości, nie po nazwie', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    const webp = await sharp(png).webp().toBuffer();
    expect(sniffMediaType(await photoWithExif())).toBe('image/jpeg');
    expect(sniffMediaType(png)).toBe('image/png');
    expect(sniffMediaType(webp)).toBe('image/webp');
    expect(sniffMediaType(tinyPdf(1))).toBe('application/pdf');
    expect(sniffMediaType(Buffer.from('\0\0\0\x18ftypheic\0\0\0\0', 'latin1'))).toBe('image/heic');
  });

  it('odrzuca wszystko inne — także skrypt z rozszerzeniem .jpg', () => {
    expect(sniffMediaType(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffMediaType(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffMediaType(new Uint8Array())).toBeNull();
  });
});

describe('countPdfPages', () => {
  it('czyta /Count z drzewa stron', () => {
    expect(countPdfPages(tinyPdf(1))).toBe(1);
    expect(countPdfPages(tinyPdf(7))).toBe(7);
  });

  it('bez /Count liczy obiekty /Type /Page; bez niczego — null', () => {
    expect(countPdfPages(Buffer.from('%PDF-1.4 << /Type /Page >> << /Type /Page >>'))).toBe(2);
    expect(countPdfPages(Buffer.from('%PDF-1.5 /ObjStm'))).toBeNull();
  });
});

describe('normalizeUpload', () => {
  it('usuwa EXIF (w tym GPS), obraca według orientacji i robi miniaturę', async () => {
    const source = await photoWithExif();
    const before = await sharp(source).metadata();
    expect(before.exif?.includes(Buffer.from('Telefon'))).toBe(true);
    expect(before.orientation).toBe(6);

    const result = await normalizeUpload(source, 'image/jpeg');

    const meta = await sharp(result.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    // Orientacja 6 = obrót o 90°: 40×20 staje się 20×40.
    expect([meta.width, meta.height]).toEqual([20, 40]);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.thumbnail).not.toBeNull();
  });

  it('PNG zapisuje jako JPEG', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#123' } })
      .png()
      .toBuffer();
    const result = await normalizeUpload(png, 'image/png');
    expect(sniffMediaType(result.bytes)).toBe('image/jpeg');
  });

  it('PDF > 5 stron → 422; do 5 stron bez zmian', async () => {
    await expect(normalizeUpload(tinyPdf(6), 'application/pdf')).rejects.toMatchObject({
      statusCode: 422,
      message: 'Wyciąg ma więcej niż 5 stron. Podziel plik.',
    });
    const ok = await normalizeUpload(tinyPdf(5), 'application/pdf');
    expect(ok).toMatchObject({ mimeType: 'application/pdf', pageCount: 5, thumbnail: null });
  });

  it('nieczytelny obraz (np. HEIC bez dekodera) → 415 z podpowiedzią', async () => {
    await expect(
      normalizeUpload(Buffer.from('\0\0\0\x18ftypheic\0\0\0\0junk', 'latin1'), 'image/heic'),
    ).rejects.toMatchObject({ statusCode: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });
});

describe('ścieżki i zapis', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fineapp-files-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('RRRR/MM/<id>.<ext> z dnia wrzucenia; miniatura obok', () => {
    const path = storagePathFor('01JP7K3M2N8Q4R5S6T7V8W9X0A', '2026-09-18', 'image/jpeg');
    expect(path).toBe('2026/09/01JP7K3M2N8Q4R5S6T7V8W9X0A.jpg');
    expect(thumbnailPathFor(path)).toBe('2026/09/01JP7K3M2N8Q4R5S6T7V8W9X0A.thumb.jpg');
    expect(storagePathFor('X', '2026-01-02', 'application/pdf')).toBe('2026/01/X.pdf');
  });

  it('nie wychodzi poza katalog uploadów', () => {
    expect(() => resolveStoredPath(dir, '../../etc/passwd')).toThrow();
    expect(resolveStoredPath(dir, '2026/09/a.jpg')).toBe(join(dir, '2026/09/a.jpg'));
  });

  it('zapis, odczyt obu wariantów i usunięcie', async () => {
    const file = await normalizeUpload(await photoWithExif(), 'image/jpeg');
    await writeStoredFiles(dir, '2026/09/a.jpg', file);
    expect(await readStoredFile(dir, '2026/09/a.jpg')).toEqual(file.bytes);
    expect(await readStoredFile(dir, '2026/09/a.jpg', 'thumb')).toEqual(file.thumbnail);

    await removeStoredFiles(dir, '2026/09/a.jpg');
    await expect(readStoredFile(dir, '2026/09/a.jpg')).rejects.toThrow();
    await removeStoredFiles(dir, '2026/09/a.jpg');
  });
});
