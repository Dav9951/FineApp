import {
  formatShoppingQuantity,
  MILLI_PER_UNIT,
  SHOPPING_UNIT_LABELS,
  type ShoppingImportDto,
  type ShoppingImportItemDto,
} from '@fineapp/shared';
import { ChevronLeft, Minus, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Section,
  SkeletonList,
  useHideFab,
  useToast,
} from '../../../components/ui/index.js';
import { ApiRequestError, errorDetails } from '../../../lib/api-client.js';
import { cn } from '../../../lib/cn.js';
import { pluralPl } from '../../../lib/format.js';
import {
  useImportActions,
  useImportChange,
  useShoppingImport,
  useShoppingLists,
  useUpsertProduct,
  type ImportChange,
} from '../hooks/use-shopping.js';
import { factorLabel } from '../shopping-view.js';

/**
 * Przegląd odczytu — `/shopping/:listId/import/:importId`
 * ([06 §3.15](../../../../../../plans/06-ui-views.md#315-listy-zakupów--shopping-shoppinglistid-shoppinglistidimportimportid),
 * `F10-8`, `F10-9`).
 *
 * **AI proponuje, człowiek zatwierdza** (08 §1): nic nie trafia na listę bez „Dodaj N
 * pozycji". Każda zmiana od razu idzie na serwer, więc odświeżenie i druga osoba widzą
 * to samo. Przepis ma dwie sekcje — „Do kupienia" i „Już mam" — a zmiana mnożnika
 * przelicza ilości bez ponownego odczytu.
 */

/** Gotowe mnożniki w przeglądzie. */
const FACTORS = [5_000, 7_500, 10_000, 15_000, 20_000] as const;

/**
 * Trasa przeglądu.
 *
 * @returns Element ekranu.
 */
export default function ShoppingImportScreen(): ReactNode {
  const { listId = '', importId = '' } = useParams();
  const query = useShoppingImport(importId);
  useHideFab(true);
  const back = (
    <IconButton asChild label="Wróć do listy" variant="link">
      <Link to={`/shopping/${listId}`}>
        <ChevronLeft aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
      </Link>
    </IconButton>
  );

  if (query.isPending || query.data?.status === 'processing') {
    const recipe = query.data?.kind === 'recipe';
    return (
      <main aria-busy="true">
        <header className="flex items-center gap-2">
          {back}
          <h1 className="text-xl font-semibold">{recipe ? 'Czytam przepis…' : 'Czytam listę…'}</h1>
        </header>
        <p className="mt-2 text-sm text-muted-foreground">
          Zwykle kilka sekund. Możesz wyjść — odczyt zaczeka na liście.
        </p>
        <Section first>
          <SkeletonList rows={5} />
        </Section>
      </main>
    );
  }
  if (query.isError) {
    const notFound = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <main>
        <header className="flex items-center gap-2">{back}</header>
        {notFound ? (
          <EmptyState
            title="Tego odczytu już nie ma"
            description="Mógł zostać odrzucony na drugim telefonie."
          />
        ) : (
          <ErrorState
            details={errorDetails(query.error)}
            onRetry={() => {
              void query.refetch();
            }}
            retrying={query.isFetching}
            title="Nie udało się wczytać odczytu"
          />
        )}
      </main>
    );
  }
  return <Review back={back} data={query.data} />;
}

/**
 * Przegląd gotowego (albo nieudanego, zamkniętego) odczytu.
 *
 * @param props - Właściwości komponentu.
 * @param props.data - Import.
 * @param props.back - Przycisk powrotu.
 * @returns Element ekranu.
 */
