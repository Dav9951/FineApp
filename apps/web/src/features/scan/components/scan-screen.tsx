import type { DocumentListItemDto, UploadDocumentKind } from '@fineapp/shared';
import { AlertTriangle, Camera, CheckCircle2, FileText, FolderOpen, Loader2 } from 'lucide-react';
import { useId, useState, type ChangeEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  Money,
  OptionGrid,
  Section,
  SkeletonList,
} from '../../../components/ui/index.js';
import { ApiRequestError, errorDetails } from '../../../lib/api-client.js';
import { cn } from '../../../lib/cn.js';
import { formatDateShort } from '../../../lib/format.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useTransactionSheet } from '../../transactions/components/transaction-sheet.js';
import { useAiUsage, useDocuments, useUploadDocument } from '../hooks/use-documents.js';
import { prepareUpload } from '../resize-image.js';
import { KIND_OPTIONS, recentRow, type RecentRow } from '../scan-view.js';

/**
 * Ekran skanu — `/scan`, stan A „Wybór źródła"
 * ([06 §3.4](../../../../../../plans/06-ui-views.md#34-skanowanie--scan), `F7-8`).
 *
 * Dwa wejścia: aparat (`capture="environment"`, 06 §5) i plik (zdjęcie albo PDF wyciągu).
 * Zdjęcie jest skalowane w przeglądarce przed wysyłką (`F7-9`). Po wrzuceniu ekran
 * przechodzi do `/scan/:id`, gdzie trwa analiza — da się go opuścić, wynik czeka na
 * liście „Ostatnie".
 */

/** Ikona wiersza „Ostatnie" po tonie statusu. */
const TONE_ICON: Readonly<Record<RecentRow['tone'], ReactNode>> = {
  neutral: <FileText aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={1.5} />,
  progress: (
    <Loader2
      aria-hidden="true"
      className="h-[17px] w-[17px] motion-safe:animate-spin"
      strokeWidth={1.5}
    />
  ),
  danger: (
    <AlertTriangle aria-hidden="true" className="h-[17px] w-[17px] text-danger" strokeWidth={1.5} />
  ),
  success: (
    <CheckCircle2 aria-hidden="true" className="h-[17px] w-[17px] text-success" strokeWidth={1.5} />
  ),
};

/** Błąd wrzucenia pokazany pod przyciskami. */
interface UploadProblem {
  readonly message: string;
  /** Dokument, do którego warto przejść (duplikat albo zachowany przy limicie). */
  readonly documentId?: string;
}

/**
 * Komunikat po nieudanym wrzuceniu — z odnośnikiem do istniejącego dokumentu przy
 * duplikacie (04 §13 `existingDocumentId`).
 *
 * @param error - Błąd mutacji.
 * @returns Komunikat i dokument.
 */
function uploadProblem(error: unknown): UploadProblem {
  if (error instanceof ApiRequestError) {
    const target = error.details.find(
      (detail) => detail.path === 'existingDocumentId' || detail.path === 'documentId',
    );
    return {
      message: error.message,
      ...(target === undefined ? {} : { documentId: target.message }),
    };
  }
  return { message: 'Nie udało się wysłać pliku. Sprawdź połączenie i spróbuj ponownie.' };
}

/**
 * Wiersz listy „Ostatnie".
 *
 * @param props - Właściwości komponentu.
 * @param props.item - Dokument.
 * @param props.first - Pierwszy wiersz listy.
 * @param props.onOpen - Otwarcie dokumentu.
 * @returns Element wiersza.
 */
function RecentDocumentRow({
  item,
  first,
  onOpen,
}: {
  item: DocumentListItemDto;
  first: boolean;
  onOpen: () => void;
}): ReactNode {
  const row = recentRow(item);
  const caption =
    item.bookedOn === null ? row.caption : `${formatDateShort(item.bookedOn)} · ${row.caption}`;
  return (
    <ListRow
      amount={
        item.totalMinor === null ? undefined : (
          <Money amountMinor={item.totalMinor} size="sm" variant="expense" />
        )
      }
      caption={caption}
      first={first}
      icon={TONE_ICON[row.tone]}
      name={row.title}
      onClick={onOpen}
    />
  );
}

/**
 * Ekran skanu.
 *
 * @returns Element ekranu.
 */
