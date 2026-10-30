import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// `sharp` jest zależnością API, nie narzędzi projektowych — rozwiązujemy go jawnie
// stamtąd, zamiast dublować zależność tylko po to, żeby raz wygenerować ikony.
const sharp = createRequire(join(ROOT, 'apps', 'api', 'package.json'))('sharp');

/**
 * Generator ikon PWA z tokenów design systemu.
 *
 * Motywem jest pierścień wykonania celu procentowego — sygnaturowy element dashboardu
 * z `plans/15-design-system.md` (ADR-013). Ikona nie jest więc dowolnym obrazkiem,
 * tylko tym samym kształtem, który użytkownik widzi w aplikacji.
 *
 * Kolory pochodzą z `apps/web/src/styles/tokens.css` (motyw jasny):
 *   --primary    212 62% 26%  #19406b   tło
 *   --background  40 32% 96%  #f8f6f2   ścieżka pierścienia
 *   --income     164 54% 32%  #267e66   wypełnienie
 *
 * Uruchomienie (sharp jest zależnością API):
 *   cd apps/api && node ../../design/tools/generate-icons.mjs
 */

const PRIMARY = '#19406b';
const PAPER = '#f8f6f2';
const INCOME = '#59c5a8';

const OUT_DIR = join(ROOT, 'apps', 'web', 'public');

/**
 * Buduje SVG ikony.
 *
 * @param size - Bok kwadratu w pikselach.
 * @param options - Opcje rysowania.
 * @param options.maskable - Czy zostawić margines bezpieczeństwa wymagany przez maskable.
 * @param options.rounded - Czy zaokrąglić narożniki (nie dla maskable — maskę nakłada system).
 * @returns Treść pliku SVG.
 */
function icon(size, { maskable = false, rounded = true } = {}) {
  const center = size / 2;
  // Maskable: system może przyciąć do 20% z każdej strony, więc znak mieści się
  // w bezpiecznym okręgu o średnicy 80% boku.
  const scale = maskable ? 0.58 : 0.74;
  const radius = (size * scale) / 2;
  const stroke = size * (maskable ? 0.1 : 0.13);
  const circumference = 2 * Math.PI * radius;
  // Pierścień wypełniony w 72% — celowo nie w całości, bo ikona ma pokazywać
  // postęp, a nie stan osiągnięty.
  const filled = circumference * 0.72;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" ${rounded ? `rx="${size * 0.22}"` : ''} fill="${PRIMARY}"/>
  <circle cx="${center}" cy="${center}" r="${radius}" fill="none"
    stroke="${PAPER}" stroke-opacity="0.28" stroke-width="${stroke}"/>
  <circle cx="${center}" cy="${center}" r="${radius}" fill="none"
    stroke="${INCOME}" stroke-width="${stroke}" stroke-linecap="round"
    stroke-dasharray="${filled} ${circumference - filled}"
    transform="rotate(-90 ${center} ${center})"/>
</svg>`;
}

mkdirSync(OUT_DIR, { recursive: true });

writeFileSync(join(OUT_DIR, 'favicon.svg'), icon(64));
console.log('favicon.svg');

const targets = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-512-maskable.png', 512, { maskable: true, rounded: false }],
  ['apple-touch-icon.png', 180, { maskable: false }],
];

for (const [name, size, options] of targets) {
  const png = await sharp(Buffer.from(icon(size, options))).png().toBuffer();
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`${name} (${size}×${size}, ${png.length} B)`);
}
