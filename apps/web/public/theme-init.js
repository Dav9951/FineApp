/*
 * Motyw przed pierwszym malowaniem (ADR-067). Ładowany synchronicznie w <head>, więc
 * użytkownik motywu jasnego nie widzi mignięcia ciemnego tła. Osobny plik, nie
 * wstawka: CSP ma `script-src 'self'` (09 §6). Klucz i kolory — jak w src/lib/theme.ts.
 */
(function () {
  var preference = 'dark';
  try {
    var stored = window.localStorage.getItem('fineapp.theme');
    if (stored === 'light' || stored === 'system') {
      preference = stored;
    }
  } catch {
    // Zablokowane dane witryny — zostaje domyślny ciemny.
  }
  var dark =
    preference === 'dark' ||
    (preference === 'system' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', dark ? '#1a1714' : '#f8f6f2');
  }
})();
