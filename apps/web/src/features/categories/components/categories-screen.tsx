import {
  currentMonthKey,
  formatMonth,
  type CategoryDto,
  type CategoryKind,
  type CategoryTreeDto,
  type MonthKey,
} from '@fineapp/shared';
import { ChevronLeft, Plus, Tags } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  Money,
  Section,
  SkeletonList,
  Tabs,
} from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { transactionCountLabel } from '../../../lib/format.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useAuth } from '../../auth/auth-context.js';
import { splitTree, usageLookup, type Usage } from '../categories-view.js';
import { useCategoryTreeWithArchive, useCategoryUsage } from '../hooks/use-categories.js';
import { CategoryFormSheet } from './category-form-sheet.js';

/**
 * Kategorie — `/settings/categories`
 * ([06 §3.11](../../../../../../plans/06-ui-views.md#311-kategorie--settingscategories)).
 *
 * Drzewo kategorii jednego rodzaju z licznikiem transakcji i sumą z bieżącego miesiąca,
 * plakietką „własna" przy kategoriach dodanych przez domowników i archiwum na dole. Dotknięcie kategorii otwiera arkusz z edycją,
 * podpowiedziami dla AI, archiwizacją, scaleniem i usunięciem.
 *
 * Rodzaj jest w adresie (`?kind=income`) — jak filtry historii: link do kategorii
 * przychodów prowadzi prosto do nich, a „wstecz" wraca do poprzedniej zakładki.
 */

/** Zakładki rodzajów. */
const KINDS: readonly { value: CategoryKind; label: string }[] = [
  { value: 'expense', label: 'Wydatki' },
  { value: 'income', label: 'Przychody' },
  { value: 'transfer', label: 'Przelewy' },
];

/**
 * Rodzaj z adresu; nieznany — wydatki.
 *
 * @param raw - Wartość parametru `kind`.
 * @returns Rodzaj kategorii.
 */
function kindOf(raw: string | null): CategoryKind {
  return KINDS.find((item) => item.value === raw)?.value ?? 'expense';
}

/** Co pokazuje arkusz. */
type SheetState =
  | { readonly open: false }
  | { readonly open: true; readonly category?: CategoryDto; readonly childCount: number };

/**
 * Podpis wiersza: liczba transakcji i plakietka kategorii systemowej.
 *
 * @param props - Właściwości komponentu.
 * @param props.usage - Użycie kategorii.
 * @param props.category - Kategoria.
 * @param props.parentName - Rodzic — w sekcji archiwum.
 * @returns Element podpisu.
 */
function Caption({
  usage,
  category,
  parentName,
}: {
  usage: Usage;
  category: CategoryDto;
  parentName?: string | null;
}): ReactNode {
  return (
    <span className="inline-flex items-center gap-1">
      {parentName ? <span>w: {parentName} ·</span> : null}
      <span>
        {usage.transactionCount === 0
          ? 'nieużywana'
          : transactionCountLabel(usage.transactionCount)}
      </span>
      {/* Seed daje `isSystem` wszystkim 94 kategoriom, więc „systemowa" stała przy prawie
          każdym wierszu i nic nie mówiła — wyróżniamy wyjątek, nie regułę (`Z-25`). */}
      {category.isSystem ? null : <Badge tone="neutral">własna</Badge>}
    </span>
  );
}

/**
 * Suma kategorii w miesiącu — zero się nie pokazuje, bo przy kilkudziesięciu kategoriach
 * kolumna „0,00 zł" przykrywa te kilka, które coś znaczą.
 *
 * @param props - Właściwości komponentu.
 * @param props.amountMinor - Suma w groszach.
 * @returns Element kwoty albo nic.
 */
function MonthAmount({ amountMinor }: { amountMinor: number }): ReactNode {
  return amountMinor === 0 ? null : <Money amountMinor={amountMinor} size="sm" />;
}

/**
 * Lista kategorii jednego rodzaju wraz ze stanami.
 *
 * @param props - Właściwości komponentu.
 * @param props.kind - Rodzaj kategorii.
 * @param props.month - Miesiąc sum.
 * @param props.onOpen - Otwarcie arkusza dla kategorii albo nowej.
 * @returns Element listy.
 */
