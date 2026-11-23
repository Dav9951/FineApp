/**
 * Tekst przepisu ze strony HTML ([08 §17.4](../../../../../plans/08-ocr-ai-pipeline.md#174-pobranie-przepisu-z-linku)).
 *
 * Najpierw dane strukturalne `schema.org/Recipe` w JSON-LD — mają je prawie wszystkie
 * serwisy kulinarne, a do modelu idzie wtedy kilkaset tokenów zamiast całej strony.
 * Bez nich: widoczny tekst strony, bez skryptów, stylów i nawigacji, ucięty.
 *
 * Bez parsera HTML — wyrażenia regularne wystarczą do wyłuskania bloków JSON-LD i tekstu,
 * a HTML nigdy nie trafia do przeglądarki ani do logów, tylko jako tekst do modelu.
 */

/** Najdłuższy tekst strony wysyłany do modelu (08 §17.4). */
export const RECIPE_TEXT_MAX = 30_000;

/** Przepis wyłuskany ze strony. */
export interface RecipeSource {
  /** Tekst dla modelu. */
  readonly text: string;
  /** Czy pochodzi z danych strukturalnych (do diagnozy). */
  readonly structured: boolean;
}

/**
 * Czy obiekt JSON-LD to przepis (`@type` napis albo tablica z „Recipe").
 *
 * @param value - Węzeł JSON-LD.
 * @returns `true` dla przepisu.
 */
function isRecipe(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as Record<string, unknown>)['@type'];
  return type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
}

/**
 * Szuka przepisu w drzewie JSON-LD: obiekt, tablica albo `@graph`.
 *
 * @param value - Węzeł JSON-LD.
 * @param depth - Głębokość (ochrona przed złośliwie głębokim JSON-em).
 * @returns Przepis albo `null`.
 */
