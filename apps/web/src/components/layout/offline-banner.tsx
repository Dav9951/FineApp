import { WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';

import { useOnline } from '../../lib/pwa.js';

/**
 * Baner „Brak połączenia" ([06 §5](../../../../../plans/06-ui-views.md#5-zachowanie-mobilne--szczegóły)).
 *
 * Dane nie są trzymane offline (08, 09 — tylko powłoka jest w pamięci podręcznej), więc
 * bez sieci ekran pokazuje kwoty z chwili ostatniego wczytania. Baner mówi o tym wprost,
 * zamiast udawać, że liczby są bieżące. Przyklejony u góry, żeby był widoczny przy
 * przewijaniu; `role="status"` — czytnik ogłosi go bez przerywania.
 *
 * @returns Element banera albo nic.
 */
export function OfflineBanner(): ReactNode {
  const online = useOnline();
  if (online) return null;
  return (
    <p
      className="sticky top-0 z-30 flex gap-2.5 border-b border-warning bg-card px-4 py-2.5 text-sm leading-snug"
      role="status"
    >
      <WifiOff
        aria-hidden="true"
        className="mt-px h-4 w-4 shrink-0 text-warning"
        strokeWidth={1.5}
      />
      Brak połączenia. Kwoty pochodzą z ostatniego wczytania i mogą być nieaktualne; zapis zadziała
      po powrocie sieci.
    </p>
  );
}
