import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { ErrorState, SkeletonList } from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { useShoppingLists } from '../hooks/use-shopping.js';

/**
 * `/shopping/default` — skrót z ikony aplikacji (manifest PWA, 06 §3.15) prowadzi prosto
 * do listy domyślnej; bez list — do `/shopping`.
 *
 * @returns Przekierowanie albo stan wczytywania.
 */
export default function ShoppingDefaultRoute(): ReactNode {
  const lists = useShoppingLists();
  if (lists.isPending) return <SkeletonList rows={4} />;
  if (lists.isError) {
    return (
      <ErrorState
        details={errorDetails(lists.error)}
        onRetry={() => {
          void lists.refetch();
        }}
        retrying={lists.isFetching}
        title="Nie udało się wczytać list"
      />
    );
  }
  const target = lists.data.find((list) => list.isDefault) ?? lists.data[0];
  return (
    <Navigate replace to={target === undefined ? '/shopping?all=1' : `/shopping/${target.id}`} />
  );
}
