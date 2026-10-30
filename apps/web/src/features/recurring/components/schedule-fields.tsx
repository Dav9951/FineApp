import type { Frequency } from '@fineapp/shared';
import type { ReactNode } from 'react';

import { OptionGrid, TextField } from '../../../components/ui/index.js';
import type { RecurringFormErrors, ScheduleFormState } from '../recurring-form-state.js';

/**
 * Pola terminarza: częstotliwość, odstęp, miesiąc roku, dzień miesiąca, dzień tygodnia
 * ([06 §3.9](../../../../../../plans/06-ui-views.md#39-pozycje-cykliczne--recurring)).
 *
 * Wspólne dla formularza reguły (`F4-5`) i „Zapisz jako wydatek stały" w formularzu
 * transakcji (`F4-8`, 06 §3.3) — ten sam terminarz ma wyglądać i działać tak samo.
 * Pokazuje wyłącznie pola, których wybrana częstotliwość używa.
 */

/** Opcje częstotliwości — od najczęstszej. */
const FREQUENCY_OPTIONS: readonly { value: Frequency; label: string }[] = [
  { value: 'monthly', label: 'Co miesiąc' },
  { value: 'quarterly', label: 'Co kwartał' },
  { value: 'yearly', label: 'Co roku' },
  { value: 'every_n_months', label: 'Co N miesięcy' },
  { value: 'weekly', label: 'Co tydzień' },
  { value: 'biweekly', label: 'Co 2 tygodnie' },
];

/** Dni tygodnia od poniedziałku; wartość 0 = niedziela, jak w API. */
const WEEKDAY_OPTIONS = [
  { value: '1', label: 'Pn' },
  { value: '2', label: 'Wt' },
  { value: '3', label: 'Śr' },
  { value: '4', label: 'Cz' },
  { value: '5', label: 'Pt' },
  { value: '6', label: 'So' },
  { value: '0', label: 'Nd' },
] as const;

/** Miesiące roku — do reguły rocznej. */
const MONTH_OPTIONS = [
  'sty',
  'lut',
  'mar',
  'kwi',
  'maj',
  'cze',
  'lip',
  'sie',
  'wrz',
  'paź',
  'lis',
  'gru',
].map((label, index) => ({ value: String(index + 1), label }));

/** Częstotliwości, które wybierają dzień miesiąca. */
const USES_DAY: ReadonlySet<Frequency> = new Set([
  'monthly',
  'quarterly',
  'yearly',
  'every_n_months',
]);

/** Właściwości pól terminarza. */
export interface ScheduleFieldsProps {
  value: ScheduleFormState;
  errors: RecurringFormErrors;
  onChange: (patch: Partial<ScheduleFormState>) => void;
}

/**
 * Pola terminarza.
 *
 * @param props - Właściwości komponentu.
 * @param props.value - Bieżący terminarz.
 * @param props.errors - Błędy pól.
 * @param props.onChange - Zmiana pól.
 * @returns Elementy pól.
 */
export function ScheduleFields({ value, errors, onChange }: ScheduleFieldsProps): ReactNode {
  const usesWeekday = value.frequency === 'weekly' || value.frequency === 'biweekly';
  return (
    <>
      <OptionGrid
        legend="Jak często"
        onChange={(frequency) => {
          onChange({ frequency });
        }}
        options={FREQUENCY_OPTIONS}
        value={value.frequency}
      />

      {value.frequency === 'every_n_months' ? (
        <TextField
          error={errors.intervalText}
          inputMode="numeric"
          label="Co ile miesięcy"
          onChange={(intervalText) => {
            onChange({ intervalText });
          }}
          value={value.intervalText}
        />
      ) : null}

      {value.frequency === 'yearly' ? (
        <OptionGrid
          legend="Miesiąc"
          onChange={(month) => {
            onChange({ monthOfYear: Number(month) });
          }}
          options={MONTH_OPTIONS}
          value={String(value.monthOfYear)}
        />
      ) : null}

      {USES_DAY.has(value.frequency) ? (
        <TextField
          error={errors.dayOfMonthText}
          hint="Dzień, którego nie ma w miesiącu (np. 31), wypada w jego ostatnim dniu."
          inputMode="numeric"
          label="Dzień miesiąca"
          onChange={(dayOfMonthText) => {
            onChange({ dayOfMonthText });
          }}
          value={value.dayOfMonthText}
        />
      ) : null}

      {usesWeekday ? (
        <div>
          <OptionGrid
            legend="Dzień tygodnia"
            onChange={(weekday) => {
              onChange({ weekday: Number(weekday) });
            }}
            options={WEEKDAY_OPTIONS}
            value={String(value.weekday)}
          />
          {errors.weekday === undefined ? null : (
            <p className="pb-2 text-caption text-danger" role="alert">
              {errors.weekday}
            </p>
          )}
        </div>
      ) : null}
    </>
  );
}
