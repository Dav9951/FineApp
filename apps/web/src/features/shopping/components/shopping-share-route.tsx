import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EmptyState, ErrorState, SkeletonList } from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { useShoppingLists } from '../hooks/use-shopping.js';
import { sharedRecipe } from '../shopping-view.js';
import { ImportForm } from './shopping-import-sheet.js';

/**
 * `/shopping/share` — cel udostępniania PWA (`share_target`, Android, 06 §3.15, `F10-9`).
 *
 * „Udostępnij → FineApp" na stronie przepisu otwiera formularz przepisu z wpisanym linkiem
 * (albo tekstem), dla listy domyślnej. Parametry przychodzą z przeglądarki, więc traktujemy
 * je jak każde wejście od użytkownika: link przechodzi tę samą walidację i to samo
 * bezpieczne pobieranie na serwerze (09 §7a).
 *
 * @returns Element ekranu.
 */
export default function ShoppingShareRoute(): ReactNode {
  const [params] = useSearchParams();
  const lists = useShoppingLists();
  const initial = sharedRecipe(params.get('url'), params.get('text'));

  let content: ReactNode;
  if (lists.isPending) {
    content = <SkeletonList rows={3} />;
  } else if (lists.isError) {
    content = (
      <ErrorState
        details={errorDetails(lists.error)}
        onRetry={() => {
          void lists.refetch();
        }}
        retrying={lists.isFetching}
        title="Nie udało się wczytać list"
      />
    );
  } else {
    const target = lists.data.find((list) => list.isDefault) ?? lists.data[0];
    content =
      target === undefined ? (
        <EmptyState
          action={<Link to="/shopping?all=1">Załóż listę</Link>}
          title="Nie masz żadnej listy"
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">Do listy „{target.name}”.</p>
          <ImportForm initial={initial} listId={target.id} />
        </>
      );
  }
  return (
    <main>
      <h1 className="mb-2 text-xl font-semibold">Przepis do listy zakupów</h1>
      {content}
    </main>
  );
}
