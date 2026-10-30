import type { AccountDto, CategoryTreeDto, DocumentDto } from '@fineapp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHEMIA_ID,
  DOCUMENT_ID,
  documentFixture,
  GROCERIES_ID,
  itemFixture,
  listItemFixture,
  ROR_ID,
} from '../../../../test/document-fixture.js';
import { renderScreen, TEST_SESSION } from '../../../../test/render-screen.js';
import { AppShell } from '../../../components/layout/app-shell.js';
import { ApiRequestError } from '../../../lib/api-client.js';
import * as accountsApi from '../../accounts/api.js';
import * as categoriesApi from '../../categories/api.js';
import * as documentsApi from '../api.js';
import DocumentScreen from './document-screen.js';
import ScanScreen from './scan-screen.js';

/**
 * Ekrany skanu: wybór źródła, analiza, przegląd, zatwierdzenie
 * ([06 §3.4](../../../../../../plans/06-ui-views.md#34-skanowanie--scan), `F7-8`…`F7-10`).
 */

const ROUTES = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'scan', element: <ScanScreen /> },
      { path: 'scan/:documentId', element: <DocumentScreen /> },
      { path: 'm/:month', element: <p>Ekran miesiąca</p> },
    ],
  },
];

/** Konto ROR. */
const ROR = {
  id: ROR_ID,
  name: 'ROR mBank',
  type: 'checking',
  allocationClass: 'spending',
  currency: 'PLN',
  openingBalanceMinor: 0,
  openingBalanceOn: '2026-01-01',
  includeInNetWorth: true,
  isArchived: false,
  sortOrder: 0,
  color: null,
  icon: null,
  institution: null,
  notes: null,
  createdAt: 1,
  updatedAt: 1,
} as AccountDto;

/** Drzewo kategorii wydatków. */
const EXPENSE_TREE = [
  {
    id: '01JC0000000000000000000009',
    parentId: null,
    name: 'Jedzenie',
    slug: 'jedzenie',
    kind: 'expense',
    icon: null,
    color: null,
    aiHints: null,
    isSystem: true,
    isArchived: false,
    sortOrder: 0,
    children: [
      {
        id: GROCERIES_ID,
        parentId: '01JC0000000000000000000009',
        name: 'Zakupy spożywcze',
        slug: 'zakupy',
        kind: 'expense',
        icon: null,
        color: null,
        aiHints: null,
        isSystem: true,
        isArchived: false,
        sortOrder: 0,
      },
    ],
  },
  {
    id: CHEMIA_ID,
    parentId: null,
    name: 'Chemia',
    slug: 'chemia',
    kind: 'expense',
    icon: null,
    color: null,
    aiHints: null,
    isSystem: true,
    isArchived: false,
    sortOrder: 1,
    children: [],
  },
] as CategoryTreeDto[];

/**
 * Atrapy wspólne: zużycie OCR, konta, kategorie, pliki.
 *
 * @param enabled - Czy OCR jest włączony.
 */
function mockCommon(enabled = true): void {
  vi.spyOn(documentsApi, 'fetchAiUsage').mockResolvedValue({
    enabled,
    model: 'claude-sonnet-5',
    monthKey: '2026-09',
    documentCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    spentMinor: 0,
    budgetMinor: 5000,
    remainingMinor: 5000,
  });
  vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([ROR]);
  vi.spyOn(categoriesApi, 'fetchCategoryTree').mockImplementation((_token, kind) =>
    Promise.resolve(kind === 'expense' ? EXPENSE_TREE : []),
  );
  vi.spyOn(documentsApi, 'fetchDocumentFile').mockResolvedValue(new Blob(['x']));
}

/**
 * Tekst ze spacjami zwykłymi — kwoty mają spację niełamliwą.
 *
 * @param element - Element.
 * @returns Tekst.
 */
function textOf(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s/gu, ' ');
}

/**
 * Renderuje przegląd dokumentu.
 *
 * @param document - Dokument z API.
 * @param options - Konta i ustawienia gospodarstwa inne niż domyślne.
 * @param options.accounts - Konta z API; pominięte — samo ROR.
 * @param options.defaultExpenseAccountId - Domyślne konto wydatków gospodarstwa.
 * @returns Router.
 */
