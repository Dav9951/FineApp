import type { ReactNode } from 'react';

/**
 * Zaślepka ekranu — „biała strona, ale z infrastrukturą".
 *
 * Istnieje wyłącznie po to, żeby trasy z [06 §2](../../../../../plans/06-ui-views.md)
 * dało się przeklikać, zanim powstaną prawdziwe widoki. Każdy prawdziwy ekran zastępuje
 * jedno jej użycie; gdy znikną wszystkie, znika i ten plik.
 *
 * Używa wyłącznie tokenów design systemu — żadnych surowych kolorów (`15 §3`).
 *
 * @param props - Właściwości komponentu.
 * @param props.title - Nazwa ekranu.
 * @returns Element zaślepki.
 */
export default function Placeholder({ title }: { title: string }): ReactNode {
  return (
    <main className="min-h-dvh bg-background p-6 text-foreground">
      <h1 className="text-xl">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Ekran powstanie w kolejnej fazie. Infrastruktura jest gotowa.
      </p>
    </main>
  );
}
