import {
  ArrowLeftRight,
  Camera,
  Minus,
  Plus,
  Receipt,
  ShoppingCart,
  Target,
  Wallet,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import {
  AmountInput,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Fab,
  Field,
  IconButton,
  ListRow,
  Money,
  MonthSwitcher,
  ProgressBar,
  ProgressRing,
  Section,
  Sheet,
  SkeletonList,
  Switch,
  Tabs,
  TextField,
  ToastProvider,
  useToast,
} from '../../components/ui/index.js';

/**
 * Przegląd prymitywów ([15 §4](../../../../../plans/15-design-system.md#4-prymitywy)).
 *
 * Trasa `/dev/ui` istnieje po to, żeby regułę „sprawdź, co już istnieje" z `CLAUDE.md`
 * dało się wykonać w przeglądarce, a nie przez czytanie katalogu. Pokazuje **stany
 * skrajne**, nie ładne przykłady: kwotę siedmiocyfrową, wykonanie ujemne, najdłuższą
 * nazwę kategorii z zestawu domyślnego, błąd walidacji.
 *
 * Strona jest narzędziem deweloperskim — nie ma jej w nawigacji i nie wchodzi
 * do paczki produkcyjnej inaczej niż jako osobny fragment `lazy`.
 */

/**
 * Nagłówek grupy w przeglądzie.
 *
 * @param props - Właściwości komponentu.
 * @param props.id - Kotwica, żeby dało się podlinkować pojedynczy prymityw.
 * @param props.title - Nazwa grupy wraz z numerem sekcji z `15 §4`.
 * @param props.children - Przykłady użycia.
 * @returns Element grupy.
 */
function Group({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="mt-6 border-t border-border pt-6" id={id}>
      <h2 className="mb-3 text-caption font-medium uppercase tracking-[.1em] text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Najdłuższa nazwa kategorii z zestawu domyślnego — sprawdza budżet 313 px (15 §4.8). */
const LONGEST_CATEGORY = 'Oprogramowanie i narzędzia';

/**
 * Przyciski pokazujące toast — muszą być wewnątrz `ToastProvider`.
 *
 * @returns Element przykładu.
 */
function ToastDemo(): ReactNode {
  const { show } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() => {
          show({ message: 'Zapisano' });
        }}
        variant="ghost"
      >
        Toast
      </Button>
      <Button
        onClick={() => {
          show({
            message: 'Przeniesiono do kosza',
            action: {
              label: 'Cofnij',
              onAction: () => {
                show({ message: 'Przywrócono' });
              },
            },
          });
        }}
        variant="ghost"
      >
        Toast z „Cofnij"
      </Button>
    </div>
  );
}

/**
 * Strona przeglądu prymitywów.
 *
 * @returns Element strony.
 */
export default function UiGallery(): ReactNode {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [tab, setTab] = useState('wydatek');
  const [checked, setChecked] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [amountMinor, setAmountMinor] = useState(0);
  const [lastAction, setLastAction] = useState('—');
  const [text, setText] = useState('Oprogramowanie i narzędzia');

  const toggleTheme = (next: boolean): void => {
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
  };

  // Toast jest stanem powłoki aplikacji, a galeria stoi poza powłoką — dostaje własny
  // provider. `ToastDemo` renderuje się wewnątrz niego, więc widzi kontekst.
  const gallery = (
    <div className="mx-auto max-w-[390px] px-4 pb-40 pt-6">
      <header className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Prymitywy</h1>
        <span className="text-caption text-muted-foreground">15 §4</span>
      </header>
      <p className="mt-1 text-sm text-muted-foreground">
        Szerokość ramki to docelowe 390&nbsp;px. Oba motywy są pierwszoklasowe — przełącz i sprawdź
        kontrast.
      </p>

      <div className="mt-4 flex min-h-touch items-center justify-between gap-3">
        <span className="text-sm">Motyw ciemny</span>
        <Switch checked={dark} label="Motyw ciemny" onCheckedChange={toggleTheme} />
      </div>

      <Group id="money" title="Money — 4.1">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Money amountMinor={185_000} variant="income" />
          <Money amountMinor={185_000} variant="expense" />
          <Money amountMinor={0} variant="income" />
          <Money amountMinor={-12_799} variant="neutral" />
          <Money amountMinor={121_572_790} variant="neutral" />
          <Money amountMinor={-121_572_790} variant="debt" />
        </div>
        <div className="flex items-baseline gap-2">
          <Money amountMinor={200_000} unit={false} variant="compact" />
          <span className="text-muted-foreground">/</span>
          <Money amountMinor={236_000} variant="compact" />
        </div>
        <div className="flex items-baseline gap-3">
          <Money amountMinor={-185_000} size="hero" variant="expense" />
          <Money amountMinor={185_000} size="meta" variant="income" />
        </div>
      </Group>

      <Group id="buttons" title="Button, IconButton — 4.3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Zapisz</Button>
          <Button variant="soft">Uzupełnij</Button>
          <Button variant="ghost">Pomiń</Button>
          <Button variant="danger">Usuń</Button>
          <Button variant="link">Zobacz wszystkie</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button loading variant="primary">
            Księguję
          </Button>
          <Button disabled variant="primary">
            Niedostępne
          </Button>
          <Button size="small" variant="ghost">
            Edytuj
          </Button>
          <IconButton label="Dodaj">
            <Plus aria-hidden="true" className="h-5 w-5" />
          </IconButton>
        </div>
        <Button size="large" variant="primary">
          Akcja w arkuszu
        </Button>
      </Group>

      <Group id="sections" title="Section, Card, Badge, Field — 4.5 i 4.10">
        <Section action={<Button variant="link">Wszystkie</Button>} first title="Podsumowanie">
          <div className="flex items-center justify-between">
            <span className="text-sm">Zostało do końca miesiąca</span>
            <Money amountMinor={124_350} variant="neutral" />
          </div>
        </Section>
        <Section title="Do zatwierdzenia">
          <div className="flex items-center gap-2">
            <Badge>3</Badge>
            <Badge tone="success">gotowe</Badge>
            <Badge tone="danger">błąd</Badge>
            <Badge tone="neutral">robocze</Badge>
          </div>
        </Section>
        <Card>
          <div className="divide-y divide-border">
            <Field label="Konto" onOpen={() => setLastAction('Field: Konto')} value="Wspólne" />
            <Field hint="Używana przy nowych transakcjach" label="Waluta" value="PLN" />
          </div>
        </Card>
        <Checkbox checked={checked} onCheckedChange={setChecked}>
          Uwzględnij transakcje planowane
        </Checkbox>
      </Group>

      <Group id="text-field" title="TextField — 4.10">
        <TextField hint="Widoczna na liście kont" label="Nazwa" onChange={setText} value={text} />
        <TextField
          error="Nazwa jest wymagana"
          label="Nazwa (błąd walidacji)"
          onChange={() => undefined}
          value=""
        />
      </Group>

      <Group id="tabs" title="Tabs — 4.10">
        <Tabs
          items={[
            { value: 'wydatek', label: 'Wydatek', content: <p className="text-sm">Wydatek</p> },
            { value: 'przychod', label: 'Przychód', content: <p className="text-sm">Przychód</p> },
            { value: 'przelew', label: 'Przelew', content: <p className="text-sm">Przelew</p> },
          ]}
          onValueChange={setTab}
          value={tab}
        />
      </Group>

      <Group id="rows" title="ListRow — 4.8">
        <div>
          <ListRow
            amount={<Money amountMinor={8990} variant="expense" />}
            caption="22 września · Wspólne · Ala"
            first
            icon={<ShoppingCart aria-hidden="true" className="h-[17px] w-[17px]" />}
            name="Biedronka"
            onClick={() => setLastAction('ListRow: Biedronka')}
          />
          <ListRow
            amount={<Money amountMinor={1_215_727_90} variant="neutral" />}
            caption="Kwota siedmiocyfrowa — nazwa oddaje miejsce, nie kwota"
            icon={<Wallet aria-hidden="true" className="h-[17px] w-[17px]" />}
            name={LONGEST_CATEGORY}
            wrapName
          />
          <ListRow
            amount={<Money amountMinor={450_000} variant="income" />}
            caption="1 września · Wynagrodzenie"
            icon={<Receipt aria-hidden="true" className="h-[17px] w-[17px]" />}
            name="Wypłata"
          />
        </div>
      </Group>

      <Group id="progress" title="ProgressRing, ProgressBar — 4.7">
        <div className="flex items-start justify-around">
          <ProgressRing
            caption={<Money amountMinor={720_000} unit={false} variant="compact" />}
            pool="savings"
            valueBps={7200}
          />
          <ProgressRing achieved caption="cel osiągnięty" pool="investment" valueBps={11_400} />
          <ProgressRing
            caption={<Money amountMinor={-48_000} variant="compact" />}
            pool="debt"
            valueBps={-1800}
          />
        </div>
        <ProgressBar pool="savings" targetRatio={0.75} valueBps={5400} />
        <ProgressBar
          note="Poniżej tempa — do końca miesiąca zostało 8 dni"
          pool="investment"
          targetRatio={0.6}
          valueBps={3200}
        />
        <ProgressBar pool="debt" valueBps={10_000} />
      </Group>

      <Group id="states" title="Skeleton, EmptyState, ErrorState — 4.9">
        <SkeletonList rows={3} />
        <EmptyState
          action={
            <Button onClick={() => setLastAction('EmptyState: pierwsza akcja')} size="small">
              Dodaj
            </Button>
          }
          description="Zacznij od konta — reszta ekranów potrzebuje go, żeby cokolwiek pokazać."
          icon={<Target aria-hidden="true" className="h-7 w-7" />}
          steps={[
            { label: 'Dodaj konto', done: true },
            { label: 'Ustal budżet miesiąca' },
            { label: 'Zapisz pierwszą transakcję' },
            { label: 'Wyznacz cel' },
          ]}
          title="Zacznijmy od początku"
        />
        <ErrorState
          details={'ApiRequestError: 503 Service Unavailable\nx-request-id: 01J9Z…'}
          lastUpdatedAt="14:07"
          onRetry={() => setLastAction('ErrorState: ponowienie')}
          title="Nie udało się wczytać miesiąca"
        />
      </Group>

      <Group id="sheet" title="Sheet, AmountInput — 4.6 i 4.2">
        <Button onClick={() => setSheetOpen(true)} variant="soft">
          Otwórz arkusz z kwotą
        </Button>
        <p className="text-caption text-muted-foreground">
          Wpisana kwota: <Money amountMinor={amountMinor} size="meta" variant="neutral" />
        </p>
        <Sheet
          action={
            <Button
              disabled={amountMinor === 0}
              onClick={() => setSheetOpen(false)}
              size="small"
              variant="link"
            >
              Zapisz
            </Button>
          }
          onOpenChange={setSheetOpen}
          open={sheetOpen}
          title="Nowy wydatek"
        >
          <AmountInput
            error={amountMinor === 0 ? 'Podaj kwotę większą od zera' : undefined}
            onChange={setAmountMinor}
          />
        </Sheet>
      </Group>

      <Group id="month-toast" title="MonthSwitcher, Toast — 4.10">
        <MonthSwitcher as="h2" hrefFor={(month) => `/dev/ui?m=${month}`} month="2026-09" />
        <div className="mt-3">
          <ToastDemo />
        </div>
      </Group>

      <Group id="fab" title="FAB — 4.4">
        <p className="text-sm text-muted-foreground">
          FAB stoi w prawym dolnym rogu, nad paskiem zakładek. Przytrzymaj, żeby otworzyć menu
          szybkich akcji.
        </p>
        <p className="text-caption text-muted-foreground">Ostatnia akcja: {lastAction}</p>
      </Group>

      {/* Pasek zakładek jest tu atrapą — dowodzi, że FAB go nie zasłania (15 §4.4). */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex h-tabbar items-center justify-around border-t border-border bg-card pb-safe-bottom text-caption text-muted-foreground">
        <span>Miesiąc</span>
        <span>Historia</span>
        <span>Cele</span>
        <span>Skan</span>
        <span>Więcej</span>
      </div>

      <Fab
        actions={[
          {
            label: 'Wydatek',
            onSelect: () => setLastAction('FAB: Wydatek'),
            icon: <Minus aria-hidden="true" className="h-4 w-4" />,
          },
          {
            label: 'Przychód',
            onSelect: () => setLastAction('FAB: Przychód'),
            icon: <Plus aria-hidden="true" className="h-4 w-4" />,
          },
          {
            label: 'Przelew',
            onSelect: () => setLastAction('FAB: Przelew'),
            icon: <ArrowLeftRight aria-hidden="true" className="h-4 w-4" />,
          },
          {
            label: 'Paragon',
            onSelect: () => setLastAction('FAB: Paragon'),
            icon: <Camera aria-hidden="true" className="h-4 w-4" />,
          },
        ]}
        label="Dodaj transakcję"
        onClick={() => setLastAction('FAB: dotknięcie')}
      >
        <Plus aria-hidden="true" className="h-[26px] w-[26px]" />
      </Fab>
    </div>
  );

  return <ToastProvider>{gallery}</ToastProvider>;
}
