import { Smartphone } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button, ErrorState, ListRow, Sheet, SkeletonList } from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { useLogoutAll, useRevokeSession, useSessions } from '../hooks/use-settings.js';
import { sessionCaption, sessionName } from '../settings-view.js';

/**
 * Arkusz aktywnych urządzeń ([09 §3.5](../../../../../../plans/09-security-auth.md#35-zarządzanie-sesjami)).
 *
 * Każde urządzenie da się wylogować osobno; „Wyloguj wszędzie" zamyka też to, na którym
 * się jest — na wypadek zgubionego telefonu, z którego ktoś mógłby dalej korzystać.
 */

/** Właściwości arkusza urządzeń. */
export interface SessionsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Arkusz urządzeń.
 *
 * @param props - Właściwości komponentu.
 * @param props.open - Czy arkusz jest otwarty.
 * @param props.onOpenChange - Zmiana stanu otwarcia.
 * @returns Element arkusza.
 */
export function SessionsSheet({ open, onOpenChange }: SessionsSheetProps): ReactNode {
  const sessions = useSessions(open);
  const revoke = useRevokeSession();
  const logoutAll = useLogoutAll();
  const [confirmAll, setConfirmAll] = useState(false);

  let content: ReactNode;
  if (sessions.isPending) {
    content = <SkeletonList rows={2} />;
  } else if (sessions.isError) {
    content = (
      <ErrorState
        details={errorDetails(sessions.error)}
        onRetry={() => {
          void sessions.refetch();
        }}
        retrying={sessions.isFetching}
        title="Nie udało się wczytać urządzeń"
      />
    );
  } else {
    content = (
      <ul>
        {sessions.data.map((session, index) => (
          <li key={session.id}>
            <ListRow
              amount={
                session.current ? undefined : (
                  <Button
                    aria-label={`Wyloguj: ${sessionName(session)}`}
                    loading={revoke.isPending && revoke.variables === session.id}
                    onClick={() => {
                      revoke.mutate(session.id);
                    }}
                    size="small"
                    variant="ghost"
                  >
                    Wyloguj
                  </Button>
                )
              }
              caption={sessionCaption(session)}
              first={index === 0}
              icon={
                <Smartphone aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={1.5} />
              }
              name={sessionName(session)}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Sheet
      description="Urządzenia, na których jesteś zalogowany. Sesja wygasa po 30 dniach bez użycia."
      onOpenChange={(next) => {
        if (!next) setConfirmAll(false);
        onOpenChange(next);
      }}
      open={open}
      title="Urządzenia"
    >
      <div className="flex flex-col gap-5">
        {content}
        {revoke.isError ? (
          <p className="text-sm text-danger" role="alert">
            {revoke.error.message}
          </p>
        ) : null}
        {confirmAll ? (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <p className="text-sm">
              Wylogować wszystkie urządzenia, także to? Trzeba będzie zalogować się ponownie.
            </p>
            <Button
              loading={logoutAll.isPending}
              onClick={() => {
                logoutAll.mutate();
              }}
              size="large"
              variant="danger"
            >
              Tak, wyloguj wszędzie
            </Button>
            <Button
              onClick={() => {
                setConfirmAll(false);
              }}
              size="large"
              variant="ghost"
            >
              Anuluj
            </Button>
          </div>
        ) : (
          <Button
            onClick={() => {
              setConfirmAll(true);
            }}
            size="large"
            variant="ghost"
          >
            Wyloguj wszędzie
          </Button>
        )}
        {logoutAll.isError ? (
          <p className="text-sm text-danger" role="alert">
            {logoutAll.error.message}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
