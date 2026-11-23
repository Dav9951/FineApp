import { SERVINGS_FACTOR_MAX_BPS, SERVINGS_FACTOR_MIN_BPS } from '@fineapp/shared';
import { Camera, X } from 'lucide-react';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button, IconButton, Sheet, TextField } from '../../../components/ui/index.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import { cn } from '../../../lib/cn.js';
import { prepareUpload } from '../../scan/resize-image.js';
import type { ImportImageFile } from '../api.js';
import { useCreateImport } from '../hooks/use-shopping.js';
import { factorLabel, parseFactorInput } from '../shopping-view.js';

/**
 * Arkusz „Dodaj z…" (06 §3.15, `F10-8`, `F10-9`): zdjęcie listy albo przepis — zrzuty
 * ekranu, link, wklejony tekst — z mnożnikiem porcji. Po wysłaniu przechodzi do przeglądu,
 * gdzie odczyt widać „na żywo".
 *
 * Zdjęcia są skalowane i zamieniane z HEIC w przeglądarce, jak paragony (08 §3).
 */

/** Gotowe mnożniki (17 §3.5). */
const FACTORS = [5_000, 7_500, 10_000, 15_000, 20_000] as const;

/** Najwięcej zrzutów przepisu. */
const MAX_IMAGES = 3;

/** Właściwości arkusza importu. */
export interface ShoppingImportSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly listId: string;
  /** Przepis z udostępnienia (`share_target`): link albo tekst. */
  readonly initial?: { readonly url?: string; readonly text?: string };
}

/**
 * Arkusz importu.
 *
 * @param props - Właściwości komponentu.
 * @returns Element arkusza.
 */
export function ShoppingImportSheet(props: ShoppingImportSheetProps): ReactNode {
  return (
    <Sheet onOpenChange={props.onOpenChange} open={props.open} title="Dodaj z…">
      {props.open ? <ImportForm {...props} /> : null}
    </Sheet>
  );
}

type Source = 'photo' | 'recipe';
type RecipeInput = 'images' | 'url' | 'text';

/**
 * Formularz importu — montowany od nowa przy każdym otwarciu.
 *
 * @param props - Właściwości komponentu.
 * @param props.listId - Lista docelowa.
 * @param props.initial - Link albo tekst z udostępnienia.
 * @returns Element formularza.
 */
