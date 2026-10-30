# -*- coding: utf-8 -*-
"""
Audyt palety FineApp: kontrast WCAG i rozróżnialność barw przy daltonizmie.

    python3 design/tools/palette_audit.py

Skrypt CZYTA `apps/web/src/styles/tokens.css` — nie trzyma własnej kopii wartości
i nie da się z nim rozjechać. Kod wyjścia: 0 bez naruszeń, 1 są naruszenia.

To wykonywalna wersja dwóch punktów listy kontrolnej z `plans/15-design-system.md` §10:
„kontrast sprawdzony w obu motywach" i „para wpływy/wydatki rozróżnialna przy
deuteranopii". Bez niego oba są deklaracją, a nie faktem.

Progi:
  * tekst względem --background i --card          >= 4,5:1   (WCAG AA)
  * barwy semantyczne także względem --muted      >= 3,0:1   (plakietki i banery)
  * elementy interfejsu (--input, --ring, --primary) >= 3,0:1
  * --border jest separatorem dekoracyjnym i nie podlega progowi
  * pary krytyczne — ΔE76 w widzeniu typowym oraz po symulacji deuteranopii
    i protanopii (macierze Machado 2009, nasilenie pełne)

Dlaczego liczba, a nie „na oko": przy dichromatyzmie z barwy zostaje oś
żółto-niebieska i jasność. --savings (błękit) i --investment (fiolet) różnią się
wtedy niemal wyłącznie jasnością, a stoją na sąsiednich pierścieniach kafla
„Cele procentowe". Oko projektanta z pełnym widzeniem barw tego nie wychwyci.
"""
import pathlib
import re
import sys

TOKENS_CSS = pathlib.Path(__file__).resolve().parents[2] / "apps/web/src/styles/tokens.css"

"""Audyt kontrastu i daltonizmu dla palet FineApp. Wejscie: HSL jak w tokens.css."""
import math, json, sys

