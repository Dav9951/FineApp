import type { ShoppingSection, ShoppingUnit } from '../domain/enums.js';

/**
 * Stałe list zakupów (Faza 10) — [07 §14](../../../../plans/07-domain-rules.md#14-listy-zakupów),
 * [03 §5a](../../../../plans/03-data-model.md#5a-zestaw-startowy-list-zakupów).
 */

/** Nazwa listy zakładanej przy pierwszym wejściu w Zakupy (07 §14.6). */
export const STARTER_LIST_NAME = 'Spożywcze';

/**
 * Zestaw startowy „zawsze w domu" (17 §9, P-4).
 *
 * Tylko start: to zwykłe wpisy słownika z flagą, użytkownik dopisuje i usuwa własne.
 * Mleko, jajka i masło są tu na życzenie właściciela — przy przepisie trafiają do „Już mam".
 */
export const STARTER_STAPLES: readonly { name: string; section: ShoppingSection }[] = [
  { name: 'Sól', section: 'dry_goods' },
  { name: 'Pieprz', section: 'dry_goods' },
  { name: 'Cukier', section: 'dry_goods' },
  { name: 'Mąka pszenna', section: 'dry_goods' },
  { name: 'Olej', section: 'dry_goods' },
  { name: 'Ocet', section: 'dry_goods' },
  { name: 'Proszek do pieczenia', section: 'dry_goods' },
  { name: 'Soda oczyszczona', section: 'dry_goods' },
  { name: 'Mleko', section: 'dairy' },
  { name: 'Jajka', section: 'dairy' },
  { name: 'Masło', section: 'dairy' },
];

/** Polskie nazwy działów do interfejsu i do promptu modelu. */
export const SHOPPING_SECTION_LABELS: Readonly<Record<ShoppingSection, string>> = {
  produce: 'Warzywa i owoce',
  bakery: 'Pieczywo',
  dairy: 'Nabiał i jaja',
  meat_fish: 'Mięso i ryby',
  dry_goods: 'Suche i sypkie',
  frozen: 'Mrożonki',
  drinks: 'Napoje',
  household_chemicals: 'Chemia',
  hygiene: 'Higiena',
  home: 'Dom',
  other: 'Inne',
};

/** Polskie skróty jednostek (ADR-097: w bazie po angielsku, w interfejsie po polsku). */
export const SHOPPING_UNIT_LABELS: Readonly<Record<ShoppingUnit, string>> = {
  pcs: 'szt.',
  pack: 'opak.',
  kg: 'kg',
  g: 'g',
  l: 'l',
  ml: 'ml',
};

/**
 * Słowa kluczowe działów — trzecia podpowiedź działu nowej pozycji, po żądaniu i słowniku
 * (07 §14.5). Klucz to **pierwsze słowo** znormalizowanej nazwy (bez polskich znaków).
 *
 * Lista nie musi być pełna: pomyłka kosztuje jedno dotknięcie, a poprawiony dział
 * zapamiętuje słownik gospodarstwa.
 */
export const SHOPPING_SECTION_KEYWORDS: Readonly<Record<string, ShoppingSection>> = {
  // Warzywa i owoce
  pomidory: 'produce',
  pomidor: 'produce',
  ogorki: 'produce',
  ogorek: 'produce',
  cebula: 'produce',
  czosnek: 'produce',
  ziemniaki: 'produce',
  marchew: 'produce',
  marchewka: 'produce',
  papryka: 'produce',
  salata: 'produce',
  kapusta: 'produce',
  brokul: 'produce',
  pietruszka: 'produce',
  koperek: 'produce',
  szczypiorek: 'produce',
  banany: 'produce',
  jablka: 'produce',
  cytryna: 'produce',
  cytryny: 'produce',
  pomarancze: 'produce',
  winogrona: 'produce',
  truskawki: 'produce',
  awokado: 'produce',
  pieczarki: 'produce',
  // Pieczywo
  chleb: 'bakery',
  bulki: 'bakery',
  bulka: 'bakery',
  bagietka: 'bakery',
  rogale: 'bakery',
  tortilla: 'bakery',
  // Nabiał i jaja
  mleko: 'dairy',
  maslo: 'dairy',
  jajka: 'dairy',
  jaja: 'dairy',
  ser: 'dairy',
  serek: 'dairy',
  twarog: 'dairy',
  jogurt: 'dairy',
  kefir: 'dairy',
  maslanka: 'dairy',
  smietana: 'dairy',
  mozzarella: 'dairy',
  // Mięso i ryby
  kurczak: 'meat_fish',
  piers: 'meat_fish',
  mieso: 'meat_fish',
  mielone: 'meat_fish',
  wolowina: 'meat_fish',
  wieprzowina: 'meat_fish',
  szynka: 'meat_fish',
  kielbasa: 'meat_fish',
  boczek: 'meat_fish',
  parowki: 'meat_fish',
  losos: 'meat_fish',
  ryba: 'meat_fish',
  dorsz: 'meat_fish',
  tunczyk: 'meat_fish',
  // Suche i sypkie
  maka: 'dry_goods',
  cukier: 'dry_goods',
  sol: 'dry_goods',
  pieprz: 'dry_goods',
  ryz: 'dry_goods',
  makaron: 'dry_goods',
  kasza: 'dry_goods',
  platki: 'dry_goods',
  olej: 'dry_goods',
  oliwa: 'dry_goods',
  ocet: 'dry_goods',
  kawa: 'dry_goods',
  herbata: 'dry_goods',
  kakao: 'dry_goods',
  czekolada: 'dry_goods',
  orzechy: 'dry_goods',
  drozdze: 'dry_goods',
  proszek: 'dry_goods',
  soda: 'dry_goods',
  przyprawa: 'dry_goods',
  passata: 'dry_goods',
  koncentrat: 'dry_goods',
  // Mrożonki
  lody: 'frozen',
  mrozonki: 'frozen',
  pierogi: 'frozen',
  frytki: 'frozen',
  // Napoje
  woda: 'drinks',
  sok: 'drinks',
  piwo: 'drinks',
  wino: 'drinks',
  cola: 'drinks',
  // Chemia
  plyn: 'household_chemicals',
  kapsulki: 'household_chemicals',
  tabletki: 'household_chemicals',
  domestos: 'household_chemicals',
  worki: 'household_chemicals',
  gabki: 'household_chemicals',
  // Higiena
  papier: 'hygiene',
  szampon: 'hygiene',
  mydlo: 'hygiene',
  pasta: 'hygiene',
  dezodorant: 'hygiene',
  chusteczki: 'hygiene',
  pieluchy: 'hygiene',
  // Dom
  zarowka: 'home',
  baterie: 'home',
  swieczki: 'home',
};