function CategoryList({
  kind,
  month,
  onOpen,
}: {
  kind: CategoryKind;
  month: MonthKey;
  onOpen: (category?: CategoryDto) => void;
}): ReactNode {
  const tree = useCategoryTreeWithArchive(kind);
  const usage = useCategoryUsage(month);

  if (tree.isPending || usage.isPending) {
    return (
      <div aria-busy="true" aria-label="Wczytywanie kategorii">
        <SkeletonList rows={6} />
      </div>
    );
  }
  if (tree.isError || usage.isError) {
    const failed = tree.isError ? tree : usage;
    return (
      <ErrorState
        details={errorDetails(failed.error)}
        lastUpdatedAt={lastUpdatedLabel(tree.dataUpdatedAt)}
        onRetry={() => {
          void tree.refetch();
          void usage.refetch();
        }}
        retrying={tree.isFetching || usage.isFetching}
        title="Nie udało się wczytać kategorii"
      />
    );
  }

  const { active, archived } = splitTree(tree.data);
  const usageOf = usageLookup(tree.data, usage.data);
  const open = onOpen;

  if (active.length === 0 && archived.length === 0) {
    return (
      <EmptyState
        action={
          <Button
            onClick={() => {
              open();
            }}
            size="large"
            variant="primary"
          >
            Dodaj kategorię
          </Button>
        }
        description="Kategorie porządkują wydatki i przychody — i podpowiadają AI przy paragonach."
        icon={<Tags aria-hidden="true" className="h-7 w-7" strokeWidth={1.5} />}
        title="Brak kategorii tego rodzaju"
      />
    );
  }

  return (
    <>
      <p className="text-meta text-muted-foreground">
        Liczba transakcji ze wszystkich miesięcy, kwota z miesiąca {formatMonth(month)}.
      </p>
      {active.length > 0 ? (
        <ul className="mt-2">
          {active.map((root, rootIndex) => (
            <li key={root.id}>
              <ListRow
                amount={<MonthAmount amountMinor={usageOf(root.id).monthAmountMinor} />}
                caption={<Caption category={root} usage={usageOf(root.id)} />}
                first={rootIndex === 0}
                name={root.name}
                onClick={() => {
                  open(root);
                }}
                wrapName
              />
              {root.children.length > 0 ? (
                <ul aria-label={`Podkategorie: ${root.name}`} className="pl-6">
                  {root.children.map((child) => (
                    <li key={child.id}>
                      <ListRow
                        amount={<MonthAmount amountMinor={usageOf(child.id).monthAmountMinor} />}
                        caption={<Caption category={child} usage={usageOf(child.id)} />}
                        name={child.name}
                        onClick={() => {
                          open(child);
                        }}
                        wrapName
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {archived.length > 0 ? (
        <Section title="Archiwum">
          <ul>
            {archived.map((entry, index) => (
              <li key={entry.category.id}>
                <ListRow
                  caption={
                    <Caption
                      category={entry.category}
                      parentName={entry.parentName}
                      usage={usageOf(entry.category.id)}
                    />
                  }
                  className="opacity-70"
                  first={index === 0}
                  name={entry.category.name}
                  onClick={() => {
                    open(entry.category);
                  }}
                  wrapName
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

/**
 * Ekran kategorii.
 *
 * @returns Element ekranu.
 */
export default function CategoriesScreen(): ReactNode {
  const { household } = useAuth();
  const month = currentMonthKey(household?.timezone ?? 'Europe/Warsaw');
  const [params, setParams] = useSearchParams();
  const kind = kindOf(params.get('kind'));
  const [sheet, setSheet] = useState<SheetState>({ open: false });
  // To samo zapytanie co lista (wspólna pamięć podręczna) — arkusz bierze z niego rodziców
  // i cele scalenia, także przy „+" w nagłówku.
  const tree = useCategoryTreeWithArchive(kind);
  const fullTree: readonly CategoryTreeDto[] = tree.data ?? [];

  const openSheet = (category?: CategoryDto): void => {
    const childCount =
      category === undefined
        ? 0
        : (fullTree.find((root) => root.id === category.id)?.children.length ?? 0);
    setSheet({ open: true, category, childCount });
  };

  const list = <CategoryList kind={kind} month={month} onOpen={openSheet} />;

  return (
    <main>
      <Link
        className="-ml-2 inline-flex min-h-touch items-center gap-1 px-2 text-sm text-primary"
        to="/more"
      >
        <ChevronLeft aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
        Więcej
      </Link>
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Kategorie</h1>
        <IconButton
          label="Dodaj kategorię"
          onClick={() => {
            openSheet();
          }}
        >
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </IconButton>
      </header>

      <div className="mt-4">
        <Tabs
          items={KINDS.map((item) => ({ value: item.value, label: item.label, content: list }))}
          onValueChange={(value) => {
            setParams(value === 'expense' ? {} : { kind: value });
          }}
          value={kind}
        />
      </div>

      <CategoryFormSheet
        active={splitTree(fullTree).active}
        category={sheet.open ? sheet.category : undefined}
        childCount={sheet.open ? sheet.childCount : 0}
        kind={kind}
        onOpenChange={(open) => {
          if (!open) setSheet({ open: false });
        }}
        open={sheet.open}
      />
    </main>
  );
}
