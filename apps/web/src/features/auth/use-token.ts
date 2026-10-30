import { useAuth } from './auth-context.js';

/**
 * Token dostępu dla funkcji zapytań i mutacji.
 *
 * Zapytania stoją za bramą sesji, ale odnowienie tokenu na starcie trwa chwilę —
 * dlatego hooki danych mają `enabled: token !== null`, a funkcja zapytania dostaje
 * token przez {@link requireToken}.
 *
 * @returns Token albo `null`, dopóki sesja się nie odtworzy.
 */
export function useAccessToken(): string | null {
  return useAuth().accessToken;
}

/**
 * Zwraca token albo rzuca — dla funkcji zapytań, które bez tokenu są wyłączone.
 *
 * @param token - Token z kontekstu sesji.
 * @returns Token.
 * @throws {Error} Gdy tokenu nie ma; przy `enabled` nie powinno się zdarzyć.
 */
export function requireToken(token: string | null): string {
  if (token === null) throw new Error('Brak sesji.');
  return token;
}
