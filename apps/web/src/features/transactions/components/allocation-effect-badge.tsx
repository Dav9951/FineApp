import type { AllocationEffect } from '@fineapp/shared';
import type { ReactNode } from 'react';

import { Money, Switch, type MoneyVariant } from '../../../components/ui/index.js';
import { ALLOCATION_KIND_ACCUSATIVE } from '../transaction-view.js';

/**
 * Plakietka efektu przelewu na cele ([15 §5](../../../../../../plans/15-design-system.md#5-wzorce),
 * [06 §3.3](../../../../../../plans/06-ui-views.md#33-formularz-transakcji--tnew-tid)).
 *
 * Użytkownik widzi konsekwencję **zanim** zapisze: wpłata na oszczędności, wypłata
 * z poduszki, a przy przesunięciu oszczędności na konto maklerskie — dwie linie naraz.
 * Kierunek niesie czasownik („zwiększa" / „zmniejsza"), nie sam kolor ani znak (15 §2.4).
 */

/** Kolor kwoty dla puli. */
const KIND_VARIANT: Readonly<Record<AllocationEffect['kind'], MoneyVariant>> = {
  savings: 'savings',
  investment: 'investment',
  debt_repayment: 'debt',
};

/** Właściwości plakietki. */
export interface AllocationEffectBadgeProps {
  /** Efekty przy włączonym liczeniu. */
  effects: readonly AllocationEffect[];
  /** Czy przelew między wybranymi kontami w ogóle może ruszyć pulę (I-7). */
  canAffect: boolean;
  /** Czy przelew liczy się do celów (`allocationOverride !== 'none'`). */
  counts: boolean;
  onCountsChange: (counts: boolean) => void;
}

/**
 * Plakietka efektu przelewu.
 *
 * @param props - Właściwości komponentu.
 * @param props.effects - Efekty przy włączonym liczeniu.
 * @param props.canAffect - Czy przelew może ruszyć pulę.
 * @param props.counts - Czy przelew liczy się do celów.
 * @param props.onCountsChange - Zmiana wyłącznika.
 * @returns Element plakietki.
 */
export function AllocationEffectBadge({
  effects,
  canAffect,
  counts,
  onCountsChange,
}: AllocationEffectBadgeProps): ReactNode {
  if (!canAffect) {
    return (
      <p className="text-caption text-muted-foreground">
        Przelew w obrębie tej samej puli nie zmienia realizacji celów.
      </p>
    );
  }

  return (
    <div
      aria-label="Wpływ na cele"
      className="rounded-sm border-l-[3px] border-primary bg-muted/40 p-3"
      role="group"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Liczy się do celów</span>
        <Switch checked={counts} label="Liczy się do celów" onCheckedChange={onCountsChange} />
      </div>
      {counts ? (
        <ul className="mt-2 flex flex-col gap-1">
          {effects.map((effect) => (
            <li className="text-sm" key={effect.kind}>
              {effect.amountMinor >= 0 ? 'Zwiększa' : 'Zmniejsza'}{' '}
              {ALLOCATION_KIND_ACCUSATIVE[effect.kind]} o{' '}
              <Money
                amountMinor={Math.abs(effect.amountMinor)}
                size="sm"
                variant={KIND_VARIANT[effect.kind]}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-caption text-muted-foreground">
          Ten przelew nie zmieni realizacji celów — np. zwrot pożyczki od domownika.
        </p>
      )}
    </div>
  );
}
