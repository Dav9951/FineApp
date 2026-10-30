import {
  budgetMonthRange,
  budgetSectionOf,
  canCreateBudgetDraft,
  formatMonth,
  isValidMonthKey,
  monthKeyOf,
  todayInTimezone,
  type BudgetDraftDto,
  type BudgetGroupDto,
  type BudgetLineDto,
  type BudgetLineFlow,
  type BudgetSection,
  type MonthKey,
} from '@fineapp/shared';
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  ClipboardList,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Money,
  MonthSwitcher,
  ProgressBar,
  Section,
  Sheet,
  Skeleton,
  useHideFab,
  useToast,
} from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useAuth } from '../../auth/auth-context.js';
import { arrangeItems } from '../budget-arrange.js';
import {
  allocationRow,
  budgetSections,
  excludedLines,
  goalRows,
  lineMoneyVariant,
  missingLineFor,
  progressByLine,
} from '../budget-view.js';
import {
  useBudgetDraft,
  useBudgetDrafts,
  useBudgetLineAction,
  useCreateBudgetDraft,
  useCreateBudgetLine,
  useDeleteBudgetDraft,
  useRefreshBudgetDraft,
  useUpdateBudgetLine,
} from '../hooks/use-budget.js';
import { BudgetFillSheet } from './budget-fill-sheet.js';
import { BudgetGroupSheet } from './budget-group-sheet.js';
import { BudgetLineSheet } from './budget-line-sheet.js';
import { BudgetSectionLines } from './budget-section-lines.js';

/**
 * Szkic budżetu miesiąca — `/budget/:month`
 * ([06 §3.14](../../../../../../plans/06-ui-views.md#314-planer-budżetu--budget-budgetmonth),
 * `F9-6`).
 *
 * Od góry: bilans z oceną rozkładu i ostrzeżeniami (z „Dodaj brakujące"), cele
 * i odkładanie, trzy sekcje linii, „Poza planem", zwinięte „Pominięte w planie".
 * W miesiącu bieżącym i minionym bilans ma kolumnę „Wykonanie", a linie — wykonanie
 * pod spodem (`F9-9`). Ocena przychodzi
 * gotowa z API — ekran jej nie liczy. Dodawanie, edycja i zamiana linii — arkusz linii
 * (`F9-7`), otwierany dotknięciem wiersza albo „+ Dodaj" w sekcji.
 */

/**
 * Szkielet ekranu — bilans i dwie sekcje linii.
 *
 * @returns Element szkieletu.
 */
function BudgetSkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Wczytywanie planu">
      <Section first title="Plan">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="mt-2 h-5 w-full" />
        <Skeleton className="mt-2 h-5 w-2/3" />
      </Section>
      <Section title="Wydatki">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="mt-2 h-11 w-full" />
      </Section>
    </div>
  );
}

/**
 * Wiersz bilansu: etykieta po lewej, kwota po prawej.
 *
 * @param props - Właściwości komponentu.
 * @param props.label - Etykieta.
 * @param props.children - Kwota planu.
 * @param props.actual - Kwota wykonania (`F9-9`); bez niej — jedna kolumna.
 * @param props.strong - Wiersz wyróżniony („Zostaje").
 * @returns Element wiersza.
 */
function SummaryRow({
  label,
  children,
  actual,
  strong = false,
}: {
  label: ReactNode;
  children: ReactNode;
  actual?: ReactNode;
  strong?: boolean;
}): ReactNode {
  return (
    <p
      className={
        strong
          ? 'flex items-baseline justify-between gap-2 border-t border-border pt-2 text-base font-semibold'
          : 'flex items-baseline justify-between gap-2 text-sm'
      }
    >
      <span className={strong ? 'flex-1' : 'flex-1 text-muted-foreground'}>{label}</span>
      {children}
      {actual === undefined ? null : <span className="w-28 text-right">{actual}</span>}
    </p>
  );
}

/** Właściwości treści szkicu. */
interface DraftContentProps {
  draft: BudgetDraftDto;
  month: MonthKey;
}

/**
 * Treść istniejącego szkicu.
 *
 * @param props - Właściwości komponentu.
 * @param props.draft - Szkic.
 * @param props.month - Miesiąc.
 * @returns Elementy treści.
 */