export function ImportForm({
  listId,
  initial,
}: Pick<ShoppingImportSheetProps, 'listId' | 'initial'>): ReactNode {
  const navigate = useNavigate();
  const create = useCreateImport();
  const shared = initial?.url !== undefined || initial?.text !== undefined;
  const [source, setSource] = useState<Source>(shared ? 'recipe' : 'photo');
  const [recipeInput, setRecipeInput] = useState<RecipeInput>(
    initial?.url !== undefined ? 'url' : initial?.text !== undefined ? 'text' : 'images',
  );
  const [images, setImages] = useState<ImportImageFile[]>([]);
  const [url, setUrl] = useState(initial?.url ?? '');
  const [text, setText] = useState(initial?.text ?? '');
  // Odczyt schowka tylko tam, gdzie przeglądarka go daje (Firefox na Androidzie — nie).
  const canPaste = typeof navigator !== 'undefined' && navigator.clipboard?.readText !== undefined;

  /** Wkleja link ze schowka; odmowa dostępu zostawia pole bez zmian. */
  async function pasteLink(): Promise<void> {
    try {
      const pasted = (await navigator.clipboard.readText()).trim();
      if (pasted !== '') setUrl(pasted);
    } catch {
      // Brak zgody na schowek — można wkleić ręcznie.
    }
  }
  const [factor, setFactor] = useState<number>(10_000);
  const [customFactor, setCustomFactor] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [preparing, setPreparing] = useState(false);

  const addImages = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    setPreparing(true);
    try {
      const limit = source === 'photo' ? 1 : MAX_IMAGES;
      const prepared = await Promise.all(
        [...files].slice(0, limit).map(async (file) => {
          const upload = await prepareUpload(file);
          return { blob: upload.blob, filename: upload.filename };
        }),
      );
      setImages((current) =>
        source === 'photo' ? prepared : [...current, ...prepared].slice(0, limit),
      );
      setError(undefined);
    } catch {
      setError('Nie udało się wczytać zdjęcia. Spróbuj innego.');
    } finally {
      setPreparing(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const factorBps = customFactor.trim() === '' ? factor : parseFactorInput(customFactor);
    if (source === 'recipe' && factorBps === undefined) {
      setError('Mnożnik od 0,25 do 4');
      return;
    }
    const onError = (failure: Error): void => {
      setError(
        failure instanceof ApiRequestError
          ? (Object.values(failure.fieldErrors())[0] ?? failure.message)
          : failure.message,
      );
    };
    const onSuccess = (created: { id: string }): void => {
      void navigate(`/shopping/${listId}/import/${created.id}`);
    };
    if (source === 'photo' || recipeInput === 'images') {
      if (images.length === 0) {
        setError('Dodaj zdjęcie');
        return;
      }
      create.mutate(
        {
          source: 'images',
          input: {
            listId,
            kind: source === 'photo' ? 'list_photo' : 'recipe',
            ...(source === 'recipe' && factorBps !== undefined
              ? { servingsFactorBps: factorBps }
              : {}),
            images,
          },
        },
        { onError, onSuccess },
      );
      return;
    }
    const servingsFactorBps = factorBps ?? 10_000;
    if (recipeInput === 'url') {
      if (!/^https?:\/\//iu.test(url.trim())) {
        setError('Wklej adres strony z przepisem (https://…)');
        return;
      }
      create.mutate(
        {
          source: 'text',
          input: { input: 'url', kind: 'recipe', listId, url: url.trim(), servingsFactorBps },
        },
        { onError, onSuccess },
      );
      return;
    }
    if (text.trim().length < 20) {
      setError('Wklej cały przepis');
      return;
    }
    create.mutate(
      {
        source: 'text',
        input: { input: 'text', kind: 'recipe', listId, text: text.trim(), servingsFactorBps },
      },
      { onError, onSuccess },
    );
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Segmented<Source>
        label="Co odczytać"
        onChange={(value) => {
          setSource(value);
          setImages([]);
          setError(undefined);
        }}
        options={[
          { value: 'photo', label: 'Zdjęcie listy' },
          { value: 'recipe', label: 'Przepis' },
        ]}
        value={source}
      />
      {source === 'photo' ? (
        <>
          <p className="text-sm text-muted-foreground">
            Zrób zdjęcie tablicy albo kartki. Skreślone pozycje pominę, a resztę przejrzysz przed
            dodaniem.
          </p>
          <ImagePicker
            busy={preparing}
            capture
            images={images}
            max={1}
            onAdd={(files) => void addImages(files)}
            onRemove={(index) => {
              setImages((current) => current.filter((_, position) => position !== index));
            }}
          />
        </>
      ) : (
        <>
          <Segmented<RecipeInput>
            label="Skąd przepis"
            onChange={(value) => {
              setRecipeInput(value);
              setError(undefined);
            }}
            options={[
              { value: 'images', label: 'Zrzut' },
              { value: 'url', label: 'Link' },
              { value: 'text', label: 'Tekst' },
            ]}
            value={recipeInput}
          />
          {recipeInput === 'images' ? (
            <ImagePicker
              busy={preparing}
              images={images}
              max={MAX_IMAGES}
              onAdd={(files) => void addImages(files)}
              onRemove={(index) => {
                setImages((current) => current.filter((_, position) => position !== index));
              }}
            />
          ) : recipeInput === 'url' ? (
            <div className="flex flex-col gap-2">
              <TextField
                autoComplete="off"
                hint="Strona z przepisem — pobiorę listę składników."
                inputMode="url"
                label="Link do przepisu"
                onChange={setUrl}
                placeholder="https://…"
                value={url}
              />
              {canPaste ? (
                <Button
                  className="self-start"
                  onClick={() => {
                    void pasteLink();
                  }}
                  size="small"
                  variant="ghost"
                >
                  Wklej ze schowka
                </Button>
              ) : null}
            </div>
          ) : (
            <TextField
              label="Treść przepisu"
              maxLength={30_000}
              onChange={setText}
              placeholder="Wklej składniki albo cały przepis"
              rows={6}
              value={text}
            />
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm text-muted-foreground">Ile przepisu robisz?</legend>
            <div className="flex flex-wrap gap-2">
              {FACTORS.map((value) => (
                <button
                  aria-pressed={customFactor === '' && factor === value}
                  className={cn(
                    'min-h-touch rounded-full border px-4 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    customFactor === '' && factor === value
                      ? 'border-primary bg-muted text-primary'
                      : 'border-border bg-card',
                  )}
                  key={value}
                  onClick={() => {
                    setFactor(value);
                    setCustomFactor('');
                  }}
                  type="button"
                >
                  {factorLabel(value)}
                </button>
              ))}
            </div>
            <TextField
              hint={`Od ${factorLabel(SERVINGS_FACTOR_MIN_BPS)} do ${factorLabel(SERVINGS_FACTOR_MAX_BPS)}`}
              inputMode="decimal"
              label="Inny mnożnik"
              onChange={setCustomFactor}
              placeholder="np. 1,25"
              value={customFactor}
            />
          </fieldset>
        </>
      )}
      {error === undefined ? null : (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <Button disabled={preparing} loading={create.isPending} size="large" type="submit">
        {source === 'photo' ? 'Odczytaj listę' : 'Odczytaj przepis'}
      </Button>
    </form>
  );
}

/**
 * Wybór zdjęć z miniaturami i usuwaniem.
 *
 * @param props - Właściwości komponentu.
 * @param props.images - Wybrane zdjęcia.
 * @param props.max - Ile najwyżej.
 * @param props.capture - Od razu aparat (zdjęcie tablicy).
 * @param props.busy - Trwa przygotowywanie.
 * @param props.onAdd - Wybrano pliki.
 * @param props.onRemove - Usunięcie zdjęcia.
 * @returns Element wyboru.
 */
function ImagePicker({
  images,
  max,
  capture = false,
  busy,
  onAdd,
  onRemove,
}: {
  readonly images: readonly ImportImageFile[];
  readonly max: number;
  readonly capture?: boolean;
  readonly busy: boolean;
  readonly onAdd: (files: FileList | null) => void;
  readonly onRemove: (index: number) => void;
}): ReactNode {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <li
              className="flex items-center gap-1 rounded-sm border border-border bg-card pl-3 text-sm"
              key={`${image.filename}-${String(index)}`}
            >
              <span className="max-w-[10rem] truncate">{image.filename}</span>
              <IconButton
                label={`Usuń zdjęcie ${String(index + 1)}`}
                onClick={() => {
                  onRemove(index);
                }}
                variant="link"
              >
                <X aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      {images.length < max ? (
        <>
          <label className="sr-only" htmlFor={inputId}>
            {capture ? 'Zrób zdjęcie listy' : 'Dodaj zrzut ekranu przepisu'}
          </label>
          <input
            accept="image/*"
            className="sr-only"
            id={inputId}
            multiple={max > 1}
            onChange={(event) => {
              onAdd(event.target.files);
              event.target.value = '';
            }}
            ref={input}
            type="file"
            {...(capture ? { capture: 'environment' as const } : {})}
          />
          <Button
            loading={busy}
            onClick={() => {
              input.current?.click();
            }}
            type="button"
            variant="soft"
          >
            <Camera aria-hidden="true" className="mr-2 h-5 w-5" strokeWidth={1.5} />
            {capture
              ? 'Zrób zdjęcie'
              : images.length === 0
                ? 'Dodaj zrzut ekranu'
                : 'Dodaj kolejny zrzut'}
          </Button>
        </>
      ) : null}
    </div>
  );
}

/**
 * Przełącznik segmentowy (jeden z kilku) — przyciski z `aria-pressed` w grupie.
 *
 * @param props - Właściwości komponentu.
 * @param props.label - Opis grupy dla czytnika.
 * @param props.options - Opcje.
 * @param props.value - Wybrana.
 * @param props.onChange - Wybór.
 * @returns Element grupy.
 */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly { value: T; label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}): ReactNode {
  return (
    <div
      aria-label={label}
      className="flex rounded-sm border border-border bg-card p-1"
      role="group"
    >
      {options.map((option) => (
        <button
          aria-pressed={option.value === value}
          className={cn(
            'min-h-touch flex-1 rounded-sm px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            option.value === value
              ? 'bg-muted font-semibold text-primary'
              : 'text-muted-foreground',
          )}
          key={option.value}
          onClick={() => {
            onChange(option.value);
          }}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
