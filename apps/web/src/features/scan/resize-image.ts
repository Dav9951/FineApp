import { CLIENT_MAX_EDGE_PX, fitWithin } from './scan-view.js';

/**
 * Skalowanie zdjęcia w przeglądarce przed wysyłką (`F7-9`, [06 §6](../../../../../plans/06-ui-views.md#6-wydajność)).
 *
 * Zdjęcie z telefonu ma 4000 px i kilka megabajtów; model i tak widzi najwyżej 1568 px.
 * Skalowanie tutaj oszczędza transfer na łączu komórkowym i — przy okazji — zamienia
 * HEIC z iPhone'a na JPEG (Safari umie go odczytać, serwer bez dekodera HEVC — nie)
 * oraz zdejmuje EXIF jeszcze przed wysłaniem. Serwer i tak skaluje ponownie, bo nie
 * ufa wejściu.
 */

/** Plik gotowy do wysłania. */
export interface PreparedUpload {
  readonly blob: Blob;
  readonly filename: string;
  /** Czy przeglądarka przetworzyła zdjęcie (skala, format). */
  readonly processed: boolean;
}

/** Jakość JPEG-a z przeglądarki — drobny druk paragonu musi zostać czytelny. */
const JPEG_QUALITY = 0.85;

/**
 * Nazwa pliku z rozszerzeniem `.jpg`.
 *
 * @param name - Nazwa źródłowa.
 * @returns Nazwa po zmianie rozszerzenia.
 */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^./]+$/u, '');
  return `${base === '' ? 'zdjecie' : base}.jpg`;
}

/**
 * Skaluje zdjęcie do 1568 px dłuższego boku i koduje jako JPEG.
 *
 * PDF i wszystko, czego przeglądarka nie umie odczytać, idzie bez zmian — lepiej
 * wysłać oryginał, niż zablokować wrzucenie. Zmniejszony plik większy od oryginału
 * (mały, mocno skompresowany JPEG) też ustępuje oryginałowi.
 *
 * @param file - Plik wybrany przez użytkownika.
 * @returns Plik do wysłania.
 */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const original: PreparedUpload = { blob: file, filename: file.name, processed: false };
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') {
    return original;
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const size = fitWithin(bitmap.width, bitmap.height, CLIENT_MAX_EDGE_PX);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (context === null) return original;
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
    });
    if (blob === null) return original;
    if (!size.scaled && file.type === 'image/jpeg' && blob.size >= file.size) return original;
    return { blob, filename: jpegName(file.name), processed: true };
  } catch {
    return original;
  }
}
