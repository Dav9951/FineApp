import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Stan pusty ([15 §4.9](../../../../../plans/15-design-system.md#49-stany-ekranu)).
 *
 * **Jedna pierwsza akcja, nie lista braków.** Ekran ma powiedzieć, co zrobić, a nie
 * ile rzeczy brakuje — dlatego `action` jest pojedyncze, a kroki startowe (`steps`)
 * mają przycisk wyłącznie przy pierwszym nieodhaczonym.
 */

/** Krok startowy pokazywany na pustym dashboardzie. */
export interface EmptyStep {
  /** Treść kroku. */
  label: string;
  /** Czy krok został już wykonany. */
  done?: boolean;
}

/** Właściwości stanu pustego. */
export interface EmptyStateProps {
  /** Ikona w kole `bg-muted`. */
  icon?: ReactNode;
  /** Tytuł, 20 px. */
  title: string;
  /** Jedno zdanie wyjaśnienia. */
  description?: string;
  /** **Jedna** pierwsza akcja. */
  action?: ReactNode;
  /** Kroki startowe; przycisk dostaje tylko pierwszy nieodhaczony. */
  steps?: readonly EmptyStep[];
  className?: string;
}

/**
 * Ekran bez danych.
 *
 * @param props - Właściwości komponentu.
 * @param props.icon - Ikona w kole.
 * @param props.title - Tytuł.
 * @param props.description - Zdanie wyjaśnienia.
 * @param props.action - Pierwsza akcja.
 * @param props.steps - Kroki startowe.
 * @param props.className - Dodatkowe klasy.
 * @returns Element stanu pustego.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  steps,
  className,
}: EmptyStateProps): ReactNode {
  // Przycisk stoi przy pierwszym niewykonanym kroku; pozostałe są samą treścią.
  const activeStep = steps?.findIndex((step) => step.done !== true) ?? -1;

  return (
    <div className={cn('flex flex-col items-center px-4 py-10 text-center', className)}>
      {icon ? (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <h2 className="text-lg font-medium">{title}</h2>
      {description ? (
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">{description}</p>
      ) : null}

      {steps && steps.length > 0 ? (
        <ol className="mt-6 w-full max-w-xs divide-y divide-border border-t border-border text-left">
          {steps.map((step, index) => (
            <li key={step.label} className="flex min-h-touch items-center gap-3 py-2">
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption',
                  step.done === true
                    ? 'bg-success/15 text-success'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {step.done === true ? '✓' : index + 1}
              </span>
              <span
                className={cn(
                  'flex-1 text-sm',
                  step.done === true ? 'text-muted-foreground line-through' : '',
                )}
              >
                {step.label}
              </span>
              {index === activeStep ? action : null}
            </li>
          ))}
        </ol>
      ) : (
        action && <div className="mt-6">{action}</div>
      )}
    </div>
  );
}
