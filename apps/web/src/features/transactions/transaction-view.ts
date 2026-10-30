import {
  foldForSearch,
  type AllocationKind,
  type CategoryTreeDto,
  type IncomeSourceKind,
} from '@fineapp/shared';

/**
 * Czyste reguły widoków formularza transakcji: nazwy i wyszukiwanie kategorii.
 */

/** Nazwa rodzaju źródła przychodu — krótka, do siatki wyboru. */
export const INCOME_SOURCE_KIND_LABEL: Readonly<Record<IncomeSourceKind, string>> = {
  salary: 'Pensja',
  business: 'Działalność',
  freelance: 'Zlecenia',
  benefit: 'Świadczenie',
  rental: 'Najem',
  investment: 'Inwestycje',
  refund: 'Zwrot',
  gift: 'Prezent',
  sale: 'Sprzedaż',
  other: 'Inne',
};

/** Pula w bierniku — „zwiększa oszczędności", „zmniejsza spłatę długu". */
export const ALLOCATION_KIND_ACCUSATIVE: Readonly<Record<AllocationKind, string>> = {
  savings: 'oszczędności',
  investment: 'inwestycje',
  debt_repayment: 'spłatę długu',
};

/**
 * Filtruje drzewo kategorii po tekście — bez względu na wielkość liter i ogonki.
 *
 * Trafienie w kategorię główną zostawia ją z **wszystkimi** podkategoriami („jedz"
 * pokazuje całe Jedzenie). Trafienie w podkategorię zostawia ją pod jej rodzicem, żeby
 * „Kawa" nie straciła kontekstu. Pusty tekst — całe drzewo.
 *
 * @param tree - Drzewo kategorii.
 * @param query - Wpisany tekst.
 * @returns Drzewo z kategoriami pasującymi do tekstu.
 */
export function filterCategoryTree(
  tree: readonly CategoryTreeDto[],
  query: string,
): CategoryTreeDto[] {
  const needle = foldForSearch(query.trim());
  if (needle === '') return [...tree];
  const matches = (name: string): boolean => foldForSearch(name).includes(needle);
  return tree.flatMap((parent) => {
    if (matches(parent.name)) return [parent];
    const children = parent.children.filter((child) => matches(child.name));
    return children.length > 0 ? [{ ...parent, children }] : [];
  });
}

/**
 * Nazwa kategorii do wiersza formularza: „Jedzenie › Kawa" dla podkategorii.
 *
 * @param tree - Drzewo kategorii.
 * @param categoryId - Wybrana kategoria.
 * @returns Nazwa albo `undefined`, gdy nie ma jej w drzewie (np. zarchiwizowana).
 */
export function categoryLabel(
  tree: readonly CategoryTreeDto[],
  categoryId: string,
): string | undefined {
  for (const parent of tree) {
    if (parent.id === categoryId) return parent.name;
    const child = parent.children.find((item) => item.id === categoryId);
    if (child !== undefined) return `${parent.name} › ${child.name}`;
  }
  return undefined;
}
