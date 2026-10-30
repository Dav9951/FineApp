/**
 * Kategorie domyślne wstawiane przez seed ([03 §5](../../../../../plans/03-data-model.md#5-kategorie-domyślne-seed)).
 *
 * Pole `aiHints` jest tu **kluczowe**: to ono decyduje o jakości automatycznej
 * kategoryzacji z paragonów (wymagania #4 i #5). Model widzi wszystkie kategorie wraz
 * z podpowiedziami, więc „Biedronka, Lidl, Żabka" przy *Jedzeniu* robi więcej niż
 * najlepszy prompt.
 *
 * Podpowiedzi przypisane są do kategorii, w której wierszu występują w `03 §5` — nie
 * rozdzielam ich samowolnie na podkategorie. Dostrojenie ich do liści to zadanie Fazy 7,
 * mierzone na prawdziwych paragonach (`Z-5`), a nie zgadywane przy seedzie.
 *
 * **Przychód z działalności wpisujemy netto** (ADR-012): nie ma tu kategorii „US" ani
 * „ZUS", bo podatek i ZUS nie przechodzą przez księgę.
 */

/** Pojedyncza kategoria w danych seeda. */
export interface SeedCategory {
  /** Nazwa widoczna dla użytkownika, po polsku. */
  readonly name: string;
  /** Lista podpowiedzi dla AI, po przecinku. */
  readonly aiHints?: string;
  /** Podkategorie — hierarchia jest jednopoziomowa (niezmiennik I-11). */
  readonly children?: readonly SeedCategory[];
}

/** Kategorie wydatkowe. */
export const EXPENSE_CATEGORIES: readonly SeedCategory[] = [
  {
    name: 'Mieszkanie',
    aiHints: 'wspólnota, spółdzielnia, Tauron, PGNiG, Orange, Play',
    children: [
      { name: 'Czynsz' },
      { name: 'Rata kredytu' },
      { name: 'Prąd' },
      { name: 'Gaz' },
      { name: 'Woda' },
      { name: 'Internet i TV' },
      { name: 'Śmieci' },
    ],
  },
  {
    name: 'Jedzenie',
    aiHints: 'Biedronka, Lidl, Żabka, Kaufland, Auchan, Carrefour, Glovo, Uber Eats',
    children: [
      { name: 'Zakupy spożywcze' },
      { name: 'Restauracje' },
      { name: 'Praca/lunch' },
      { name: 'Kawa' },
    ],
  },
  {
    name: 'Transport',
    aiHints: 'Orlen, BP, Shell, Circle K, ZTM, Uber, Bolt',
    children: [
      { name: 'Paliwo' },
      { name: 'Komunikacja miejska' },
      { name: 'Taxi' },
      { name: 'Serwis' },
      { name: 'Ubezpieczenie OC/AC' },
      { name: 'Parking' },
      { name: 'Autostrady' },
    ],
  },
  {
    name: 'Zdrowie',
    aiHints: 'Apteka, Doz, Medicover, Luxmed, Gemini',
    children: [
      { name: 'Lekarz' },
      { name: 'Apteka' },
      { name: 'Badania' },
      { name: 'Rehabilitacja' },
      { name: 'Abonament medyczny' },
    ],
  },
  {
    name: 'Dom',
    aiHints: 'Rossmann, Hebe, IKEA, Leroy Merlin, Castorama, Jysk',
    children: [
      { name: 'Chemia i higiena' },
      { name: 'Wyposażenie' },
      { name: 'Remont' },
      { name: 'Ogród' },
    ],
  },
  {
    name: 'Dzieci',
    children: [
      { name: 'Żłobek/przedszkole' },
      { name: 'Zajęcia' },
      { name: 'Ubrania' },
      { name: 'Zabawki' },
    ],
  },
  {
    name: 'Zwierzęta',
    children: [{ name: 'Karma' }, { name: 'Weterynarz' }],
  },
  { name: 'Ubrania i obuwie', aiHints: 'Zalando, H&M, Reserved, CCC, Zara' },
  {
    name: 'Uroda',
    children: [{ name: 'Fryzjer' }, { name: 'Kosmetyki' }, { name: 'Kosmetyczka' }],
  },
  {
    name: 'Rozrywka',
    aiHints: 'Multikino, Empik, Decathlon',
    children: [
      { name: 'Kino i wydarzenia' },
      { name: 'Hobby' },
      { name: 'Książki' },
      { name: 'Sport i siłownia' },
    ],
  },
  {
    name: 'Subskrypcje',
    aiHints: 'Netflix, Spotify, YouTube, iCloud, Google One, Adobe',
    children: [{ name: 'Streaming' }, { name: 'Oprogramowanie' }, { name: 'Telefon' }],
  },
  {
    name: 'Edukacja',
    aiHints: 'Udemy, Coursera',
    children: [{ name: 'Kursy' }, { name: 'Szkoła' }, { name: 'Materiały' }],
  },
  {
    name: 'Podróże',
    aiHints: 'Booking, Airbnb, Ryanair, Wizzair',
    children: [
      { name: 'Nocleg' },
      { name: 'Transport' },
      { name: 'Wyżywienie' },
      { name: 'Atrakcje' },
    ],
  },
  { name: 'Prezenty i darowizny' },
  {
    name: 'Ubezpieczenia',
    aiHints: 'PZU, Warta, Allianz',
    children: [{ name: 'Na życie' }, { name: 'Majątkowe' }],
  },
  {
    name: 'Działalność (B2B)',
    aiHints: 'wFirma, ifirma, Taxe, biuro rachunkowe, coworking, OVH, home.pl, cyber_Folks',
    children: [
      { name: 'Księgowość' },
      { name: 'Adres wirtualny' },
      { name: 'Oprogramowanie i narzędzia' },
      { name: 'Sprzęt' },
      { name: 'Domeny i hosting' },
      { name: 'Usługi obce' },
    ],
  },
  {
    name: 'Opłaty',
    children: [
      { name: 'Opłaty bankowe' },
      { name: 'Podatek od nieruchomości' },
      { name: 'Inne urzędowe' },
    ],
  },
  { name: 'Inne wydatki' },
];