function findRecipe(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || typeof value !== 'object' || value === null) return null;
  if (isRecipe(value)) return value;
  const children = Array.isArray(value)
    ? value
    : [(value as Record<string, unknown>)['@graph']].filter((child) => child !== undefined);
  for (const child of children) {
    const found = findRecipe(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Napis z pola JSON-LD (napis, liczba albo tablica napisów).
 *
 * @param value - Pole.
 * @returns Tekst albo `null`.
 */
function textOf(value: unknown): string | null {
  if (typeof value === 'string') return decodeEntities(value).trim();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(textOf).filter((part): part is string => part !== null && part !== '');
    return parts.length === 0 ? null : parts.join(', ');
  }
  return null;
}

/**
 * Dekoduje najczęstsze encje HTML.
 *
 * @param text - Tekst z encjami.
 * @returns Tekst.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gu, ' ')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&');
}

/** Bloki, których treść nie jest widoczna dla czytelnika strony. */
const HIDDEN_BLOCKS = [
  'script',
  'style',
  'noscript',
  'svg',
  'nav',
  'header',
  'footer',
  'aside',
  'template',
  'iframe',
] as const;

/**
 * Usuwa komentarze HTML — liniowo, bez wyrażeń z cofaniem (ochrona przed ReDoS na
 * złośliwej stronie do 3 MB).
 *
 * @param html - Strona.
 * @returns Strona bez komentarzy.
 */
function stripComments(html: string): string {
  let result = '';
  let position = 0;
  for (;;) {
    const start = html.indexOf('<!--', position);
    if (start < 0) return result + html.slice(position);
    result += html.slice(position, start);
    const end = html.indexOf('-->', start + 4);
    if (end < 0) return result;
    position = end + 3;
  }
}

/**
 * Usuwa bloki `<tag …>…</tag>` — liniowo: szukamy otwarcia i zamknięcia przez `indexOf`
 * na kopii małymi literami. Niezamknięty blok ucina resztę strony.
 *
 * @param html - Strona.
 * @param tags - Nazwy znaczników.
 * @returns Strona bez bloków.
 */
function stripBlocks(html: string, tags: readonly string[]): string {
  let current = html;
  for (const tag of tags) {
    const lower = current.toLowerCase();
    let result = '';
    let position = 0;
    for (;;) {
      const start = findTagStart(lower, tag, position);
      if (start < 0) {
        result += current.slice(position);
        break;
      }
      result += `${current.slice(position, start)} `;
      const end = lower.indexOf(`</${tag}`, start + tag.length + 1);
      if (end < 0) break;
      const close = lower.indexOf('>', end);
      if (close < 0) break;
      position = close + 1;
    }
    current = result;
  }
  return current;
}

/**
 * Początek znacznika `<tag` (z granicą nazwy: `<nav>`, `<nav class…`, ale nie `<navbar>`).
 *
 * @param lower - Strona małymi literami.
 * @param tag - Nazwa znacznika.
 * @param from - Od którego miejsca.
 * @returns Indeks albo `-1`.
 */
function findTagStart(lower: string, tag: string, from: number): number {
  let position = from;
  for (;;) {
    const index = lower.indexOf(`<${tag}`, position);
    if (index < 0) return -1;
    const next = lower.charAt(index + tag.length + 1);
    if (next === '>' || next === '/' || /\s/u.test(next)) return index;
    position = index + 1;
  }
}

/** Znaczniki, po których w tekście zaczyna się nowa linia. */
const LINE_BREAK_TAGS = new Set(['br', 'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'div']);

/**
 * Zamienia znaczniki na odstępy (blokowe — na nowe linie). Liniowo: po `<` szukamy `>`
 * przez `indexOf`; `<` bez `>` kończy tekst.
 *
 * @param html - Strona bez bloków ukrytych.
 * @returns Tekst ze znakami encji.
 */
function stripTags(html: string): string {
  let result = '';
  let position = 0;
  for (;;) {
    const start = html.indexOf('<', position);
    if (start < 0) return result + html.slice(position);
    result += html.slice(position, start);
    const end = html.indexOf('>', start + 1);
    if (end < 0) return result;
    const name = /^\/?([a-z0-9]+)/iu.exec(html.slice(start + 1, Math.min(end, start + 12)));
    result += name !== null && LINE_BREAK_TAGS.has((name[1] ?? '').toLowerCase()) ? '\n' : ' ';
    position = end + 1;
  }
}

/**
 * Treści bloków `<script type="…">` danego typu — liniowo, jak {@link stripBlocks}.
 *
 * @param html - Strona.
 * @param type - Typ skryptu, np. `application/ld+json`.
 * @returns Treści bloków.
 */
function scriptBodies(html: string, type: string): string[] {
  const lower = html.toLowerCase();
  const bodies: string[] = [];
  let position = 0;
  for (;;) {
    const start = findTagStart(lower, 'script', position);
    if (start < 0) return bodies;
    const openEnd = lower.indexOf('>', start);
    if (openEnd < 0) return bodies;
    const end = lower.indexOf('</script', openEnd);
    if (end < 0) return bodies;
    if (lower.slice(start, openEnd).includes(type)) bodies.push(html.slice(openEnd + 1, end));
    position = end + 8;
  }
}

/**
 * Tekst z danych strukturalnych przepisu: tytuł, porcje, składniki.
 *
 * @param html - Strona.
 * @returns Tekst albo `null`, gdy strona nie ma przepisu w JSON-LD.
 */
export function structuredRecipeText(html: string): string | null {
  const blocks = scriptBodies(html, 'application/ld+json');
  for (const body of blocks) {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      continue;
    }
    const recipe = findRecipe(json);
    if (recipe === null) continue;
    const ingredients = recipe.recipeIngredient ?? recipe.ingredients;
    const lines = Array.isArray(ingredients)
      ? ingredients.map(textOf).filter((line): line is string => line !== null && line !== '')
      : [];
    if (lines.length === 0) continue;
    const title = textOf(recipe.name);
    const servings = textOf(recipe.recipeYield);
    return [
      title === null ? null : `Tytuł: ${title}`,
      servings === null ? null : `Porcje: ${servings}`,
      'Składniki:',
      ...lines.map((line) => `- ${line}`),
    ]
      .filter((line): line is string => line !== null)
      .join('\n')
      .slice(0, RECIPE_TEXT_MAX);
  }
  return null;
}

/**
 * Widoczny tekst strony: bez skryptów, stylów, nawigacji, nagłówka, stopki i bocznych
 * ramek; białe znaki zwinięte, ucięty do {@link RECIPE_TEXT_MAX}.
 *
 * @param html - Strona.
 * @returns Tekst.
 */
export function visibleText(html: string): string {
  return decodeEntities(stripTags(stripBlocks(stripComments(html), HIDDEN_BLOCKS)))
    .replace(/[ \t\f\v\r]+/gu, ' ')
    .replace(/\s*\n\s*/gu, '\n')
    .replace(/\n{2,}/gu, '\n')
    .trim()
    .slice(0, RECIPE_TEXT_MAX);
}

/**
 * Przepis ze strony: JSON-LD, a gdy go nie ma — widoczny tekst.
 *
 * @param html - Strona.
 * @returns Tekst dla modelu i skąd pochodzi.
 */
export function recipeSourceFromHtml(html: string): RecipeSource {
  const structured = structuredRecipeText(html);
  return structured === null
    ? { text: visibleText(html), structured: false }
    : { text: structured, structured: true };
}
