import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  LogoutButton,
  ProfileBadge,
  ThemeSwitch,
} from '../../components/layout/account-controls.js';
import { planningNav, settingsNav, type NavItem } from '../../components/layout/nav-items.js';
import { ListRow } from '../../components/ui/index.js';

/**
 * Ekran „Więcej" — `/more` ([06 §2](../../../../../plans/06-ui-views.md#2-nawigacja)).
 *
 * Na telefonie jedyne wejście do Kont, Zobowiązań, Ustawień i reszty podsekcji — bez
 * niego `/accounts` z `F2-6` byłoby osiągalne tylko przez wpisanie adresu (ADR-036).
 * Pozycje pochodzą z tych samych `planningNav()` i `settingsNav()` co pasek boczny
 * desktopu, więc obie nawigacje nie mogą się rozjechać. Układ jak w pasku (ADR-082):
 * profil, „Planowanie", Kategorie i Ustawienia, motyw i „Wyloguj".
 *
 * @returns Element ekranu.
 */
export default function MoreScreen(): ReactNode {
  const navigate = useNavigate();
  const list = (items: readonly NavItem[], label: string): ReactNode => (
    <nav aria-label={label}>
      <ul>
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <ListRow
                first={index === 0}
                icon={<Icon aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={1.5} />}
                name={item.label}
                onClick={() => {
                  void navigate(item.to);
                }}
              />
            </li>
          );
        })}
      </ul>
    </nav>
  );
  return (
    <main>
      <h1 className="sr-only">Więcej</h1>
      <ProfileBadge className="-ml-1" />
      <h2 className="mb-1.5 mt-6 text-[11px] font-semibold uppercase tracking-[.12em] text-muted-foreground">
        Planowanie
      </h2>
      {list(planningNav(), 'Planowanie')}
      <hr className="my-4 border-border" />
      {list(settingsNav(), 'Ustawienia')}
      <hr className="my-4 border-border" />
      <div className="flex flex-col gap-2">
        <ThemeSwitch />
        <LogoutButton className="px-0" />
      </div>
    </main>
  );
}