def hsl(h, s, l):
    s, l = s/100, l/100
    c = (1-abs(2*l-1))*s
    x = c*(1-abs(((h/60) % 2)-1))
    m = l-c/2
    r, g, b = [(c,x,0),(x,c,0),(0,c,x),(0,x,c),(x,0,c),(c,0,x)][int(h//60) % 6]
    return (r+m, g+m, b+m)

def lin(c):  # sRGB -> linear
    return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4

def unlin(c):
    c = max(0.0, min(1.0, c))
    return c*12.92 if c <= 0.0031308 else 1.055*(c**(1/2.4))-0.055

def lum(rgb):
    r, g, b = [lin(c) for c in rgb]
    return 0.2126*r+0.7152*g+0.0722*b

def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi+0.05)/(lo+0.05)

# Machado 2009, deuteranopia severity 1.0 (w liniowym RGB)
DEUT = [[0.367322, 0.860646, -0.227968],
        [0.280085, 0.672501,  0.047413],
        [-0.011820, 0.042940, 0.968881]]
PROT = [[0.152286, 1.052583, -0.204868],
        [0.114503, 0.786281,  0.099216],
        [-0.003882,-0.048116, 1.051998]]

def simulate(rgb, M):
    r, g, b = [lin(c) for c in rgb]
    out = [M[i][0]*r+M[i][1]*g+M[i][2]*b for i in range(3)]
    return tuple(unlin(c) for c in out)

def to_lab(rgb):
    r, g, b = [lin(c) for c in rgb]
    X = r*0.4124+g*0.3576+b*0.1805
    Y = r*0.2126+g*0.7152+b*0.0722
    Z = r*0.0193+g*0.1192+b*0.9505
    Xn, Yn, Zn = 0.95047, 1.0, 1.08883
    def f(t): return t**(1/3) if t > 0.008856 else (7.787*t+16/116)
    fx, fy, fz = f(X/Xn), f(Y/Yn), f(Z/Zn)
    return (116*fy-16, 500*(fx-fy), 200*(fy-fz))

def de76(c1, c2):
    a, b = to_lab(c1), to_lab(c2)
    return math.sqrt(sum((a[i]-b[i])**2 for i in range(3)))



def hexof(rgb):
    return '#%02x%02x%02x' % tuple(round(max(0, min(1, c)) * 255) for c in rgb)


def parse(tok):
    """Składowe HSL w zapisie tokens.css („40 32% 96%") na sRGB 0..1."""
    h, s, l = tok.replace('%', '').split()
    return hsl(float(h), float(s), float(l))


def read_tokens(path):
    """Wyciąga bloki `:root` i `.dark` z tokens.css.

    Czytamy plik, a nie własną kopię wartości, żeby audyt nie mógł się rozjechać
    z tym, co naprawdę trafia do przeglądarki. Bierzemy tylko tokeny, które
    wyglądają jak składowe HSL — promienie, kroje i cienie pomijamy.
    """
    css = path.read_text(encoding="utf-8")
    # Komentarze wycinamy PRZED parsowaniem. Bez tego zapis w rodzaju
    # „sąsiadując z --investment: jedno i drugie…" wygląda jak deklaracja,
    # a wzorzec wartości połyka wszystko do najbliższego średnika — razem
    # z prawdziwym tokenem stojącym niżej. Audyt milcząco pomijał wtedy
    # cały motyw jasny.
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out = {}
    for label, selector in (("jasny", r":root\s*\{"), ("ciemny", r"\.dark\s*\{")):
        m = re.search(selector, css)
        if not m:
            raise SystemExit(f"Nie znalazłem bloku {selector!r} w {path}")
        depth, i = 1, m.end()
        while depth and i < len(css):           # dopasowanie klamer, bo w środku są @media
            depth += {"{": 1, "}": -1}.get(css[i], 0)
            i += 1
        body = css[m.end():i - 1]
        out[label] = {
            k: v.strip() for k, v in re.findall(r"(--[a-z-]+):\s*([^;\n]+);", body)
            if re.fullmatch(r"[\d.]+\s+[\d.]+%\s+[\d.]+%", v.strip())
        }
    # tokeny motywu jasnego, których ciemny nie nadpisuje, obowiązują w obu
    for k, v in out["jasny"].items():
        out["ciemny"].setdefault(k, v)
    return out


# --- progi rozróżnialności par --------------------------------------------
# (a, b, ΔE typowe, ΔE deuteranopia, ΔE protanopia)
GATES = [
    ("income", "expense",     55, 28, 26),   # wymóg briefu — para najczęściej myląca
    ("savings", "investment", 38, 18, 18),   # sąsiadują na pierścieniach
    ("income", "savings",     32, 20, 20),
    ("income", "investment",  40, 18, 18),
    ("savings", "debt",       40, 20, 18),
    ("investment", "debt",    30, 14, 14),
    ("expense", "debt",       24, 14, 14),
    ("debt", "warning",       30, 18, 18),   # spotykają się przy zaległej racie
    ("expense", "warning",    24, 12, 12),
]

SEMANTIC = ["income", "expense", "savings", "investment", "debt", "warning", "success", "danger"]
UI_TOKENS = ["input", "ring", "primary"]


def audit_theme(label, t):
    """Sprawdza jeden motyw. Zwraca liczbę naruszeń."""
    bad = 0
    missing = [k for k in SEMANTIC + UI_TOKENS + ["background", "card", "muted"] if k not in
               {n.lstrip("-") for n in t}]
    g = lambda k: parse(t["--" + k])
    if missing:
        print(f"  !! brak tokenów: {', '.join('--' + m for m in missing)}")
        return len(missing)

    bg, card, muted = g("background"), g("card"), g("muted")
    print(f"\n--- motyw {label} (tło {hexof(bg)}, kafel {hexof(card)}) ---")

    checks = [
        ("foreground / background", g("foreground"), bg, 4.5),
        ("card-foreground / card", g("card-foreground"), card, 4.5),
        ("muted-foreground / background", g("muted-foreground"), bg, 4.5),
        ("muted-foreground / card", g("muted-foreground"), card, 4.5),
        ("muted-foreground / muted", g("muted-foreground"), muted, 4.5),
        ("primary-foreground / primary", g("primary-foreground"), g("primary"), 4.5),
    ]
    for k in UI_TOKENS:
        checks.append((f"{k} / card  [interfejs]", g(k), card, 3.0))
    for k in SEMANTIC:
        checks.append((f"{k} / card  [tekst]", g(k), card, 4.5))
        checks.append((f"{k} / background  [tekst]", g(k), bg, 4.5))
        checks.append((f"{k} / muted  [na tle banera]", g(k), muted, 3.0))

    for lbl, fg, base, need in checks:
        r = contrast(fg, base)
        ok = r >= need
        bad += 0 if ok else 1
        print(f"  {'OK ' if ok else '!! '}{lbl:<36} {hexof(fg)}  {r:5.2f}:1  (min {need})")
    print(f"  ·· --border / card {contrast(g('border'), card):.2f}:1 "
          f"(separator dekoracyjny — bez progu)")

    print("  --- rozróżnialność par ---")
    for a, b, dn, dd, dp in GATES:
        ca, cb = g(a), g(b)
        v = (de76(ca, cb),
             de76(simulate(ca, DEUT), simulate(cb, DEUT)),
             de76(simulate(ca, PROT), simulate(cb, PROT)))
        ok = all(x >= n for x, n in zip(v, (dn, dd, dp)))
        bad += 0 if ok else 1
        print(f"  {'OK ' if ok else '!! '}ΔE {a}/{b:<11} typowe {v[0]:5.1f}/{dn}  "
              f"deuter {v[1]:5.1f}/{dd}  protan {v[2]:5.1f}/{dp}")
    return bad


def main():
    if not TOKENS_CSS.exists():
        print(f"Nie znalazłem {TOKENS_CSS}")
        return 1
    print(f"Źródło wartości: {TOKENS_CSS}")
    themes = read_tokens(TOKENS_CSS)
    total = sum(audit_theme(label, t) for label, t in themes.items())
    print("\n" + "=" * 74)
    if total:
        print(f"Naruszeń: {total}")
    else:
        print("Bez naruszeń — paleta spełnia wszystkie progi w obu motywach.")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
