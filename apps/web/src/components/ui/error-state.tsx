import { useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { Button } from './button.js';

/**
 * Stan błędu ([15 §4.9](../../../../../plans/15-design-system.md#49-stany-ekranu)).
 *
 * **Kod błędu nigdy nie jest tytułem.** Tytuł mówi, co się stało, po polsku; kod
 * i ślad techniczny chowają się za drugim przyciskiem, bo przydają się raz na sto
 * awarii, a zajmują ekran za każdym razem.
 *
 * Ekran tłumaczy też, **dlaczego nie pokazujemy starych danych**: kwoty zawsze
 * pochodzą z sieci ([06 §11](../../../../../plans/06-ui-views.md)), więc nieaktualna
 * kwota byłaby gorsza niż jej brak — na jej podstawie ktoś podjąłby decyzję.
 */

/** Właściwości stanu błędu. */
export interface ErrorStateProps {
  /** Co się stało — zdanie po polsku, nigdy kod błędu. */
  title: string;
  /** Dlaczego nie pokazujemy starych danych; ma sensowną wartość domyślną. */
  description?: string;
  /** Godzina ostatniej udanej aktualizacji, np. `14:07`. */
  lastUpdatedAt?: string;
  /** Szczegóły techniczne — kod, identyfikator żądania, treść wyjątku. */
  details?: string;
  /** Ponowienie; brak wyłącza przycisk główny. */
  onRetry?: () => void;
  /** Czy trwa ponawianie. */
  retrying?: boolean;
  className?: string;
}

/** Domyślne wyjaśnienie braku starych danych. */
const DEFAULT_DESCRIPTION =
  'Nie pokazujemy ostatnio wczytanych kwot, bo mogły się już zmienić — ' +
  'decyzja podjęta na nieaktualnej kwocie kosztuje więcej niż chwila czekania.';

/**
 * Ekran awarii wczytywania danych.
 *
 * @param props - Właściwości komponentu.
 * @param props.title - Co się stało.
 * @param props.description - Dlaczego nie ma starych danych.
 * @param props.lastUpdatedAt - Godzina ostatniej udanej aktualizacji.
 * @param props.details - Szczegóły techniczne.
 * @param props.onRetry - Ponowienie.
 * @param props.retrying - Czy trwa ponawianie.
 * @param props.className - Dodatkowe klasy.
 * @returns Element stanu błędu.
 */
export function ErrorState({
  title,
  description = DEFAULT_DESCRIPTION,
  lastUpdatedAt,
  details,
  onRetry,
  retrying = false,
  className,
}: ErrorStateProps): ReactNode {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center px-4 py-10 text-center', className)}
    >
      <div className="bg-danger/12 mb-4 flex h-14 w-14 items-center justify-center rounded-full text-danger">
        <span aria-hidden="true" className="text-lg font-bold">
          !
        </span>
      </div>
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">{description}</p>
      {lastUpdatedAt !== undefined ? (
        <p className="mt-2 text-caption text-muted-foreground">
          Ostatnia udana aktualizacja: <span className="tabular-nums">{lastUpdatedAt}</span>
        </p>
      ) : null}

      <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
        {onRetry ? (
          <Button loading={retrying} onClick={onRetry} size="large" variant="primary">
            Spróbuj ponownie
          </Button>
        ) : null}
        {details !== undefined ? (
          <Button
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
            size="large"
            variant="ghost"
          >
            {detailsOpen ? 'Ukryj szczegóły' : 'Szczegóły techniczne'}
          </Button>
        ) : null}
      </div>

      {detailsOpen && details !== undefined ? (
        <pre className="mt-3 w-full max-w-xs overflow-x-auto rounded-md bg-muted p-3 text-left text-caption text-muted-foreground">
          {details}
        </pre>
      ) : null}
    </div>
  );
}