function renderDocument(
  document: DocumentDto,
  options: { accounts?: AccountDto[]; defaultExpenseAccountId?: string | null } = {},
): ReturnType<typeof renderScreen>['router'] {
  mockCommon();
  if (options.accounts !== undefined) {
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue(options.accounts);
  }
  vi.spyOn(documentsApi, 'fetchDocument').mockResolvedValue(document);
  return renderScreen(`/scan/${DOCUMENT_ID}`, ROUTES, {
    ...TEST_SESSION,
    household: {
      ...TEST_SESSION.household,
      defaultExpenseAccountId: options.defaultExpenseAccountId ?? null,
    },
  }).router;
}

/** Drugie konto „na życie" — przy dwóch aplikacja nie zgaduje bez ustawienia. */
const JOINT = { ...ROR, id: '01JB0000000000000000000002', name: 'Wspólne', sortOrder: 1 };

beforeEach(() => {
  // jsdom nie ma adresów `blob:` — podgląd zdjęcia dostaje sztuczny.
  URL.createObjectURL = vi.fn(() => 'blob:podglad');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ScanScreen — wybór źródła', () => {
  it('lista „Ostatnie" ze statusami; wrzucenie wyciągu przechodzi do analizy', async () => {
    const user = userEvent.setup();
    mockCommon();
    vi.spyOn(documentsApi, 'fetchDocuments').mockResolvedValue([
      listItemFixture(),
      listItemFixture({
        id: '01JP0000000000000000000D02',
        kind: 'bank_statement',
        status: 'processing',
        merchant: null,
        totalMinor: null,
        bookedOn: null,
      }),
    ]);
    const upload = vi.spyOn(documentsApi, 'uploadDocument').mockResolvedValue({
      id: DOCUMENT_ID,
      status: 'processing',
      pollAfterMs: 1500,
    });
    vi.spyOn(documentsApi, 'fetchDocument').mockResolvedValue(
      documentFixture({ status: 'processing', summary: null, items: [] }),
    );
    const { router } = renderScreen('/scan', ROUTES);

    expect(await screen.findByText('Paragon · Lidl')).toBeInTheDocument();
    expect(screen.getByText('18 wrz · do przejrzenia · 8 poz.')).toBeInTheDocument();
    expect(screen.getByText('przetwarzanie…')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Wyciąg' }));
    const file = new File(['%PDF-1.4'], 'wyciag.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Wybierz plik'), file);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/scan/${DOCUMENT_ID}`);
    });
    expect(upload).toHaveBeenCalledWith(
      'token-testowy',
      expect.objectContaining({ kind: 'bank_statement', filename: 'wyciag.pdf' }),
    );
    expect(await screen.findByText(/zwykle 5–15 sekund/u)).toBeInTheDocument();
  });

  it('ten sam plik drugi raz: komunikat i przejście do istniejącego dokumentu', async () => {
    const user = userEvent.setup();
    mockCommon();
    vi.spyOn(documentsApi, 'fetchDocuments').mockResolvedValue([]);
    vi.spyOn(documentsApi, 'uploadDocument').mockRejectedValue(
      new ApiRequestError('CONFLICT', 'Ten dokument już jest w systemie.', 409, 'req', [
        { path: 'existingDocumentId', message: DOCUMENT_ID },
      ]),
    );
    vi.spyOn(documentsApi, 'fetchDocument').mockResolvedValue(documentFixture());
    const { router } = renderScreen('/scan', ROUTES);

    expect(await screen.findByText(/Nic jeszcze nie wrzucono/u)).toBeInTheDocument();
    await user.upload(
      screen.getByLabelText('Zrób zdjęcie'),
      new File(['x'], 'IMG_1.jpg', { type: 'image/jpeg' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Ten dokument już jest w systemie.');
    await user.click(within(alert).getByRole('button', { name: 'Otwórz dokument' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/scan/${DOCUMENT_ID}`);
    });
  });

  it('OCR wyłączony: ekran to mówi, zakładka „Skan" znika', async () => {
    mockCommon(false);
    vi.spyOn(documentsApi, 'fetchDocuments').mockResolvedValue([]);
    renderScreen('/scan', ROUTES);
    expect(await screen.findByText('Odczyt dokumentów jest wyłączony')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Skan' })).not.toBeInTheDocument();
    });
  });

  it('błąd listy — stan błędu z ponowieniem', async () => {
    mockCommon();
    vi.spyOn(documentsApi, 'fetchDocuments').mockRejectedValue(
      new ApiRequestError('INTERNAL_ERROR', 'Błąd', 500, 'req'),
    );
    renderScreen('/scan', ROUTES);
    expect(
      await screen.findByText('Nie udało się wczytać ostatnich dokumentów'),
    ).toBeInTheDocument();
  });
});