function DraftContent({ draft, month }: DraftContentProps): ReactNode {
  const toast = useToast();
  const navigate = useNavigate();
  const lineAction = useBudgetLineAction(month);
  const addLine = useCreateBudgetLine(month);
  const updateLine = useUpdateBudgetLine(month);
  const remove = useDeleteBudgetDraft(month);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sheet, setSheet] = useState<{
    open: boolean;
    line: BudgetLineDto | null;
    addFlow: BudgetLineFlow;
  }>({ open: false, line: null, addFlow: 'expense' });
  // Tryb „Układaj" jednej sekcji (06 §3.14, ADR-081).
  const [arranging, setArranging] = useState<BudgetSection | null>(null);
  const [groupSheet, setGroupSheet] = useState<{
    open: boolean;
    section: BudgetSection;
    groupId: string | null;
  }>({ open: false, section: 'expense', groupId: null });
  // W trybie układania FAB zasłaniałby uchwyty przy prawej krawędzi — zastępuje go „Gotowe".
  useHideFab(arranging !== null && draft.isEditable);
  // Ostatnio wybrana grupa w sekcji — domyślna dla następnej nowej linii w tej wizycie.
  const [lastGroup, setLastGroup] = useState<Partial<Record<BudgetSection, string | null>>>({});
  const { summary } = draft;
  const editable = draft.isEditable;
  const busy = lineAction.isPending || addLine.isPending || updateLine.isPending;

  const onError = (error: Error): void => {
    toast.show({ message: error.message });
  };
  const act = (line: BudgetLineDto, action: 'accept-source' | 'detach'): void => {
    lineAction.mutate({ lineId: line.id, action }, { onError });
  };

  const goals = goalRows(summary);
  const excluded = excludedLines(draft.lines);
  const sections = budgetSections(draft.lines, draft.groups);
  const groupSection = sections.find((section) => section.key === groupSheet.section);
  const groupView =
    groupSheet.groupId === null
      ? null
      : (groupSection?.groups.find((view) => view.group?.id === groupSheet.groupId) ?? null);
  const groupPosition =
    groupSection?.groups.findIndex((view) => view.group?.id === groupSheet.groupId) ?? 0;
  const openGroupSheet = (section: BudgetSection, group: BudgetGroupDto | null): void => {
    setGroupSheet({ open: true, section, groupId: group?.id ?? null });
  };
  const progress = progressByLine(
    draft.actuals,
    sections.flatMap((section) => section.lines),
  );
  const actuals = draft.actuals;
  // Kolumna „Wykonanie" — tylko gdy miesiąc już trwa albo minął (07 §13.8).
  const actualCell = (amountMinor: number): ReactNode =>
    actuals === null ? undefined : <Money amountMinor={amountMinor} size="sm" />;

  return (
    <>
      {editable ? null : (
        <p className="mt-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground" role="note">
          Plan zakończonego miesiąca — tylko do odczytu.
        </p>
      )}

      <Section first title="Plan">
        <div className="flex flex-col gap-1">
          {actuals === null ? null : (
            <p className="flex items-baseline justify-between gap-2 text-caption text-muted-foreground">
              <span className="flex-1" />
              <span>Plan</span>
              <span className="w-28 text-right">Wykonanie</span>
            </p>
          )}
          <SummaryRow actual={actualCell(actuals?.totals.incomeMinor ?? 0)} label="Wpływy">
            <Money amountMinor={summary.incomeMinor} size="sm" variant="income" />
          </SummaryRow>
          <SummaryRow actual={actualCell(actuals?.totals.expenseMinor ?? 0)} label="Wydatki">
            <Money amountMinor={summary.expenseMinor} size="sm" variant="expense" />
          </SummaryRow>
          {summary.savingsMinor === 0 && (actuals?.totals.savingsMinor ?? 0) === 0 ? null : (
            <SummaryRow actual={actualCell(actuals?.totals.savingsMinor ?? 0)} label="Oszczędności">
              <Money amountMinor={summary.savingsMinor} size="sm" variant="savings" />
            </SummaryRow>
          )}
          {summary.investmentMinor === 0 && (actuals?.totals.investmentMinor ?? 0) === 0 ? null : (
            <SummaryRow
              actual={actualCell(actuals?.totals.investmentMinor ?? 0)}
              label="Inwestycje"
            >
              <Money amountMinor={summary.investmentMinor} size="sm" variant="investment" />
            </SummaryRow>
          )}
          <SummaryRow
            actual={actualCell(actuals?.totals.netMinor ?? 0)}
            label={
              summary.leftoverMinor < 0 ? (
                <span className="text-danger">Na minusie</span>
              ) : (
                'Zostaje'
              )
            }
            strong
          >
            <Money amountMinor={summary.leftoverMinor} size="base" />
          </SummaryRow>
        </div>

        {summary.allocation.length === 0 ? null : (
          <ul className="mt-4 flex flex-col gap-3">
            {summary.allocation.map((line) => {
              const row = allocationRow(line);
              return (
                <li className="flex flex-col gap-1" key={line.kind}>
                  <p className="flex items-center justify-between gap-2 text-sm">
                    <span>{row.label}</span>
                    {line.status === 'met' ? (
                      <CheckCircle2
                        aria-label="plan wykonany"
                        className="h-4 w-4 text-success"
                        strokeWidth={1.5}
                      />
                    ) : null}
                  </p>
                  <ProgressBar label={row.label} pool={line.kind} valueBps={row.fulfillmentBps} />
                </li>
              );
            })}
          </ul>
        )}

        {summary.warnings.length === 0 ? null : (
          <ul className="mt-4 flex flex-col gap-3">
            {summary.warnings.map((warning) => {
              const missing = editable ? missingLineFor(warning, summary) : null;
              return (
                <li
                  className="flex flex-col gap-1"
                  key={`${warning.code}:${warning.target?.kind ?? ''}:${warning.target?.id ?? ''}`}
                >
                  <p className="flex items-start gap-2 text-sm text-warning">
                    <AlertTriangle
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0"
                      strokeWidth={1.5}
                    />
                    <span>{warning.message}</span>
                  </p>
                  {missing === null ? null : (
                    <Button
                      className="self-end"
                      disabled={busy}
                      onClick={() => {
                        addLine.mutate(missing, {
                          onError,
                          onSuccess: () => {
                            toast.show({ message: `Dodano „${missing.name}”.` });
                          },
                        });
                      }}
                      size="small"
                      variant="soft"
                    >
                      Dodaj brakujące <Money amountMinor={missing.amountMinor} size="sm" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {goals.length === 0 ? null : (
        <Section title="Cele i odkładanie">
          <ul className="flex flex-col gap-2">
            {goals.map((row) => (
              <li className="flex items-baseline justify-between gap-2 text-sm" key={row.key}>
                <span className="min-w-0 truncate">{row.name}</span>
                <span className="flex shrink-0 items-baseline gap-1">
                  <Money amountMinor={row.plannedMinor} size="sm" unit={false} />
                  <span className="text-muted-foreground">/</span>
                  <Money amountMinor={row.requiredMinor} size="sm" />
                  {row.met ? (
                    <CheckCircle2
                      aria-label="wystarczy"
                      className="h-4 w-4 self-center text-success"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <AlertTriangle
                      aria-label="za mało"
                      className="h-4 w-4 self-center text-warning"
                      strokeWidth={1.5}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {sections.map((section) => (
        <Section
          action={
            <span className="flex items-center gap-2">
              <Money amountMinor={section.totalMinor} size="sm" />
              {editable && (section.lines.length > 0 || section.groups.length > 0) ? (
                <Button
                  aria-pressed={arranging === section.key}
                  onClick={() => {
                    setArranging((current) => (current === section.key ? null : section.key));
                  }}
                  size="small"
                  variant="soft"
                >
                  <ArrowDownUp aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                  {arranging === section.key ? 'Gotowe' : 'Układaj'}
                </Button>
              ) : null}
              {editable && arranging !== section.key ? (
                <IconButton
                  label={`Dodaj: ${section.title}`}
                  onClick={() => {
                    setSheet({ open: true, line: null, addFlow: section.addFlow });
                  }}
                >
                  <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
                </IconButton>
              ) : null}
            </span>
          }
          key={section.key}
          title={section.title}
        >
          <BudgetSectionLines
            actuals={actuals}
            arranging={editable && arranging === section.key}
            busy={busy}
            editable={editable}
            month={month}
            onEditGroup={(group) => {
              openGroupSheet(section.key, group);
            }}
            progress={progress}
            section={section}
            {...(editable
              ? {
                  onAcceptSource: (target: BudgetLineDto) => {
                    act(target, 'accept-source');
                  },
                  onDetach: (target: BudgetLineDto) => {
                    act(target, 'detach');
                  },
                  onOpen: (target: BudgetLineDto) => {
                    setSheet({ open: true, line: target, addFlow: target.flow });
                  },
                }
              : {})}
          />
        </Section>
      ))}

      {actuals === null || actuals.unplannedMinor === 0 ? null : (
        <Section>
          <p className="flex min-h-touch items-center justify-between gap-3 text-sm">
            <span>
              Poza planem <Money amountMinor={actuals.unplannedMinor} size="sm" />
            </span>
            <Button asChild size="small" variant="link">
              <Link to={`/m/${month}/transactions`}>historia</Link>
            </Button>
          </p>
          <p className="text-caption text-muted-foreground">
            Wydatki w kategoriach bez pozycji w planie i bez kategorii.
          </p>
        </Section>
      )}

      {excluded.length === 0 ? null : (
        <Section>
          <details>
            <summary className="flex min-h-touch cursor-pointer items-center text-sm text-muted-foreground">
              Pominięte w planie ({excluded.length})
            </summary>
            <ul>
              {excluded.map((line) => (
                <li
                  className="flex min-h-touch items-center justify-between gap-3 border-t border-border py-2"
                  key={line.id}
                >
                  <span className="min-w-0 truncate text-sm">{line.name}</span>
                  <span className="flex shrink-0 items-center gap-3">
                    <Money
                      amountMinor={line.amountMinor}
                      size="sm"
                      variant={lineMoneyVariant(line.flow)}
                    />
                    {editable ? (
                      <Button
                        disabled={busy}
                        onClick={() => {
                          updateLine.mutate(
                            { lineId: line.id, body: { isExcluded: false } },
                            { onError },
                          );
                        }}
                        size="small"
                        variant="soft"
                      >
                        Przywróć
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </Section>
      )}

      <Section>
        <Button
          className="w-full text-danger"
          onClick={() => {
            setConfirmDelete(true);
          }}
          variant="ghost"
        >
          Usuń plan
        </Button>
      </Section>

      <BudgetLineSheet
        addFlow={sheet.addFlow}
        addGroupId={lastGroup[budgetSectionOf(sheet.addFlow)] ?? null}
        groups={draft.groups}
        onGroupChosen={(flow, groupId) => {
          setLastGroup((current) => ({ ...current, [budgetSectionOf(flow)]: groupId }));
        }}
        line={
          sheet.line === null
            ? null
            : (draft.lines.find((line) => line.id === sheet.line?.id) ?? null)
        }
        month={month}
        onOpenChange={(open) => {
          setSheet((current) => ({ ...current, open }));
        }}
        open={sheet.open}
      />

      <BudgetGroupSheet
        items={groupSection === undefined ? [] : arrangeItems(groupSection)}
        month={month}
        onOpenChange={(open) => {
          setGroupSheet((current) => ({ ...current, open }));
        }}
        open={groupSheet.open}
        position={Math.max(0, groupPosition)}
        section={groupSheet.section}
        view={groupView}
      />

      {arranging === null || !editable || sheet.open || groupSheet.open ? null : (
        <div className="fixed inset-x-0 bottom-0 z-[51] border-t border-border bg-background/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:bottom-6 md:left-auto md:right-6 md:rounded-lg md:border">
          <div className="mx-auto flex max-w-content items-center gap-3">
            <p className="flex-1 text-caption text-muted-foreground">
              Układasz:{' '}
              <span className="font-semibold text-foreground">
                {sections.find((section) => section.key === arranging)?.title}
              </span>
              . Kwoty i plan bez zmian.
            </p>
            <Button
              onClick={() => {
                setArranging(null);
              }}
              variant="primary"
            >
              Gotowe
            </Button>
          </div>
        </div>
      )}

      <Sheet
        onOpenChange={setConfirmDelete}
        open={confirmDelete}
        title={`Usunąć plan na ${formatMonth(month)}?`}
      >
        <p className="text-sm text-muted-foreground">
          Znikną wszystkie pozycje tego planu. Pozycje cykliczne, planowane wydatki i cele zostają
          bez zmian.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Button
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate(undefined, {
                onError,
                onSuccess: () => {
                  setConfirmDelete(false);
                  toast.show({ message: `Usunięto plan na ${formatMonth(month)}.` });
                  void navigate('/budget');
                },
              });
            }}
            variant="danger"
          >
            Usuń plan
          </Button>
          <Button
            onClick={() => {
              setConfirmDelete(false);
            }}
            variant="ghost"
          >
            Anuluj
          </Button>
        </div>
      </Sheet>
    </>
  );
}

/** Właściwości stanu pustego. */
interface NoDraftProps {
  month: MonthKey;
  currentMonth: MonthKey;
}

/**
 * Brak szkicu: trzy drogi założenia (06 §3.14) albo wyjaśnienie, czemu się nie da.
 *
 * @param props - Właściwości komponentu.
 * @param props.month - Oglądany miesiąc.
 * @param props.currentMonth - Bieżący miesiąc gospodarstwa.
 * @returns Element stanu pustego.
 */
function NoDraft({ month, currentMonth }: NoDraftProps): ReactNode {
  const toast = useToast();
  const list = useBudgetDrafts();
  const create = useCreateBudgetDraft(month);
  const [filling, setFilling] = useState(false);
  const icon = <ClipboardList aria-hidden="true" className="h-7 w-7" strokeWidth={1.5} />;

  if (!canCreateBudgetDraft(month, currentMonth)) {
    const range = budgetMonthRange(currentMonth);
    return month < currentMonth ? (
      <EmptyState icon={icon} title={`Nie było planu na ${formatMonth(month)}`} />
    ) : (
      <EmptyState
        description={`Plan można założyć na miesiące od ${formatMonth(range.from)} do ${formatMonth(range.to)}.`}
        icon={icon}
        title={`Za wcześnie na plan na ${formatMonth(month)}`}
      />
    );
  }

  // Linie własne najwygodniej skopiować z najbliższego wcześniejszego planu.
  const copyFrom =
    list.data?.items
      .map((item) => item.month)
      .filter((item) => item < month)
      .sort()
      .at(-1) ?? null;
  const run = (body: Parameters<typeof create.mutate>[0]): void => {
    create.mutate(body, {
      onError: (error) => {
        toast.show({ message: error.message });
      },
    });
  };

  return (
    <>
      <EmptyState
        action={
          <div className="flex w-full flex-col gap-2">
            <Button
              disabled={create.isPending}
              onClick={() => {
                setFilling(true);
              }}
              size="large"
              variant="primary"
            >
              Utwórz z danych
            </Button>
            {copyFrom === null ? null : (
              <Button
                disabled={create.isPending}
                onClick={() => {
                  run({ fillFromSources: true, copyManualFrom: copyFrom });
                }}
                variant="ghost"
              >
                Skopiuj z {formatMonth(copyFrom)}
              </Button>
            )}
            <Button
              disabled={create.isPending}
              onClick={() => {
                run({ fillFromSources: false });
              }}
              variant="ghost"
            >
              Zacznij od zera
            </Button>
          </div>
        }
        description="Wciągniemy pozycje cykliczne, raty, planowane wydatki i cele. Potem popraw kwoty i dopisz resztę."
        icon={icon}
        title={`Brak planu na ${formatMonth(month)}`}
      />
      <BudgetFillSheet copyFrom={copyFrom} month={month} onOpenChange={setFilling} open={filling} />
    </>
  );
}

/**
 * Ekran szkicu budżetu miesiąca.
 *
 * @returns Element ekranu.
 */
export default function BudgetScreen(): ReactNode {
  const params = useParams();
  const { household } = useAuth();
  const currentMonth = monthKeyOf(
    todayInTimezone(household?.timezone ?? 'Europe/Warsaw'),
    household?.monthStartDay ?? 1,
  );
  const month = params.month !== undefined && isValidMonthKey(params.month) ? params.month : null;

  if (month === null) {
    return (
      <main>
        <EmptyState title="Nie ma takiego miesiąca" />
      </main>
    );
  }
  return <BudgetMonth currentMonth={currentMonth} month={month} />;
}

/**
 * Ekran dla poprawnego klucza miesiąca.
 *
 * @param props - Właściwości komponentu.
 * @param props.month - Miesiąc szkicu.
 * @param props.currentMonth - Bieżący miesiąc gospodarstwa.
 * @returns Element ekranu.
 */
function BudgetMonth({
  month,
  currentMonth,
}: {
  month: MonthKey;
  currentMonth: MonthKey;
}): ReactNode {
  const toast = useToast();
  const draft = useBudgetDraft(month);
  const refresh = useRefreshBudgetDraft(month);

  let content: ReactNode;
  if (draft.isPending) {
    content = <BudgetSkeleton />;
  } else if (draft.isError) {
    content = (
      <ErrorState
        details={errorDetails(draft.error)}
        lastUpdatedAt={lastUpdatedLabel(draft.dataUpdatedAt)}
        onRetry={() => {
          void draft.refetch();
        }}
        retrying={draft.isFetching}
        title="Nie udało się wczytać planu"
      />
    );
  } else if (draft.data === null) {
    content = <NoDraft currentMonth={currentMonth} month={month} />;
  } else {
    content = <DraftContent draft={draft.data} key={draft.data.id} month={month} />;
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <MonthSwitcher
          dimmed={draft.isPending}
          hrefFor={(target) => `/budget/${target}`}
          month={month}
        />
        {draft.data?.isEditable === true ? (
          <IconButton
            disabled={refresh.isPending}
            label="Odśwież ze źródeł"
            onClick={() => {
              refresh.mutate(undefined, {
                onError: (error) => {
                  toast.show({ message: error.message });
                },
                onSuccess: () => {
                  toast.show({ message: 'Plan odświeżony ze źródeł.' });
                },
              });
            }}
          >
            <RefreshCw aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          </IconButton>
        ) : null}
      </header>
      {content}
    </main>
  );
}
