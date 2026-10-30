import type { RecurringRuleDto, TransactionType } from '@fineapp/shared';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Plus,
  Repeat,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  Money,
  Section,
  Skeleton,
  SkeletonList,
  Switch,
  useToast,
} from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { useRecurringRules, useSetRuleActive } from '../hooks/use-recurring.js';
import { groupRules, monthlySummary, scheduleLabel } from '../recurring-view.js';
import { RecurringFormSheet } from './recurring-form-sheet.js';

/**
 * Ekran pozycji cyklicznych — `/recurring`
 * ([06 §3.9](../../../../../../plans/06-ui-views.md#39-pozycje-cykliczne--recurring), `F4-5`).
 *
 * Na górze „Miesięcznie" — ile przez miesiąc wychodzi, wpływa i jest odkładane; niżej
 * reguły w grupach: wydatki stałe, inne wydatki, odkładanie, przelewy, wpływy, wstrzymane.
 * Przełącznik przy wierszu wstrzymuje regułę bez usuwania. Cztery stany (15 §2.8).
 */

/** Ikona rodzaju reguły. */
const FLOW_ICON: Readonly<Record<TransactionType, LucideIcon>> = {
  expense: ArrowUpRight,
  income: ArrowDownLeft,
  transfer: ArrowLeftRight,
};

/** Stan nawigacji z `/recurring/:id` — reguła do otwarcia w arkuszu. */
interface RecurringLocationState {
  readonly ruleId?: string;
}

/**
 * Identyfikator reguły z nawigacji, jeśli przyszła z `/recurring/:id`.
 *
 * @param state - Stan lokalizacji routera (dowolny).
 * @returns Identyfikator albo `undefined`.
 */
function ruleIdFrom(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null || !('ruleId' in state)) return undefined;
  const { ruleId } = state as RecurringLocationState;
  return typeof ruleId === 'string' ? ruleId : undefined;
}

/**
 * Szkielet ekranu — ten sam układ co treść.
 *
 * @returns Element szkieletu.
 */
function RecurringSkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Wczytywanie pozycji cyklicznych">
      <Section first title="Miesięcznie">
        <Skeleton className="h-5 w-64" />
      </Section>
      <Section title="Wydatki stałe">
        <SkeletonList rows={3} />
      </Section>
      <Section title="Wpływy">
        <SkeletonList rows={1} />
      </Section>
    </div>
  );
}

/**
 * Podpis wiersza: terminarz, auto-księgowanie, koniec.
 *
 * @param props - Właściwości komponentu.
 * @param props.rule - Reguła.
 * @returns Element podpisu.
 */
function RuleCaption({ rule }: { rule: RecurringRuleDto }): ReactNode {
  const parts = [scheduleLabel(rule)];
  if (rule.autoPost && !rule.amountIsEstimate) parts.push('auto-księgowanie');
  if (rule.endMonth !== null)
    parts.push(`do ${rule.endMonth.slice(5, 7)}.${rule.endMonth.slice(0, 4)}`);
  return <span>{parts.join(' · ')}</span>;
}

/**
 * Wiersz reguły z przełącznikiem.
 *
 * Przełącznik stoi **obok** przycisku wiersza, nie w nim — kontrolka w kontrolce nie
 * jest dostępna dla czytnika ekranu ani dla klawiatury.
 *
 * @param props - Właściwości komponentu.
 * @param props.rule - Reguła.
 * @param props.first - Pierwszy wiersz grupy.
 * @param props.onOpen - Otwarcie edycji.
 * @param props.onToggle - Wstrzymanie albo wznowienie.
 * @returns Element wiersza.
 */
function RuleRow({
  rule,
  first,
  onOpen,
  onToggle,
}: {
  rule: RecurringRuleDto;
  first: boolean;
  onOpen: () => void;
  onToggle: (active: boolean) => void;
}): ReactNode {
  const Icon = FLOW_ICON[rule.flow];
  return (
    <div
      className={
        first ? 'flex items-center gap-3' : 'flex items-center gap-3 border-t border-border'
      }
    >
      <ListRow
        amount={
          <span className="inline-flex items-center gap-1">
            {rule.amountIsEstimate ? <Badge tone="neutral">szac.</Badge> : null}
            <Money amountMinor={rule.amountMinor} size="sm" />
          </span>
        }
        caption={<RuleCaption rule={rule} />}
        className="min-w-0 flex-1"
        first
        icon={<Icon aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={1.5} />}
        name={rule.name}
        onClick={onOpen}
      />
      <Switch
        checked={rule.isActive}
        label={rule.isActive ? `Wstrzymaj „${rule.name}"` : `Wznów „${rule.name}"`}
        onCheckedChange={onToggle}
      />
    </div>
  );
}