export default function ScanScreen(): ReactNode {
  const navigate = useNavigate();
  const { openNew } = useTransactionSheet();
  const usage = useAiUsage();
  const recent = useDocuments();
  const upload = useUploadDocument();
  const [kind, setKind] = useState<UploadDocumentKind>('receipt');
  const [problem, setProblem] = useState<UploadProblem | null>(null);
  const [preparing, setPreparing] = useState(false);
  const cameraId = useId();
  const fileId = useId();

  /**
   * Wysyła wybrany plik i przechodzi do przeglądu.
   *
   * @param event - Zmiana pola pliku.
   */
  const handleFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    // Czyścimy pole, żeby ponowny wybór tego samego pliku też wywołał `change`.
    event.target.value = '';
    if (file === undefined) return;
    setProblem(null);
    setPreparing(true);
    try {
      const prepared = await prepareUpload(file);
      const result = await upload.mutateAsync({
        file: prepared.blob,
        filename: prepared.filename,
        kind,
      });
      void navigate(`/scan/${result.id}`);
    } catch (error) {
      setProblem(uploadProblem(error));
    } finally {
      setPreparing(false);
    }
  };

  if (usage.data?.enabled === false) {
    return (
      <main>
        <h1 className="text-xl font-semibold">Skan</h1>
        <EmptyState
          action={
            <Button
              onClick={() => {
                openNew('expense');
              }}
              size="large"
            >
              Dodaj wydatek ręcznie
            </Button>
          }
          description="Odczyt paragonów przez AI jest wyłączony w ustawieniach serwera."
          icon={<Camera aria-hidden="true" className="h-6 w-6" strokeWidth={1.5} />}
          title="Odczyt dokumentów jest wyłączony"
        />
      </main>
    );
  }

  const busy = preparing || upload.isPending;
  const accept = kind === 'receipt' ? 'image/*' : 'image/*,application/pdf';

  let recentContent: ReactNode;
  if (recent.isPending) {
    recentContent = <SkeletonList rows={3} />;
  } else if (recent.isError) {
    recentContent = (
      <ErrorState
        details={errorDetails(recent.error)}
        lastUpdatedAt={lastUpdatedLabel(recent.dataUpdatedAt)}
        onRetry={() => {
          void recent.refetch();
        }}
        retrying={recent.isFetching}
        title="Nie udało się wczytać ostatnich dokumentów"
      />
    );
  } else if (recent.data.length === 0) {
    recentContent = (
      <p className="py-4 text-sm text-muted-foreground">
        Nic jeszcze nie wrzucono. Pierwszy paragon pojawi się tutaj.
      </p>
    );
  } else {
    recentContent = (
      <ul>
        {recent.data.map((item, index) => (
          <li key={item.id}>
            <RecentDocumentRow
              first={index === 0}
              item={item}
              onOpen={() => {
                void navigate(`/scan/${item.id}`);
              }}
            />
          </li>
        ))}
      </ul>
    );
  }

  const tileClass = cn(
    'flex min-h-[112px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card',
    'text-base font-medium shadow-sheet focus-within:ring-2 focus-within:ring-ring active:bg-muted',
    busy && 'pointer-events-none opacity-50',
  );

  return (
    <main>
      <h1 className="text-xl font-semibold">Wrzuć dokument</h1>

      <Section first>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={tileClass} htmlFor={cameraId}>
            <Camera aria-hidden="true" className="h-7 w-7 text-primary" strokeWidth={1.5} />
            Zrób zdjęcie
            <input
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={busy}
              id={cameraId}
              onChange={(event) => {
                void handleFile(event);
              }}
              type="file"
            />
          </label>
          <label className={tileClass} htmlFor={fileId}>
            <FolderOpen aria-hidden="true" className="h-7 w-7 text-primary" strokeWidth={1.5} />
            Wybierz plik
            <input
              accept={accept}
              className="sr-only"
              disabled={busy}
              id={fileId}
              onChange={(event) => {
                void handleFile(event);
              }}
              type="file"
            />
          </label>
        </div>

        <OptionGrid
          className="mt-4"
          legend="Rodzaj"
          onChange={setKind}
          options={KIND_OPTIONS}
          value={kind}
        />

        {busy ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
            {preparing && !upload.isPending ? 'Przygotowuję zdjęcie…' : 'Wysyłam…'}
          </p>
        ) : null}

        {problem === null ? null : (
          <div
            className="mt-4 flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm"
            role="alert"
          >
            <p>{problem.message}</p>
            {problem.documentId === undefined ? null : (
              <Button
                className="self-start"
                onClick={() => {
                  void navigate(`/scan/${problem.documentId ?? ''}`);
                }}
                size="small"
                variant="soft"
              >
                Otwórz dokument
              </Button>
            )}
          </div>
        )}
      </Section>

      <Section title="Ostatnie">{recentContent}</Section>
    </main>
  );
}
