import { normalizeShoppingName } from '@fineapp/shared';
import { ChevronLeft, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Section,
  SkeletonList,
  TextField,
  useToast,
} from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useStaples, useUpdateProduct, useUpsertProduct } from '../hooks/use-shopping.js';

/**
 * „Zawsze w domu" — `/shopping/staples`
 * ([06 §3.15](../../../../../../plans/06-ui-views.md#315-listy-zakupów--shopping-shoppinglistid-shoppinglistidimportimportid),
 * 17 §9 P-4).
 *
 * Produkty, które przy przepisie trafiają domyślnie do „Już mam". Zestaw startowy to
 * zwykłe wpisy — można je usuwać i dopisywać własne.
 */

/**
 * Ekran produktów „zawsze w domu".
 *
 * @returns Element ekranu.
 */
export default function ShoppingStaplesScreen(): ReactNode {
  const staples = useStaples();
  const upsert = useUpsertProduct();
  const update = useUpdateProduct();
  const toast = useToast();
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const add = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (name.trim() === '') {
      setError('Podaj nazwę produktu');
      return;
    }
    upsert.mutate(
      { name: name.trim(), isStaple: true },
      {
        onError: (failure) => {
          setError(failure.message);
        },
        onSuccess: (product) => {
          setName('');
          setError(undefined);
          toast.show({ message: `„${product.name}” jest teraz zawsze w domu.` });
        },
      },
    );
  };

  let content: ReactNode;
  if (staples.isPending) {
    content = <SkeletonList rows={6} />;
  } else if (staples.isError) {
    content = (
      <ErrorState
        details={errorDetails(staples.error)}
        lastUpdatedAt={lastUpdatedLabel(staples.dataUpdatedAt)}
        onRetry={() => {
          void staples.refetch();
        }}
        retrying={staples.isFetching}
        title="Nie udało się wczytać produktów"
      />
    );
  } else if (staples.data.length === 0) {
    content = (
      <EmptyState
        description="Produkty stąd przy przepisie trafiają do „Już mam”."
        title="Nic nie oznaczyłeś"
      />
    );
  } else {
    const key = normalizeShoppingName(filter);
    const visible = staples.data.filter((product) =>
      normalizeShoppingName(product.name).includes(key),
    );
    content = (
      <ul>
        {visible.map((product) => (
          <li
            className="flex min-h-touch items-center gap-2 border-t border-border first:border-t-0"
            key={product.id}
          >
            <span className="min-w-0 flex-1 truncate text-base">{product.name}</span>
            <IconButton
              label={`Usuń „${product.name}” z zawsze w domu`}
              onClick={() => {
                update.mutate(
                  { productId: product.id, body: { isStaple: false } },
                  {
                    onError: (failure) => {
                      toast.show({ message: failure.message });
                    },
                  },
                );
              }}
              variant="link"
            >
              <X aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            </IconButton>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <main>
      <header className="flex items-center gap-2">
        <IconButton asChild label="Zakupy" variant="link">
          <Link to="/shopping?all=1">
            <ChevronLeft aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          </Link>
        </IconButton>
        <h1 className="text-xl font-semibold">Zawsze w domu</h1>
      </header>
      <Section first>
        <form className="flex items-end gap-2" onSubmit={add}>
          <TextField
            className="flex-1"
            error={error}
            label="Dodaj produkt"
            maxLength={80}
            onChange={setName}
            placeholder="np. kakao"
            value={name}
          />
          <Button loading={upsert.isPending} type="submit" variant="soft">
            Dodaj
          </Button>
        </form>
      </Section>
      <Section title="Produkty">
        {(staples.data ?? []).length > 8 ? (
          <TextField className="mb-3" label="Szukaj" onChange={setFilter} value={filter} />
        ) : null}
        {content}
      </Section>
    </main>
  );
}
