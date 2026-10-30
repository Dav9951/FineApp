import type { CategoryDto, CategoryTreeDto } from '@fineapp/shared';

import { slugify } from '../../db/seed/categories.js';

/**
 * Czyste reguły kategorii — bez dostępu do bazy.
 *
 * `slugify` pochodzi z seeda celowo: slug kategorii domyślnej i slug kategorii
 * założonej przez użytkownika muszą powstawać **tą samą** funkcją, bo seed rozpoznaje
 * istniejące kategorie właśnie po slugu (ADR-020).
 */

/** Slug zastępczy, gdy z nazwy nie zostaje ani jedna litera ani cyfra (np. same emoji). */
const FALLBACK_SLUG = 'kategoria';

/**
 * Buduje drzewo z płaskiej listy (maks. jeden poziom, I-11).
 *
 * Kolejność zachowuje kolejność wejścia — i wśród kategorii głównych, i wśród dzieci.
 * Dziecko, którego rodzica nie ma na liście (np. rodzic odfiltrowany), trafia na
 * poziom główny: lepiej pokazać kategorię nie na swoim miejscu niż wcale.
 *
 * @param rows - Kategorie posortowane do wyświetlenia.
 * @returns Kategorie główne z podkategoriami.
 */
export function buildCategoryTree(rows: readonly CategoryDto[]): CategoryTreeDto[] {
  const present = new Set(rows.map((row) => row.id));
  const childrenOf = new Map<string, CategoryDto[]>();
  for (const row of rows) {
    if (row.parentId === null || !present.has(row.parentId)) continue;
    const siblings = childrenOf.get(row.parentId) ?? [];
    siblings.push(row);
    childrenOf.set(row.parentId, siblings);
  }
  return rows
    .filter((row) => row.parentId === null || !present.has(row.parentId))
    .map((row) => ({ ...row, children: childrenOf.get(row.id) ?? [] }));
}

/**
 * Spłaszcza drzewo w kolejności wyświetlania: rodzic, jego dzieci, następny rodzic.
 *
 * Taką kolejność widzi `<Select>` z wcięciem podkategorii i taką dostaje prompt AI —
 * podkategoria obok swojego rodzica niesie więcej sensu niż alfabet.
 *
 * @param tree - Drzewo kategorii.
 * @returns Lista płaska.
 */
export function flattenCategoryTree(tree: readonly CategoryTreeDto[]): CategoryDto[] {
  return tree.flatMap(({ children, ...parent }) => [parent, ...children]);
}

/**
 * Łączy podpowiedzi AI dwóch kategorii przy scalaniu (07 §9.3).
 *
 * Najpierw podpowiedzi celu, potem źródła; duplikaty (bez względu na wielkość liter)
 * wypadają. Scalenie „Kawa" w „Restauracje" nie może zgubić słowa „Starbucks" —
 * inaczej po scaleniu AI przestałoby rozpoznawać paragony, które rozpoznawało wcześniej.
 *
 * @param target - Podpowiedzi kategorii docelowej.
 * @param source - Podpowiedzi kategorii scalanej.
 * @returns Połączona lista po przecinku albo `null`, gdy obie są puste.
 */
export function mergeAiHints(target: string | null, source: string | null): string | null {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const hint of `${target ?? ''},${source ?? ''}`.split(',')) {
    const trimmed = hint.trim();
    const key = trimmed.toLocaleLowerCase('pl');
    if (trimmed === '' || seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }
  return merged.length === 0 ? null : merged.join(', ');
}

/**
 * Kolejne kandydatki na slug nowej kategorii.
 *
 * Pierwsza to slug podstawowy (dla podkategorii z prefiksem rodzica — ADR-020), kolejne
 * dostają przyrostek `-2`, `-3`… Kolizja nie musi znaczyć duplikatu nazwy: slug jest
 * stały, więc kategoria przemianowana z „Kawa" na „Kawiarnie" wciąż trzyma `kawa`.
 *
 * @param name - Nazwa nowej kategorii.
 * @param parentSlug - Slug rodzica albo `null` dla kategorii głównej.
 * @yields {string} Kolejne kandydatki na slug — pierwszą wolną wybiera serwis.
 */
export function* slugCandidates(name: string, parentSlug: string | null): Generator<string> {
  const own = slugify(name) || FALLBACK_SLUG;
  const base = parentSlug === null ? own : `${parentSlug}-${own}`;
  yield base;
  for (let suffix = 2; ; suffix += 1) yield `${base}-${suffix}`;
}
