import {
  currentMonthKey,
  exportFileName,
  todayInTimezone,
  toBps,
  type AiUsageDto,
  type HouseholdMemberDto,
  type SettingsDto,
} from '@fineapp/shared';
import {
  CalendarClock,
  Coins,
  CreditCard,
  Download,
  FileJson,
  FileSpreadsheet,
  Globe,
  Home,
  KeyRound,
  LogOut,
  Monitor,
  MonitorDown,
  Moon,
  Smartphone,
  Sun,
  Tags,
  Trash2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Badge,
  Button,
  ErrorState,
  ListRow,
  Money,
  OptionGrid,
  Section,
  SkeletonList,
  useToast,
} from '../../../components/ui/index.js';
import { errorDetails } from '../../../lib/api-client.js';
import { useInstallOption } from '../../../lib/pwa.js';
import { formatMonth } from '../../../lib/format.js';
import { useTheme, type ThemePreference } from '../../../lib/theme.js';
import { percentLabel } from '../../months/month-view.js';
import { useAuth } from '../../auth/auth-context.js';
import { requireToken, useAccessToken } from '../../auth/use-token.js';
import { lastUpdatedLabel } from '../../accounts/components/accounts-screen.js';
import { useAccountList } from '../../accounts/hooks/use-accounts.js';
import { useAiUsage } from '../../scan/hooks/use-documents.js';
import { initials } from '../../transactions/history-view.js';
import { fetchExportCsv, fetchExportJson } from '../api.js';
import { useSettings } from '../hooks/use-settings.js';
import { backPostingLabel, postingFromLabel, saveBlob } from '../settings-view.js';
import { ExpenseAccountSheet } from './expense-account-sheet.js';
import { HouseholdSheet } from './household-sheet.js';
import { PinSheet } from './pin-sheet.js';
import { ProfileSheet } from './profile-sheet.js';
import { ResetDataSheet } from './reset-data-sheet.js';
import { SessionsSheet } from './sessions-sheet.js';

/**
 * Ekran ustawień — `/settings`
 * ([06 §3.12](../../../../../../plans/06-ui-views.md#312-ustawienia--settings)).
 *
 * Sekcje: Gospodarstwo, Domownicy, Porządek (kategorie, źródła przychodu), Dane
 * (eksport i informacja o kopiach), AI, O aplikacji. Cztery stany dotyczą danych
 * gospodarstwa; sekcja AI ma własne, bo zużycie przychodzi osobnym zapytaniem
 * i jego awaria nie powinna zasłaniać reszty ustawień.
 */

/** Rodzaj pobieranego pliku. */
type DownloadKind = 'json' | 'csv-month' | 'csv-all';

/**
 * Ikona wiersza ustawień.
 *
 * @param props - Właściwości komponentu.
 * @param props.icon - Ikona z `lucide-react`.
 * @returns Element ikony.
 */
function RowIcon({ icon: Icon }: { icon: LucideIcon }): ReactNode {
  return <Icon aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={1.5} />;
}

/** Opcje motywu — ikony jak przełącznik w pasku bocznym. */
const THEME_OPTIONS = [
  { value: 'dark', label: 'Ciemny', icon: <RowIcon icon={Moon} /> },
  { value: 'light', label: 'Jasny', icon: <RowIcon icon={Sun} /> },
  { value: 'system', label: 'Systemowy', icon: <RowIcon icon={Monitor} /> },
] as const satisfies readonly { value: ThemePreference; label: string; icon: ReactNode }[];

/**
 * Sekcja „Wygląd" — wybór motywu (ADR-067). Nie zależy od danych gospodarstwa, bo motyw
 * jest ustawieniem urządzenia; stoi więc także w stanie ładowania i błędu.
 *
 * @returns Element sekcji.
 */
function AppearanceSection(): ReactNode {
  const { preference, setPreference } = useTheme();
  return (
    <Section title="Wygląd">
      <OptionGrid
        legend="Motyw"
        onChange={setPreference}
        options={THEME_OPTIONS}
        value={preference}
      />
      <p className="mt-2 text-caption text-muted-foreground">
        Zapamiętywany na tym urządzeniu. „Systemowy" podąża za ustawieniem telefonu lub komputera.
      </p>
    </Section>
  );
}

/**
 * Szkielet ekranu — ten sam układ co treść.
 *
 * @returns Element szkieletu.
 */
function SettingsSkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Wczytywanie ustawień">
      <Section first title="Gospodarstwo">
        <SkeletonList rows={4} />
      </Section>
      <Section title="Domownicy">
        <SkeletonList rows={2} />
      </Section>
    </div>
  );
}