/**
 * Ekran pozycji cyklicznych.
 *
 * @returns Element ekranu.
 */
export default function RecurringScreen(): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const { show } = useToast();
  const rules = useRecurringRules();
  const accounts = useAccountList(true);
  const toggle = useSetRuleActive();
  const [sheet, setSheet] = useState<{ open: boolean; rule?: RecurringRuleDto }>({ open: false });

  // Wejście z `/recurring/:id`: otwarcie arkusza tej reguły, raz, gdy lista dojdzie.
  const requestedId = ruleIdFrom(location.state);
  const loaded = rules.data;
  useEffect(() => {
    if (requestedId === undefined || loaded === undefined) return;
    const rule = loaded.find((item) => item.id === requestedId);
    if (rule !== undefined) setSheet({ open: true, rule });
    void navigate('.', { replace: true, state: null });
  }, [requestedId, loaded, navigate]);

  const openNew = (): void => {
    setSheet({ open: true });
  };
  const setActive = (rule: RecurringRuleDto, active: boolean): void => {
    toggle.mutate(
      { ruleId: rule.id, active },
      {
        onSuccess: () => {
          show({ message: active ? `Wznowiono „${rule.name}"` : `Wstrzymano „${rule.name}"` });
        },
        onError: (error) => {
          show({ message: error.message });
        },
      },
    );
  };

  let content: ReactNode;
  if (rules.isPending || accounts.isPending) {
    content = <RecurringSkeleton />;
  } else if (rules.isError || accounts.isError) {
    const failed = rules.isError ? rules : accounts;
    content = (
      <ErrorState
        details={errorDetails(failed.error)}
        lastUpdatedAt={lastUpdatedLabel(rules.dataUpdatedAt)}
        onRetry={() => {
          void rules.refetch();
          void accounts.refetch();
        }}
        retrying={rules.isFetching || accounts.isFetching}
        title="Nie udało się wczytać pozycji cyklicznych"
      />
    );
  } else if (rules.data.length === 0) {
    content = (
      <EmptyState
        action={
          <Button onClick={openNew} size="large" variant="primary">
            Dodaj pozycję
          </Button>
        }
        description="Czynsz, abonamenty, pensja, stała wpłata na oszczędności — wpisane raz pojawiają się co miesiąc do potwierdzenia jednym dotknięciem."
        icon={<Repeat aria-hidden="true" className="h-7 w-7" strokeWidth={1.5} />}
        title="Nie masz jeszcze pozycji cyklicznych"
      />
    );
  } else {
    const groups = groupRules(rules.data, accounts.data);
    const summary = monthlySummary(groups, rules.data);
    content = (
      <>
        <Section first title={summary.isAverage ? 'Miesięcznie (średnio)' : 'Miesięcznie'}>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span>
              <Money amountMinor={summary.expenseMinor} size="sm" variant="expense" /> wydatki
            </span>
            <span>
              <Money amountMinor={summary.incomeMinor} size="sm" variant="income" /> wpływy
            </span>
            {summary.savingMinor === 0 ? null : (
              <span>
                <Money amountMinor={summary.savingMinor} size="sm" variant="savings" /> odkładane
              </span>
            )}
          </p>
          {summary.isAverage ? (
            <p className="mt-1 text-caption text-muted-foreground">
              Pozycje tygodniowe, kwartalne i roczne przeliczone na miesiąc.
            </p>
          ) : null}
        </Section>

        {groups.map((group) => (
          <Section
            action={
              group.monthlyMinor === null ? undefined : (
                <Money amountMinor={group.monthlyMinor} size="sm" />
              )
            }
            key={group.key}
            title={group.label}
          >
            <ul>
              {group.rules.map((rule, index) => (
                <li key={rule.id}>
                  <RuleRow
                    first={index === 0}
                    onOpen={() => {
                      setSheet({ open: true, rule });
                    }}
                    onToggle={(active) => {
                      setActive(rule, active);
                    }}
                    rule={rule}
                  />
                </li>
              ))}
            </ul>
          </Section>
        ))}
      </>
    );
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Cykliczne</h1>
        <IconButton label="Dodaj pozycję cykliczną" onClick={openNew}>
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </IconButton>
      </header>
      {content}
      <RecurringFormSheet
        onOpenChange={(open) => {
          setSheet((current) => ({ ...current, open }));
        }}
        open={sheet.open}
        rule={sheet.rule}
      />
    </main>
  );
}
