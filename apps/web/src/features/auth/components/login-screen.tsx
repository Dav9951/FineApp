import { EmailSchema } from '@fineapp/shared';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Button } from '../../../components/ui/button.js';
import { Checkbox } from '../../../components/ui/checkbox.js';
import { Keypad, type KeypadKey } from '../../../components/ui/keypad.js';
import { ApiRequestError, NetworkError } from '../../../lib/api-client.js';
import { cn } from '../../../lib/cn.js';
import { useAuth } from '../auth-context.js';
import { PinDots } from './pin-dots.js';

/**
 * Ekran logowania ([06 §3.13](../../../../../../plans/06-ui-views.md#313-logowanie--login)).
 *
 * Dwa kroki: adres e-mail, potem PIN. Adres jest **zapamiętywany lokalnie**, więc przy
 * kolejnym wejściu widać od razu klawiaturę PIN — to jedyna rzecz, jaką ten ekran
 * zostawia w przeglądarce. PIN-u ani tokenu nie zapisuje nigdzie
 * ([09 §3.1](../../../../../../plans/09-security-auth.md#31-podział-ról)).
 *
 * **Komunikat błędu jest jednakowy** dla nieznanego adresu i złego PIN-u — różnicowanie
 * go zdradzałoby, które konta istnieją ([09 §2.4](../../../../../../plans/09-security-auth.md#24-przepływ-logowania)).
 */

/** Klucz, pod którym pamiętamy adres. */
export const REMEMBERED_EMAIL_KEY = 'fineapp.email';

/** Długość PIN-u wymagana przez kontrakt (`PinSchema`). */
const PIN_MIN_LENGTH = 6;
const PIN_MAX_LENGTH = 8;

/**
 * Odczytuje zapamiętany adres.
 *
 * `localStorage` bywa niedostępne — w trybie prywatnym albo przy zablokowanych danych
 * witryny — i wtedy sam **odczyt rzuca wyjątkiem**. Ekran logowania nie może się na tym
 * wywrócić: to jedyna droga do aplikacji.
 *
 * @returns Zapamiętany adres albo pusty napis.
 */