/** Kategorie przychodowe — płaska lista. */
export const INCOME_CATEGORIES: readonly SeedCategory[] = [
  { name: 'Wynagrodzenie' },
  { name: 'Premia' },
  { name: 'Działalność/B2B' },
  { name: 'Freelance' },
  { name: 'Wynajem' },
  { name: 'Odsetki i dywidendy' },
  { name: 'Zwrot podatku' },
  { name: 'Świadczenia (800+, zasiłki)' },
  { name: 'Sprzedaż' },
  { name: 'Prezent' },
  { name: 'Inne przychody' },
];

/** Kategorie przelewów — płaska lista. */
export const TRANSFER_CATEGORIES: readonly SeedCategory[] = [
  { name: 'Oszczędności' },
  { name: 'Inwestycje' },
  { name: 'Spłata zobowiązań' },
  { name: 'Przelew własny' },
];

/** Mapa znaków diakrytycznych na odpowiedniki łacińskie. */
const DIACRITICS: Readonly<Record<string, string>> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

/**
 * Zamienia nazwę kategorii na identyfikator tekstowy.
 *
 * Polskie znaki diakrytyczne są transliterowane, bo `slug` bywa częścią adresu URL
 * i klucza pamięci podręcznej, gdzie `ż` i `z` potrafią się rozjechać między
 * przeglądarką a serwerem.
 *
 * @param name - Nazwa kategorii.
 * @returns Identyfikator złożony z małych liter, cyfr i myślników.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (char) => DIACRITICS[char] ?? char)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Buduje `slug` podkategorii, poprzedzając go slugiem rodzica.
 *
 * Bez prefiksu dane z `03 §5` łamią `uq_categories_slug`: **„Transport" występuje dwa
 * razy** — jako kategoria główna i jako podkategoria „Podróży" — a obie mają
 * `kind = 'expense'`. Prefiks rozwiązuje ten konflikt i każdy następny tego rodzaju.
 *
 * @param parentName - Nazwa kategorii nadrzędnej.
 * @param childName - Nazwa podkategorii.
 * @returns Identyfikator podkategorii.
 */
export function childSlug(parentName: string, childName: string): string {
  return `${slugify(parentName)}-${slugify(childName)}`;
}
