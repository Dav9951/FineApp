import type { IncomeSourceDto } from '@fineapp/shared';
import { Coins, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  Section,
  SkeletonList,
} from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useSettings } from '../../settings/hooks/use-settings.js';
import { useIncomeSourcesWithArchive } from '../hooks/use-income-sources.js';
import { incomeSourceCaption, splitArchived } from '../income-sources-view.js';
import { IncomeSourceFormSheet } from './income-source-form-sheet.js';

/**
 * Ekran źródeł przychodu — `/settings/income-sources`
 * ([06 §3.12](../../../../../../plans/06-ui-views.md#312-ustawienia--settings)).
 *
 * Aktywne źródła u góry, archiwum na dole — jak na ekranie kategorii. Domownicy
 * przychodzą z `GET /settings` i służą do pola „Czyje" (`Z-15`).
 */

/** Otwarty arkusz: nowe źródło albo edycja istniejącego. */
type OpenSheet = { mode: 'new' } | { mode: 'edit'; source: IncomeSourceDto } | null;

/**
 * Ekran źródeł przychodu.
 *
 * @returns Element ekranu.
 */
export default function IncomeSourcesScreen(): ReactNode {
  const sources = useIncomeSourcesWithArchive();
  const settings = useSettings();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const members = settings.data?.users ?? [];

  const openNew = (): void => {
    setSheet({ mode: 'new' });
  };

  const rows = (list: readonly IncomeSourceDto[]): ReactNode => (
    <ul>
      {list.map((source, index) => (
        <li key={source.id}>
          <ListRow
            caption={incomeSourceCaption(source, members)}
            first={index === 0}
            icon={<Coins aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={1.5} />}
            name={source.name}
            onClick={() => {
              setSheet({ mode: 'edit', source });
            }}
          />
        </li>
      ))}
    </ul>
  );

  let content: ReactNode;
  if (sources.isPending) {
    content = (
      <div aria-busy="true" aria-label="Wczytywanie źródeł przychodu">
        <Section first>
          <SkeletonList rows={3} />
        </Section>
      </div>
    );
  } else if (sources.isError) {
    content = (
      <ErrorState
        details={errorDetails(sources.error)}
        lastUpdatedAt={lastUpdatedLabel(sources.dataUpdatedAt)}
        onRetry={() => {
          void sources.refetch();
        }}
        retrying={sources.isFetching}
        title="Nie udało się wczytać źródeł przychodu"
      />
    );
  } else if (sources.data.length === 0) {
    content = (
      <EmptyState
        action={
          <Button onClick={openNew} size="large" variant="primary">
            Dodaj źródło
          </Button>
        }
        description="Źródło mówi, skąd przyszły pieniądze: pensja, zlecenie, najem. Dzięki temu widać, ile daje każde z nich."
        icon={<Coins aria-hidden="true" className="h-7 w-7" strokeWidth={1.5} />}
        title="Nie masz jeszcze źródeł przychodu"
      />
    );
  } else {
    const { active, archived } = splitArchived(sources.data);
    content = (
      <>
        <Section first>
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">Wszystkie źródła są w archiwum.</p>
          ) : (
            rows(active)
          )}
        </Section>
        {archived.length === 0 ? null : <Section title="Archiwum">{rows(archived)}</Section>}
      </>
    );
  }

  return (
    <main>
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Źródła przychodu</h1>
        <IconButton label="Dodaj źródło przychodu" onClick={openNew}>
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </IconButton>
      </header>
      {content}
      <IncomeSourceFormSheet
        members={members}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        open={sheet !== null}
        {...(sheet?.mode === 'edit' ? { source: sheet.source } : {})}
      />
    </main>
  );
}
