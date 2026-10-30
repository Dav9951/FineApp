import sharp from 'sharp';

import type { PreparedPart } from './document-extractor.js';

/**
 * Przygotowanie pliku do analizy ([08 §3](../../../../plans/08-ocr-ai-pipeline.md#3-przygotowanie-obrazu), `F7-2`).
 */

/** Dłuższy bok obrazu wysyłanego do modelu. */
export const VISION_MAX_EDGE_PX = 1568;

/**
 * Przygotowuje plik do analizy przez model.
 *
 * Skalowanie do 1568 px dłuższego boku jest świadome: powyżej tej wartości model
 * i tak przeskalowuje obraz, więc większy plik to wyłącznie wyższy koszt i dłuższy
 * czas odpowiedzi. Metadane EXIF są usuwane, bo zdjęcie paragonu z telefonu zawiera
 * współrzędne GPS, których nie chcemy wysyłać do usługi zewnętrznej — zapisany plik
 * jest już bez nich, ale `sharp` bez `withMetadata()` i tak ich nie przenosi.
 *
 * PDF idzie w całości jako blok dokumentu: model czyta strony sam, a renderowanie
 * stron do obrazów wymagałoby biblioteki PDF, której obraz Dockera nie ma (ADR-059).
 *
 * @param bytes - Zapisany plik (JPEG po normalizacji albo PDF).
 * @param mimeType - Typ zapisanego pliku.
 * @returns Części gotowe do wysłania.
 */
export async function prepareForVision(bytes: Buffer, mimeType: string): Promise<PreparedPart[]> {
  if (mimeType === 'application/pdf') {
    return [{ kind: 'pdf', base64: bytes.toString('base64') }];
  }
  const jpeg = await sharp(bytes)
    .rotate()
    .resize({
      width: VISION_MAX_EDGE_PX,
      height: VISION_MAX_EDGE_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  return [{ kind: 'image', mediaType: 'image/jpeg', base64: jpeg.toString('base64') }];
}