/**
 * Sekcja zużycia AI (08 §9) — z własnymi stanami.
 *
 * @param props - Właściwości komponentu.
 * @param props.month - Bieżący miesiąc gospodarstwa (podpis).
 * @returns Element sekcji.
 */
function AiSection({ month }: { month: string }): ReactNode {
  const usage = useAiUsage();

  let content: ReactNode;
  if (usage.isPending) {
    content = <SkeletonList rows={2} />;
  } else if (usage.isError) {
    content = (
      <ErrorState
        details={errorDetails(usage.error)}
        onRetry={() => {
          void usage.refetch();
        }}
        retrying={usage.isFetching}
        title="Nie udało się wczytać zużycia"
      />
    );
  } else if (!usage.data.enabled) {
    content = (
      <p className="text-sm text-muted-foreground">
        Odczyt paragonów jest wyłączony na serwerze (<code>AI_ENABLED=false</code>). Zakładka „Skan”
        jest ukryta.
      </p>
    );
  } else {
    content = <AiUsageRows month={month} usage={usage.data} />;
  }

  return <Section title="Odczyt dokumentów (AI)">{content}</Section>;
}

/**
 * Wiersze zużycia AI.
 *
 * @param props - Właściwości komponentu.
 * @param props.usage - Zużycie.
 * @param props.month - Bieżący miesiąc (podpis).
 * @returns Element listy.
 */
function AiUsageRows({ usage, month }: { usage: AiUsageDto; month: string }): ReactNode {
  const limited = usage.budgetMinor > 0;
  // Przy zerowym limicie procent nie ma sensu — `toBps` i tak odda 0, ale napis „0%”
  // sugerowałby, że limit jest i nic nie zużyto.
  const spentBps = limited ? toBps(usage.spentMinor, usage.budgetMinor) : 0;
  return (
    <>
      <ul>
        <li>
          <ListRow
            amount={<Money amountMinor={usage.spentMinor} size="sm" />}
            caption={
              limited ? (
                <span>
                  z limitu <Money amountMinor={usage.budgetMinor} size="meta" /> ·{' '}
                  {percentLabel(spentBps)}
                </span>
              ) : (
                'bez limitu miesięcznego'
              )
            }
            first
            icon={<RowIcon icon={Coins} />}
            name={`Koszt — ${month}`}
          />
        </li>
        <li>
          <ListRow
            amount={<span className="text-sm tabular-nums">{usage.documentCount}</span>}
            caption={`model ${usage.model}`}
            icon={<RowIcon icon={FileJson} />}
            name="Przeanalizowane dokumenty"
          />
        </li>
      </ul>
      {limited && usage.remainingMinor === 0 ? (
        <p className="mt-2 text-caption text-warning" role="status">
          Limit na ten miesiąc wyczerpany — nowe dokumenty zostaną zapisane, ale bez odczytu.
        </p>
      ) : null}
    </>
  );
}

/**
 * Instalacja na ekranie głównym (`F8-3`): przycisk tam, gdzie przeglądarka go daje
 * (Chrome, Edge, Android), instrukcja na iPhonie, nic w oknie już zainstalowanej aplikacji.
 *
 * @returns Element albo nic.
 */
function InstallRow(): ReactNode {
  const option = useInstallOption();
  if (option.kind === 'installed' || option.kind === 'unavailable') return null;
  if (option.kind === 'ios') {
    return (
      <p className="mt-3 text-caption text-muted-foreground">
        Na iPhonie: w Safari dotknij „Udostępnij”, potem „Do ekranu początkowego” — aplikacja
        otworzy się bez paska przeglądarki.
      </p>
    );
  }
  return (
    <Button
      className="mt-4"
      onClick={() => {
        void option.install();
      }}
      size="large"
      variant="soft"
    >
      <MonitorDown aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
      Zainstaluj aplikację
    </Button>
  );
}

/**
 * Wiersz domownika.
 *
 * @param props - Właściwości komponentu.
 * @param props.member - Domownik.
 * @param props.first - Czy pierwszy w grupie.
 * @param props.onEdit - Edycja własnego profilu.
 * @returns Element wiersza.
 */
function MemberRow({
  member,
  first,
  onEdit,
}: {
  member: HouseholdMemberDto;
  first: boolean;
  onEdit: () => void;
}): ReactNode {
  return (
    <ListRow
      amount={member.isCurrent ? <Badge tone="neutral">Ty</Badge> : undefined}
      caption={member.email}
      first={first}
      icon={
        <span aria-hidden="true" className="text-caption font-semibold">
          {initials(member.displayName)}
        </span>
      }
      name={member.displayName}
      {...(member.isCurrent ? { onClick: onEdit } : {})}
    />
  );
}