function Review({
  data,
  back,
}: {
  readonly data: ShoppingImportDto;
  readonly back: ReactNode;
}): ReactNode {
  const navigate = useNavigate();
  const toast = useToast();
  const change = useImportChange(data.id);
  const actions = useImportActions(data.id);
  const lists = useShoppingLists();
  // Jeden klucz na otwarcie przeglądu — ponowione zatwierdzenie nie dopisze drugi raz.
  const [commitKey] = useState(() => crypto.randomUUID());
  const recipe = data.kind === 'recipe';
  const fail = (failure: Error): void => {
    toast.show({ message: failure.message });
  };

  const discard = (): void => {
    actions.discard.mutate(undefined, {
      onError: fail,
      onSuccess: () => {
        toast.show({ message: 'Odczyt odrzucony.' });
        void navigate(`/shopping/${data.listId}`);
      },
    });
  };

  if (data.status === 'failed') {
    return (
      <main>
        <header className="flex items-center gap-2">
          {back}
          <h1 className="text-xl font-semibold">Nie udało się odczytać</h1>
        </header>
        <EmptyState
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                loading={actions.retry.isPending}
                onClick={() => {
                  actions.retry.mutate(undefined, { onError: fail });
                }}
              >
                Spróbuj ponownie
              </Button>
              <Button onClick={discard} variant="ghost">
                Odrzuć
              </Button>
            </div>
          }
          className="mt-6"
          description={[data.errorMessage, data.notes].filter((part) => part !== null).join(' ')}
          title={recipe ? 'Przepis nieodczytany' : 'Lista nieodczytana'}
        />
      </main>
    );
  }
  if (data.status !== 'parsed') {
    return (
      <main>
        <header className="flex items-center gap-2">{back}</header>
        <EmptyState
          action={
            <Button asChild>
              <Link to={`/shopping/${data.listId}`}>Wróć do listy</Link>
            </Button>
          }
          className="mt-6"
          title={data.status === 'committed' ? 'Pozycje są już na liście' : 'Odczyt odrzucony'}
        />
      </main>
    );
  }

  const toBuy = data.items.filter((item) => item.selected);
  const have = data.items.filter((item) => !item.selected);
  const target = (lists.data ?? []).find((list) => list.id === data.listId);
  const commit = (): void => {
    actions.commit.mutate(commitKey, {
      onError: fail,
      onSuccess: (result) => {
        toast.show({
          message:
            result.mergedCount === 0
              ? `Dodano ${String(result.addedCount)}.`
              : `Dodano ${String(result.addedCount)} · scalono ${String(result.mergedCount)}.`,
        });
        void navigate(`/shopping/${result.listId}`);
      },
    });
  };
  const patch = (body: ImportChange): void => {
    change.mutate(body, { onError: fail });
  };

  return (
    <main>
      <header className="flex items-center gap-2">
        {back}
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">
          {recipe ? (data.recipeTitle ?? 'Przepis') : 'Lista ze zdjęcia'}
        </h1>
        <Button onClick={discard} size="small" variant="link">
          Odrzuć
        </Button>
      </header>

      {recipe ? (
        <Section first>
          <p className="text-sm text-muted-foreground">
            {data.baseServings === null
              ? `Mnożnik ${factorLabel(data.servingsFactorBps ?? 10_000)}`
              : `Przepis na ${String(data.baseServings)} ${pluralPl(data.baseServings, 'porcję', 'porcje', 'porcji')} · ${factorLabel(data.servingsFactorBps ?? 10_000)}`}
          </p>
          <div aria-label="Ile przepisu robisz" className="mt-2 flex flex-wrap gap-2" role="group">
            {FACTORS.map((value) => (
              <button
                aria-pressed={data.servingsFactorBps === value}
                className={cn(
                  'min-h-touch rounded-full border px-4 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  data.servingsFactorBps === value
                    ? 'border-primary bg-muted text-primary'
                    : 'border-border bg-card',
                )}
                key={value}
                onClick={() => {
                  change.mutate(
                    { kind: 'import', body: { servingsFactorBps: value } },
                    { onError: fail },
                  );
                }}
                type="button"
              >
                {factorLabel(value)}
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {(lists.data ?? []).length > 1 ? (
        <Section first={!recipe} title="Do listy">
          <div aria-label="Lista docelowa" className="flex flex-wrap gap-2" role="group">
            {(lists.data ?? []).map((list) => (
              <button
                aria-pressed={list.id === data.listId}
                className={cn(
                  'min-h-touch rounded-full border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  list.id === data.listId
                    ? 'border-primary bg-muted text-primary'
                    : 'border-border bg-card',
                )}
                key={list.id}
                onClick={() => {
                  change.mutate({ kind: 'import', body: { listId: list.id } }, { onError: fail });
                }}
                type="button"
              >
                {list.name}
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {data.items.length === 0 ? (
        <EmptyState
          action={
            <Button
              loading={actions.retry.isPending}
              onClick={() => {
                actions.retry.mutate(undefined, { onError: fail });
              }}
              variant="ghost"
            >
              Spróbuj ponownie
            </Button>
          }
          className="mt-6"
          description={data.notes ?? 'Spróbuj wyraźniejszego zdjęcia albo dopisz produkty ręcznie.'}
          title="Nie znalazłem pozycji"
        />
      ) : null}

      {toBuy.length > 0 ? (
        <Section
          first={!recipe && (lists.data ?? []).length <= 1}
          title={`Do kupienia (${String(toBuy.length)})`}
        >
          <ul>
            {toBuy.map((item) => (
              <li key={item.id}>
                <ProposalRow item={item} onChange={patch} recipe={recipe} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {have.length > 0 ? (
        <Section
          title={recipe ? `Już mam (${String(have.length)})` : `Pominięte (${String(have.length)})`}
        >
          <ul>
            {have.map((item) => (
              <li key={item.id}>
                <ProposalRow item={item} onChange={patch} recipe={recipe} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="sticky bottom-[calc(theme(spacing.tabbar)+1px+env(safe-area-inset-bottom))] z-20 -mx-4 mt-6 bg-background px-4 py-3 md:bottom-0 md:-mx-6 md:px-6">
        <Button
          disabled={toBuy.length === 0}
          loading={actions.commit.isPending}
          onClick={commit}
          size="large"
        >
          {toBuy.length === 0
            ? 'Nic do dodania'
            : `Dodaj ${String(toBuy.length)} ${pluralPl(toBuy.length, 'pozycję', 'pozycje', 'pozycji')}${target === undefined ? '' : ` do „${target.name}”`}`}
        </Button>
      </div>
    </main>
  );
}

/**
 * Wiersz propozycji: zaznaczenie (do kupienia / już mam), nazwa, ilość ze stepperem,
 * podpisy „potrzeba …", „Już na liście", „Sprawdź", przełącznik „Zawsze mam" (przepis).
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Propozycja.
 * @param props.recipe - Czy to przepis.
 * @param props.onChange - Zapis zmiany.
 * @returns Element wiersza.
 */
function ProposalRow({
  item,
  recipe,
  onChange,
}: {
  readonly item: ShoppingImportItemDto;
  readonly recipe: boolean;
  readonly onChange: (change: ImportChange) => void;
}): ReactNode {
  const toast = useToast();
  const upsert = useUpsertProduct();
  const quantity = formatShoppingQuantity(item);
  const unit = item.unit ?? 'pcs';
  const step = unit === 'pcs' || unit === 'pack' ? MILLI_PER_UNIT : MILLI_PER_UNIT / 2;
  const setQuantity = (milli: number): void => {
    onChange({
      kind: 'item',
      itemId: item.id,
      body: milli <= 0 ? { quantityMilli: null, unit: null } : { quantityMilli: milli, unit },
    });
  };
  const toggle = (): void => {
    onChange({
      kind: 'item',
      itemId: item.id,
      body: { selected: !item.selected, alreadyHave: item.selected },
    });
  };
  const needed =
    item.neededAmountMilli === null || item.baseUnit === null
      ? recipe
        ? 'do smaku'
        : null
      : `potrzeba ${formatShoppingQuantity({ quantityMilli: item.neededAmountMilli, unit: item.baseUnit })}`;
  const pack =
    item.packageAmountMilli === null || item.baseUnit === null
      ? null
      : `${item.packageLabel ?? 'opakowanie'} ${formatShoppingQuantity({ quantityMilli: item.packageAmountMilli, unit: item.baseUnit })}`;
  const merge =
    item.mergeInto === null
      ? null
      : `Już na liście${item.mergeInto.quantityMilli === null ? '' : ` (${formatShoppingQuantity(item.mergeInto)})`}`;

  return (
    <div className="flex items-start gap-2 border-t border-border py-2 first:border-t-0">
      <button
        aria-checked={item.selected}
        aria-label={`${item.name} — ${item.selected ? 'do kupienia' : recipe ? 'już mam' : 'pominięte'}`}
        className="flex min-h-touch min-w-touch items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={toggle}
        role="checkbox"
        type="button"
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-sm border',
            item.selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
          )}
        >
          {item.selected ? '✓' : ''}
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col pt-2">
        <span className="flex flex-wrap items-center gap-2 text-base">
          {item.name}
          {item.needsReview ? <Badge tone="warning">Sprawdź</Badge> : null}
        </span>
        {item.needsReview || item.sourceText !== item.name ? (
          <span className="text-caption text-muted-foreground">„{item.sourceText}”</span>
        ) : null}
        {[needed, pack, merge].some((part) => part !== null) ? (
          <span className="text-caption text-muted-foreground">
            {[needed, pack, merge].filter((part) => part !== null).join(' · ')}
          </span>
        ) : null}
        {recipe ? (
          <button
            className="mt-1 min-h-touch self-start text-caption text-primary underline-offset-4 hover:underline"
            onClick={() => {
              upsert.mutate(
                { name: item.name, section: item.section, isStaple: !item.isStaple },
                {
                  onError: (failure) => {
                    toast.show({ message: failure.message });
                  },
                  onSuccess: (product) => {
                    toast.show({
                      message: product.isStaple
                        ? `„${product.name}” — zawsze w domu.`
                        : `„${product.name}” już nie jest „zawsze w domu”.`,
                    });
                  },
                },
              );
            }}
            type="button"
          >
            {item.isStaple ? 'Nie zawsze mam' : 'Zawsze mam'}
          </button>
        ) : null}
      </div>
      {item.selected ? (
        <div className="flex items-center gap-1 pt-1">
          <IconButton
            label={`Mniej: ${item.name}`}
            onClick={() => {
              setQuantity((item.quantityMilli ?? 0) - step);
            }}
            variant="link"
          >
            <Minus aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
          </IconButton>
          <span className="min-w-[3.5rem] text-center text-sm tabular-nums" aria-live="polite">
            {quantity === '' ? '—' : quantity}
          </span>
          <IconButton
            label={`Więcej: ${item.name}`}
            onClick={() => {
              setQuantity((item.quantityMilli ?? 0) + step);
            }}
            variant="link"
          >
            <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
          </IconButton>
          {item.quantityOverridden ? <span className="sr-only">ilość poprawiona</span> : null}
          {item.unit === null ? null : (
            <span className="sr-only">{SHOPPING_UNIT_LABELS[item.unit]}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