describe('DocumentScreen — stany', () => {
  it('nieudany odczyt: komunikat, „Spróbuj ponownie" woła analizę', async () => {
    const user = userEvent.setup();
    const reanalyze = vi.spyOn(documentsApi, 'reanalyzeDocument').mockResolvedValue({
      id: DOCUMENT_ID,
      status: 'processing',
      pollAfterMs: 1500,
    });
    renderDocument(
      documentFixture({
        status: 'failed',
        errorCode: 'AI_SCHEMA_MISMATCH',
        errorMessage: 'Nie udało się odczytać dokumentu. Spróbuj ponownie.',
        items: [],
      }),
    );
    expect(
      await screen.findByText('Nie udało się odczytać dokumentu. Spróbuj ponownie.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await waitFor(() => {
      expect(reanalyze).toHaveBeenCalledWith('token-testowy', DOCUMENT_ID);
    });
  });

  it('wyczerpany limit: bez ponowienia, dodanie ręczne jako akcja główna', async () => {
    renderDocument(
      documentFixture({
        status: 'failed',
        errorCode: 'AI_BUDGET_EXCEEDED',
        errorMessage: 'Wyczerpano miesięczny limit OCR.',
        items: [],
      }),
    );
    expect(await screen.findByText('Wyczerpano miesięczny limit OCR.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Spróbuj ponownie' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dodaj wydatek ręcznie' })).toBeInTheDocument();
  });

  it('zero pozycji — nie ślepy zaułek (08 §14)', async () => {
    renderDocument(documentFixture({ items: [], newCategoryProposals: [] }));
    expect(await screen.findByText('Nie rozpoznano pozycji')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wpisz kwotę ręcznie' })).toBeInTheDocument();
  });

  it('nieistniejący dokument', async () => {
    mockCommon();
    vi.spyOn(documentsApi, 'fetchDocument').mockRejectedValue(
      new ApiRequestError('NOT_FOUND', 'Nie znaleziono dokumentu.', 404, 'req'),
    );
    renderScreen(`/scan/${DOCUMENT_ID}`, ROUTES);
    expect(await screen.findByText('Nie ma takiego dokumentu')).toBeInTheDocument();
  });
});

describe('DocumentScreen — przegląd i zatwierdzenie', () => {
  it('paragon mieszany: domyślnie „Kategorie" z podglądem, zapis po kategorii (ADR-069)', async () => {
    const user = userEvent.setup();
    const commit = vi.spyOn(documentsApi, 'commitDocument').mockResolvedValue({
      data: {
        document: documentFixture({ status: 'committed' }),
        transactions: [{} as never, {} as never],
      },
      meta: { affectedMonths: ['2026-09'] },
    });
    renderDocument(documentFixture());

    expect(await screen.findByRole('tab', { name: 'Kategorie' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const preview = await screen.findByRole('list', { name: 'Transakcje do zapisu' });
    // Spożywcze (dwie pozycje — dominująca): mleko 6,98 + chleb 4,20 + baterie 12,50
    // (propozycja jeszcze nieprzyjęta) − rabat 3,00.
    await waitFor(() => {
      expect(
        within(preview)
          .getAllByRole('listitem')
          .map((row) => textOf(row)),
      ).toEqual([
        expect.stringMatching(/^Chemia−24,99 zł/u),
        expect.stringMatching(/^Jedzenie › Zakupy spożywcze−20,68 zł/u),
      ]);
    });

    // Przyjęta propozycja „Elektronika" wydziela baterie w osobną transakcję.
    await user.click(screen.getByRole('button', { name: 'Dodaj' }));
    await waitFor(() => {
      expect(within(preview).getAllByRole('listitem')).toHaveLength(3);
    });
    expect(textOf(preview)).toContain('Elektronika−12,50 zł');

    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }));
    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith(
        'token-testowy',
        DOCUMENT_ID,
        expect.objectContaining({
          mode: 'by_category',
          accountId: ROR_ID,
          categoryId: null,
          createCategories: [{ name: 'Elektronika', kind: 'expense' }],
        }),
        expect.any(String),
      );
    });
  });

  it('paragon: suma zgodna, pewność widoczna, „Całość" zapisuje jedną transakcję', async () => {
    const user = userEvent.setup();
    const commit = vi.spyOn(documentsApi, 'commitDocument').mockResolvedValue({
      data: { document: documentFixture({ status: 'committed' }), transactions: [{} as never] },
      meta: { affectedMonths: ['2026-09'] },
    });
    const router = renderDocument(documentFixture());

    expect(await screen.findByRole('heading', { name: 'Paragon · Lidl' })).toBeInTheDocument();
    expect(screen.getByText('zgadza się')).toBeInTheDocument();
    expect(
      (await screen.findAllByText('Jedzenie › Zakupy spożywcze', { selector: 'button *' })).length,
    ).toBeGreaterThan(0);
    // Baterie 40% i chleb 41% — znacznik niepewności; baterie — propozycja nowej kategorii.
    expect(
      screen.getAllByText(/Niepewne dopasowanie/u, { selector: 'p' }).map((line) => textOf(line)),
    ).toEqual(['Niepewne dopasowanie · 40%', 'Niepewne dopasowanie · 41%']);
    expect(screen.getAllByText(/Nowa kategoria/u).length).toBeGreaterThan(0);
    expect(textOf(screen.getByText(/^Zaznaczono/u).parentElement as HTMLElement)).toContain(
      '45,67',
    );

    await user.click(screen.getByRole('tab', { name: 'Całość' }));
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }));
    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith(
        'token-testowy',
        DOCUMENT_ID,
        expect.objectContaining({
          mode: 'single',
          accountId: ROR_ID,
          bookedOn: '2026-09-18',
          categoryId: GROCERIES_ID,
          createCategories: [],
        }),
        expect.any(String),
      );
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/m/2026-09');
    });
  });

  it('brak konta: komunikat pod nagłówkiem i od razu wybór konta (ADR-070)', async () => {
    const user = userEvent.setup();
    const commit = vi.spyOn(documentsApi, 'commitDocument');
    renderDocument(documentFixture({ suggestedAccountId: null }), { accounts: [ROR, JOINT] });

    await user.click(await screen.findByRole('button', { name: 'Zatwierdź' }));
    // Otwarty arkusz ukrywa resztę ekranu przed czytnikiem — szukamy po tekście.
    const alert = await screen.findByText('Wybierz konto.');
    expect(alert).toHaveAttribute('role', 'alert');
    // Komunikat stoi zaraz za nagłówkiem, przed podglądem dokumentu — nie na dole listy.
    expect(alert.previousElementSibling?.tagName).toBe('HEADER');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Wspólne')).toBeInTheDocument();
    expect(commit).not.toHaveBeenCalled();
  });

  it('bez konta w dokumencie proponuje domyślne konto wydatków z ustawień', async () => {
    const user = userEvent.setup();
    const commit = vi.spyOn(documentsApi, 'commitDocument').mockResolvedValue({
      data: { document: documentFixture({ status: 'committed' }), transactions: [] },
      meta: { affectedMonths: ['2026-09'] },
    });
    renderDocument(documentFixture({ suggestedAccountId: null }), {
      accounts: [ROR, JOINT],
      defaultExpenseAccountId: JOINT.id,
    });

    expect(await screen.findByText('Wspólne')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }));
    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith(
        'token-testowy',
        DOCUMENT_ID,
        expect.objectContaining({ accountId: JOINT.id }),
        expect.any(String),
      );
    });
  });

  it('suma niezgodna: różnica i baner, zapis nie jest blokowany', async () => {
    const base = documentFixture();
    renderDocument(documentFixture({ summary: { ...base.summary!, totalMinor: 5000 } }));
    expect(await screen.findByText(/zapis nie jest blokowany/u)).toBeInTheDocument();
    expect(screen.getByText(/różnica/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeEnabled();
  });

  it('podział na pozycje: „Dodaj" przyjmuje propozycję, odznaczenie wyłącza pozycję', async () => {
    const user = userEvent.setup();
    const commit = vi.spyOn(documentsApi, 'commitDocument').mockResolvedValue({
      data: { document: documentFixture({ status: 'committed' }), transactions: [] },
      meta: { affectedMonths: ['2026-09'] },
    });
    renderDocument(documentFixture());

    await user.click(await screen.findByRole('tab', { name: 'Pozycje' }));
    await user.click(screen.getByRole('button', { name: 'Dodaj' }));
    expect(screen.getByText(/zostanie dodana przy zapisie/u)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Rabat/u }));
    expect(screen.getByText(/^Zaznaczono/u)).toHaveTextContent('Zaznaczono 4 z 5');

    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }));
    await waitFor(() => {
      expect(commit).toHaveBeenCalled();
    });
    const body = commit.mock.calls[0]?.[2];
    expect(body).toMatchObject({
      mode: 'split',
      categoryId: null,
      createCategories: [{ name: 'Elektronika', kind: 'expense' }],
    });
    expect(body?.itemIds).toHaveLength(4);
    expect(body?.itemIds).not.toContain('01JQ0000000000000000000005');
  });

  it('wyciąg: operacje z datami, możliwy duplikat odznaczony, bez przełącznika trybu', async () => {
    renderDocument(
      documentFixture({
        kind: 'bank_statement',
        mimeType: 'application/pdf',
        summary: {
          ...documentFixture().summary!,
          merchant: null,
          totalMinor: null,
          periodFrom: '2026-09-01',
          periodTo: '2026-09-30',
        },
        items: [
          itemFixture({
            id: '01JQ0000000000000000000011',
            description: 'Netflix',
            amountMinor: 4999,
            bookedOn: '2026-09-11',
            rawText: 'NETFLIX.COM',
            reviewStatus: 'rejected',
            duplicateOfTransactionId: '01JT0000000000000000000001',
          }),
          itemFixture({
            id: '01JQ0000000000000000000012',
            description: 'Biedronka',
            amountMinor: 8420,
            bookedOn: '2026-09-12',
          }),
        ],
        newCategoryProposals: [],
      }),
    );
    expect(await screen.findByText('Możliwy duplikat')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Netflix/u })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Biedronka/u })).toBeChecked();
    expect(screen.getByText('11 wrz · NETFLIX.COM')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Jedna transakcja' })).not.toBeInTheDocument();
    expect(screen.getByText('PDF', { exact: false })).toBeInTheDocument();
  });

  it('korekta pozycji: kwota z przecinkiem idzie jako grosze', async () => {
    const user = userEvent.setup();
    const patch = vi.spyOn(documentsApi, 'updateDocumentItem').mockResolvedValue(documentFixture());
    renderDocument(documentFixture());
    await user.click(await screen.findByRole('button', { name: 'Popraw pozycję: Mleko 3,2% 1L' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Popraw pozycję' }));
    const amount = dialog.getByLabelText('Kwota (zł)');
    await user.clear(amount);
    await user.type(amount, '7,50');
    await user.click(dialog.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith(
        'token-testowy',
        DOCUMENT_ID,
        '01JQ0000000000000000000001',
        {
          amountMinor: 750,
        },
      );
    });
  });
});