/**
 * Treść ustawień po wczytaniu.
 *
 * @param props - Właściwości komponentu.
 * @param props.settings - Ustawienia.
 * @returns Element treści.
 */
function SettingsContent({ settings }: { settings: SettingsDto }): ReactNode {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const token = useAccessToken();
  const { household } = settings;
  const today = todayInTimezone(household.timezone);
  const month = currentMonthKey(household.timezone);
  const monthLabel = formatMonth(month);

  const [sheet, setSheet] = useState<
    'household' | 'expenseAccount' | 'profile' | 'pin' | 'sessions' | 'reset' | null
  >(null);
  const accounts = useAccountList(false);
  const expenseAccount =
    household.defaultExpenseAccountId === null
      ? undefined
      : accounts.data?.find((account) => account.id === household.defaultExpenseAccountId);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const toast = useToast();
  const [downloading, setDownloading] = useState<DownloadKind | null>(null);
  const [downloadError, setDownloadError] = useState<string | undefined>(undefined);

  const openSheet =
    (name: typeof sheet) =>
    (open: boolean): void => {
      setSheet(open ? name : null);
    };

  /**
   * Pobiera plik eksportu i zapisuje go na dysku.
   *
   * @param kind - Rodzaj pliku.
   */
  const download = async (kind: DownloadKind): Promise<void> => {
    setDownloading(kind);
    setDownloadError(undefined);
    try {
      const accessToken = requireToken(token);
      if (kind === 'json') {
        saveBlob(await fetchExportJson(accessToken), exportFileName('json', today));
      } else {
        const scope = kind === 'csv-month' ? month : undefined;
        saveBlob(await fetchExportCsv(accessToken, scope), exportFileName('csv', scope ?? today));
      }
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Nie udało się pobrać pliku.');
    } finally {
      setDownloading(null);
    }
  };

  const downloadRow = (
    kind: DownloadKind,
    icon: LucideIcon,
    name: string,
    caption: string,
    first = false,
  ): ReactNode => (
    <li>
      <ListRow
        amount={
          downloading === kind ? (
            <span className="text-caption text-muted-foreground" role="status">
              Pobieram…
            </span>
          ) : (
            <Download aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
          )
        }
        caption={caption}
        first={first}
        icon={<RowIcon icon={icon} />}
        name={name}
        onClick={() => {
          if (downloading === null) void download(kind);
        }}
      />
    </li>
  );

  return (
    <>
      {notice === undefined ? null : (
        <p className="mt-4 rounded-md border border-border bg-card p-3 text-sm" role="status">
          {notice}
        </p>
      )}

      <Section
        action={
          <Button
            onClick={() => {
              setSheet('household');
            }}
            size="small"
            variant="link"
          >
            Zmień
          </Button>
        }
        first
        title="Gospodarstwo"
      >
        <ul>
          <li>
            <ListRow
              caption="Nazwa"
              first
              icon={<RowIcon icon={Home} />}
              name={household.name}
              onClick={() => {
                setSheet('household');
              }}
            />
          </li>
          <li>
            <ListRow
              caption="Strefa czasowa"
              icon={<RowIcon icon={Globe} />}
              name={household.timezone}
              onClick={() => {
                setSheet('household');
              }}
            />
          </li>
          <li>
            <ListRow
              caption={`Księgowanie ${postingFromLabel(today, household.backPostingLimitMonths)}`}
              icon={<RowIcon icon={CalendarClock} />}
              name={`Wstecz: ${backPostingLabel(household.backPostingLimitMonths)}`}
              onClick={() => {
                setSheet('household');
              }}
            />
          </li>
          <li>
            <ListRow
              caption="Konto do wydatków"
              icon={<RowIcon icon={CreditCard} />}
              name={
                household.defaultExpenseAccountId === null
                  ? 'Nie wybrano'
                  : (expenseAccount?.name ?? '…')
              }
              onClick={() => {
                setSheet('expenseAccount');
              }}
            />
          </li>
          <li>
            <ListRow
              caption="Miesiąc od 1. dnia · stałe w tej wersji"
              icon={<RowIcon icon={Wallet} />}
              name={`Waluta: ${household.baseCurrency}`}
            />
          </li>
        </ul>
      </Section>

      <Section title="Domownicy">
        <ul>
          {settings.users.map((member, index) => (
            <li key={member.id}>
              <MemberRow
                first={index === 0}
                member={member}
                onEdit={() => {
                  setSheet('profile');
                }}
              />
            </li>
          ))}
          <li>
            <ListRow
              caption="Pozostałe urządzenia zostaną wylogowane"
              icon={<RowIcon icon={KeyRound} />}
              name="Zmień PIN"
              onClick={() => {
                setSheet('pin');
              }}
            />
          </li>
          <li>
            <ListRow
              caption="Gdzie jesteś zalogowany"
              icon={<RowIcon icon={Smartphone} />}
              name="Urządzenia"
              onClick={() => {
                setSheet('sessions');
              }}
            />
          </li>
        </ul>
      </Section>

      <Section title="Porządek">
        <ul>
          <li>
            <ListRow
              caption="Drzewo kategorii i podpowiedzi dla AI"
              first
              icon={<RowIcon icon={Tags} />}
              name="Kategorie"
              onClick={() => {
                void navigate('/settings/categories');
              }}
            />
          </li>
          <li>
            <ListRow
              caption="Pensje, zlecenia i inne wpływy"
              icon={<RowIcon icon={Coins} />}
              name="Źródła przychodu"
              onClick={() => {
                void navigate('/settings/income-sources');
              }}
            />
          </li>
        </ul>
      </Section>

      <Section title="Dane">
        <ul>
          {downloadRow(
            'json',
            FileJson,
            'Kopia wszystkich danych',
            'JSON — konta, transakcje, cele, reguły',
            true,
          )}
          {downloadRow('csv-month', FileSpreadsheet, `Transakcje: ${monthLabel}`, 'CSV do arkusza')}
          {downloadRow('csv-all', FileSpreadsheet, 'Wszystkie transakcje', 'CSV do arkusza')}
        </ul>
        {downloadError === undefined ? null : (
          <p className="mt-2 text-sm text-danger" role="alert">
            {downloadError}
          </p>
        )}
        <p className="mt-3 text-caption text-muted-foreground">
          Serwer co noc robi kopię bazy i trzyma czternaście ostatnich. Plik JSON to Twoja własna
          kopia: zawiera pełny obraz finansów domu — przechowuj go jak dokumenty z banku. Zdjęć
          paragonów w nim nie ma.
        </p>
        <Button
          className="mt-4 text-danger"
          onClick={() => {
            setSheet('reset');
          }}
          size="large"
          variant="ghost"
        >
          <Trash2 aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          Usuń wszystkie dane
        </Button>
      </Section>

      <AiSection month={monthLabel} />

      <Section title="O aplikacji">
        <p className="text-sm">
          FineApp <span className="tabular-nums text-muted-foreground">{settings.appVersion}</span>
        </p>
        <InstallRow />
        <Button
          className="mt-4"
          onClick={() => {
            void signOut();
          }}
          size="large"
          variant="ghost"
        >
          <LogOut aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          Wyloguj
        </Button>
      </Section>

      <HouseholdSheet
        household={household}
        onOpenChange={openSheet('household')}
        open={sheet === 'household'}
      />
      <ExpenseAccountSheet
        household={household}
        onOpenChange={openSheet('expenseAccount')}
        open={sheet === 'expenseAccount'}
      />
      {user === null ? null : (
        <ProfileSheet onOpenChange={openSheet('profile')} open={sheet === 'profile'} user={user} />
      )}
      <PinSheet onChanged={setNotice} onOpenChange={openSheet('pin')} open={sheet === 'pin'} />
      <SessionsSheet onOpenChange={openSheet('sessions')} open={sheet === 'sessions'} />
      <ResetDataSheet
        // Toast, nie `notice`: przycisk stoi na dole ekranu, a zamknięty arkusz oddaje
        // fokus przyciskowi — potwierdzenie na górze ekranu byłoby poza widokiem.
        onDone={(message) => {
          toast.show({ message });
        }}
        onOpenChange={openSheet('reset')}
        open={sheet === 'reset'}
      />
    </>
  );
}

/**
 * Ekran ustawień.
 *
 * @returns Element ekranu.
 */
export default function SettingsScreen(): ReactNode {
  const settings = useSettings();

  let content: ReactNode;
  if (settings.isPending) {
    content = <SettingsSkeleton />;
  } else if (settings.isError) {
    content = (
      <ErrorState
        details={errorDetails(settings.error)}
        lastUpdatedAt={lastUpdatedLabel(settings.dataUpdatedAt)}
        onRetry={() => {
          void settings.refetch();
        }}
        retrying={settings.isFetching}
        title="Nie udało się wczytać ustawień"
      />
    );
  } else {
    content = <SettingsContent settings={settings.data} />;
  }

  return (
    <main>
      <h1 className="text-xl font-semibold">Ustawienia</h1>
      {content}
      <AppearanceSection />
    </main>
  );
}