export function readRememberedEmail(): string {
  try {
    return window.localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Zapamiętuje albo zapomina adres.
 *
 * @param email - Adres do zapamiętania; pusty napis kasuje wpis.
 */
export function rememberEmail(email: string): void {
  try {
    if (email === '') window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
    else window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
  } catch {
    // Brak pamięci lokalnej to niedogodność, nie powód, żeby nie dać się zalogować.
  }
}

/**
 * Zamienia błąd na komunikat dla użytkownika.
 *
 * Komunikaty z API są już po polsku i gotowe do pokazania
 * ([04 §3](../../../../../../plans/04-api-spec.md#3-format-błędów)), więc przepisujemy
 * je wprost. Własny tekst dokładamy tylko tam, gdzie serwer nie odpowiedział wcale.
 *
 * @param error - Złapany błąd.
 * @returns Komunikat po polsku.
 */
function messageOf(error: unknown): string {
  if (error instanceof NetworkError) return error.message;
  if (error instanceof ApiRequestError) return error.message;
  return 'Nie udało się zalogować. Spróbuj ponownie.';
}

/**
 * Ekran logowania.
 *
 * @returns Element ekranu.
 */
export default function LoginScreen(): ReactNode {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(readRememberedEmail);
  const [emailConfirmed, setEmailConfirmed] = useState(() => readRememberedEmail() !== '');
  // Zaznaczone domyślnie, jak na szkicu z `06 §3.13`: aplikacja jest prywatna, dwoje
  // użytkowników i własne urządzenia, więc pytanie „zapamiętać?" ma oczywistą odpowiedź.
  const [remember, setRemember] = useState(true);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!emailConfirmed) emailRef.current?.focus();
  }, [emailConfirmed]);

  /**
   * Wysyła dane logowania.
   *
   * @param submittedPin - PIN do wysłania.
   */
  const submit = (submittedPin: string): void => {
    setPending(true);
    setError(null);
    void signIn({ email, pin: submittedPin, deviceLabel: deviceLabel() })
      .then(() => {
        rememberEmail(remember ? email : '');
        // Wracamy tam, skąd trasa chroniona odesłała na logowanie; bez takiego stanu —
        // na korzeń, który przekieruje na bieżący miesiąc.
        const from = (location.state as { from?: string } | null)?.from;
        void navigate(from ?? '/', { replace: true });
      })
      .catch((cause: unknown) => {
        setError(messageOf(cause));
        // PIN czyścimy zawsze: zostawienie go na ekranie po błędzie zachęca do
        // „poprawiania" jednej cyfry, a każda próba kosztuje jedną z pięciu (09 §2.5).
        setPin('');
      })
      .finally(() => {
        setPending(false);
      });
  };

  /**
   * Obsługuje klawisz klawiatury PIN.
   *
   * @param key - Naciśnięty klawisz.
   */
  const handleKey = (key: KeypadKey): void => {
    if (pending) return;
    setError(null);

    if (key === 'backspace') {
      setPin((current) => current.slice(0, -1));
      return;
    }
    if (key === 'extra') return;

    setPin((current) => {
      if (current.length >= PIN_MAX_LENGTH) return current;
      const next = current + key;
      // Po wpisaniu kompletu cyfr logowanie startuje automatycznie (06 §3.13).
      if (next.length === PIN_MIN_LENGTH) submit(next);
      return next;
    });
  };

  /**
   * Sprawdza adres i przechodzi do PIN-u.
   *
   * Formularz ma `noValidate`: walidację robi `EmailSchema`, czyli **ten sam schemat,
   * którego użyje serwer**. Natywny dymek przeglądarki mówiłby co innego, w języku
   * systemu i poza naszymi tokenami — a rozjazd między tym, co odrzuca przeglądarka,
   * a tym, co odrzuca API, jest źródłem błędów nie do odtworzenia.
   *
   * @param event - Zdarzenie wysłania formularza.
   */
  const handleEmailSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const parsed = EmailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Nieprawidłowy adres e-mail');
      return;
    }
    setEmail(parsed.data);
    setError(null);
    setEmailConfirmed(true);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-[390px] flex-col justify-center px-4 py-10">
      <h1 className="text-center text-xl font-semibold tracking-tight">FineApp</h1>

      {!emailConfirmed ? (
        <form className="mt-8 flex flex-col gap-3" noValidate onSubmit={handleEmailSubmit}>
          <label className="text-caption text-muted-foreground" htmlFor="login-email">
            Adres e-mail
          </label>
          <input
            autoCapitalize="none"
            autoComplete="username"
            className={cn(
              'min-h-touch w-full rounded-md border border-border bg-card px-3 text-base',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
            id="login-email"
            inputMode="email"
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
            ref={emailRef}
            type="email"
            value={email}
          />
          <Button size="large" type="submit" variant="primary">
            Dalej
          </Button>
        </form>
      ) : (
        <>
          <button
            className="mt-6 min-h-touch text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setEmailConfirmed(false);
              setPin('');
              setError(null);
            }}
            type="button"
          >
            {email}
          </button>

          <PinDots
            className="mt-6"
            filled={pin.length}
            invalid={error !== null}
            length={PIN_MIN_LENGTH}
          />

          {/* Szerokość z szkicu w `06 §3.13`: klawiatura jest wyspą na środku ekranu,
              a nie pasem od krawędzi do krawędzi. Klawisz zostaje przy 52 px wysokości
              z `15 §4.2`. */}
          <Keypad
            className="mx-auto mt-8 w-full max-w-[264px]"
            disabled={pending}
            onPress={handleKey}
          />

          {/* Bez dodatkowego `<label>` naokoło: `<Checkbox>` sam jest etykietą
              obejmującą cały wiersz, a etykieta w etykiecie to niepoprawny HTML
              i podwójne zgłoszenie kliknięcia. */}
          <Checkbox
            checked={remember}
            className="mt-6 justify-center"
            onCheckedChange={setRemember}
          >
            Zapamiętaj to urządzenie
          </Checkbox>
        </>
      )}

      <p
        className={cn('mt-6 min-h-5 text-center text-sm text-danger', error === null && 'sr-only')}
        role="alert"
      >
        {error ?? ''}
      </p>
    </main>
  );
}

/**
 * Buduje etykietę urządzenia z `User-Agent`.
 *
 * Etykieta trafia na listę urządzeń w ustawieniach, więc ma odpowiadać na jedno
 * pytanie: które to z moich urządzeń. Pełny `User-Agent` tego nie ułatwia — jest
 * długi i pełen historycznych naleciałości.
 *
 * @returns Krótka etykieta, np. `iPhone — Safari`.
 */
function deviceLabel(): string {
  const agent = navigator.userAgent;
  const system = /iPhone/.test(agent)
    ? 'iPhone'
    : /iPad/.test(agent)
      ? 'iPad'
      : /Android/.test(agent)
        ? 'Android'
        : /Macintosh/.test(agent)
          ? 'Mac'
          : /Windows/.test(agent)
            ? 'Windows'
            : /Linux/.test(agent)
              ? 'Linux'
              : 'Urządzenie';
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Chrome\//.test(agent)
      ? 'Chrome'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'przeglądarka';
  return `${system} — ${browser}`;
}
