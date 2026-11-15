import { ScrollText } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Badge, EmptyState, ErrorState, SkeletonList } from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { detailRows, LEVEL_LABEL, LEVEL_TONE, logTime } from '../ai-log-view.js';
import { useAiLog } from '../hooks/use-documents.js';

/**
 * Lista wpisów dziennika odczytu (ADR-086) — w arkuszu ustawień i na ekranie dokumentu.
 *
 * Cztery stany jak każdy ekran z danymi. Wpisy od najnowszych; przy całym dzienniku każdy
 * ma nazwę pliku z odnośnikiem do dokumentu (o ile dokument jeszcze istnieje).
 */

/** Właściwości listy dziennika. */
export interface AiLogListProps {
  /** Tylko wpisy jednego dokumentu — bez nazwy pliku przy wpisach. */
  documentId?: string;
  /** Czy pytać (arkusz otwarty). */
  enabled?: boolean;
  /** Odświeżaj w trakcie analizy. */
  live?: boolean;
  /** Strefa gospodarstwa do godzin. */
  timezone?: string;
}

/**
 * Lista wpisów dziennika.
 *
 * @param props - Właściwości komponentu.
 * @param props.documentId - Filtr dokumentu.
 * @param props.enabled - Czy pytać.
 * @param props.live - Odświeżanie w trakcie analizy.
 * @param props.timezone - Strefa gospodarstwa.
 * @returns Element listy.
 */
export function AiLogList({ documentId, enabled, live, timezone }: AiLogListProps): ReactNode {
  const log = useAiLog({
    ...(documentId === undefined ? {} : { documentId }),
    ...(enabled === undefined ? {} : { enabled }),
    ...(live === undefined ? {} : { live }),
  });

  if (log.isPending) return <SkeletonList rows={3} />;
  if (log.isError) {
    return (
      <ErrorState
        details={errorDetails(log.error)}
        onRetry={() => {
          void log.refetch();
        }}
        retrying={log.isFetching}
        title="Nie udało się wczytać dziennika"
      />
    );
  }
  if (log.data.length === 0) {
    return (
      <EmptyState
        description="Tu pojawi się przebieg każdego odczytu: czas, tokeny, wymiary obrazu i przyczyna błędu."
        icon={<ScrollText aria-hidden="true" className="h-6 w-6" strokeWidth={1.5} />}
        title="Dziennik jest pusty"
      />
    );
  }

  return (
    <ol className="flex flex-col gap-3" aria-label="Wpisy dziennika odczytu">
      {log.data.map((entry) => {
        const rows = detailRows(entry);
        return (
          <li className="rounded-md border border-border bg-card p-3" key={entry.id}>
            <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
              <Badge tone={LEVEL_TONE[entry.level]}>{LEVEL_LABEL[entry.level]}</Badge>
              <time dateTime={new Date(entry.createdAt).toISOString()}>
                {logTime(entry.createdAt, timezone)}
              </time>
              {documentId === undefined && entry.documentName !== null ? (
                entry.documentId === null ? (
                  <span className="min-w-0 truncate">{entry.documentName}</span>
                ) : (
                  <Link
                    className="min-w-0 truncate text-primary underline-offset-2 hover:underline"
                    to={`/scan/${entry.documentId}`}
                  >
                    {entry.documentName}
                  </Link>
                )
              ) : null}
            </div>
            <p className="mt-1 text-sm">{entry.message}</p>
            {rows.length === 0 ? null : (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-caption">
                {rows.map((row) => (
                  <div className="contents" key={row.label}>
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="min-w-0 break-words font-mono tabular-nums">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ol>
  );
}
