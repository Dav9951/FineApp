import { describe, expect, it } from 'vitest';

import {
  RECIPE_TEXT_MAX,
  recipeSourceFromHtml,
  structuredRecipeText,
  visibleText,
} from './shopping.recipe-source.js';

/** Wyłuskiwanie przepisu ze strony (08 §17.4). */

describe('structuredRecipeText (JSON-LD)', () => {
  it('przepis w @graph z @type jako tablica, encje zdekodowane', () => {
    const html = `<html><head>
      <script type="application/ld+json">{ zepsuty</script>
      <script type='application/ld+json'>${JSON.stringify({
        '@graph': [
          { '@type': 'WebPage', name: 'Strona' },
          {
            '@type': ['Recipe', 'Thing'],
            name: 'Brownie &amp; orzechy',
            recipeYield: ['12', '12 kawałków'],
            recipeIngredient: ['200 g czekolady', '', 3, '4 jajka &#8211; duże'],
          },
        ],
      })}</script></head><body>…</body></html>`;
    expect(structuredRecipeText(html)).toBe(
      [
        'Tytuł: Brownie & orzechy',
        'Porcje: 12, 12 kawałków',
        'Składniki:',
        '- 200 g czekolady',
        '- 3',
        '- 4 jajka – duże',
      ].join('\n'),
    );
  });

  it('brak przepisu, przepis bez składników, niezamknięty skrypt → null', () => {
    expect(structuredRecipeText('<p>nic</p>')).toBeNull();
    expect(
      structuredRecipeText(
        `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'X' })}</script>`,
      ),
    ).toBeNull();
    expect(structuredRecipeText('<script type="application/ld+json">{"@type":"Recipe"')).toBeNull();
    expect(structuredRecipeText('<script type="application/ld+json" ')).toBeNull();
  });

  it('pole ingredients (starsza nazwa) i przepis jako tablica', () => {
    const html = `<script type="application/ld+json">${JSON.stringify([
      { '@type': 'Recipe', ingredients: ['mąka'] },
    ])}</script>`;
    expect(structuredRecipeText(html)).toBe('Składniki:\n- mąka');
  });
});

describe('visibleText', () => {
  it('bez skryptów, nawigacji i komentarzy; bloki jako nowe linie', () => {
    const html = `<header>Menu</header><!-- komentarz --><nav class="x">Linki</nav><navbar>zostaje</navbar>
      <h1>Brownie</h1><p>Składniki:</p><ul><li>200&nbsp;g czekolady</li><li>4 jajka</li></ul>
      <script>alert(1)</script><style>p{}</style><footer>Stopka</footer>`;
    expect(visibleText(html)).toBe('zostaje\nBrownie\nSkładniki:\n200 g czekolady\n4 jajka');
  });

  it('niezamknięte bloki i znaczniki ucinają resztę, zamiast się zawieszać', () => {
    expect(visibleText('tekst <script>reszta')).toBe('tekst');
    expect(visibleText('tekst <!-- reszta')).toBe('tekst');
    expect(visibleText('tekst <b')).toBe('tekst');
    expect(visibleText('a<script>b</script')).toBe('a');
  });

  it('złośliwa strona (tysiące niedomkniętych znaczników) przechodzi szybko', () => {
    const started = Date.now();
    visibleText('<'.repeat(1_000_000));
    visibleText('<nav '.repeat(200_000));
    visibleText('<!--'.repeat(200_000));
    structuredRecipeText('<script type="application/ld+json">'.repeat(100_000));
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('ucina do limitu', () => {
    expect(visibleText('a'.repeat(RECIPE_TEXT_MAX + 10))).toHaveLength(RECIPE_TEXT_MAX);
  });
});

describe('recipeSourceFromHtml', () => {
  it('JSON-LD ma pierwszeństwo, bez niego — tekst strony', () => {
    const ld = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', recipeIngredient: ['sól'] })}</script><p>x</p>`;
    expect(recipeSourceFromHtml(ld)).toEqual({ text: 'Składniki:\n- sól', structured: true });
    expect(recipeSourceFromHtml('<p>Przepis</p>')).toEqual({ text: 'Przepis', structured: false });
  });
});
