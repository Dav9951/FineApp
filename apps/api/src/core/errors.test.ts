import { describe, expect, it } from 'vitest';

import {
  AiBudgetExceededError,
  AppError,
  ConflictError,
  DomainRuleViolationError,
  ExternalServiceError,
  FileTooLargeError,
  ForbiddenError,
  InternalError,
  isAppError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  UnsupportedMediaTypeError,
  ValidationError,
} from './errors.js';

describe('hierarchia błędów', () => {
  it.each([
    [new ValidationError('Kwota musi być większa od zera.'), 'VALIDATION_ERROR', 400],
    [new UnauthorizedError(), 'UNAUTHORIZED', 401],
    [new ForbiddenError(), 'FORBIDDEN', 403],
    [new NotFoundError(), 'NOT_FOUND', 404],
    [new ConflictError('Konto o tej nazwie już istnieje.'), 'CONFLICT', 409],
    [new RateLimitError('Za dużo prób.'), 'RATE_LIMITED', 429],
    [
      new DomainRuleViolationError('Przelew wymaga konta docelowego.'),
      'DOMAIN_RULE_VIOLATION',
      422,
    ],
    [new FileTooLargeError(), 'FILE_TOO_LARGE', 413],
    [new UnsupportedMediaTypeError(), 'UNSUPPORTED_MEDIA_TYPE', 415],
    [new ExternalServiceError('Usługa nie odpowiedziała.'), 'EXTERNAL_SERVICE_ERROR', 502],
    [new AiBudgetExceededError(), 'AI_BUDGET_EXCEEDED', 402],
    [new InternalError(), 'INTERNAL_ERROR', 500],
  ])('%s niesie kod i status z kontraktu API', (error, code, statusCode) => {
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(statusCode);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });

  it('ustawia `name` na nazwę klasy, nie na "Error"', () => {
    expect(new NotFoundError().name).toBe('NotFoundError');
    expect(new ValidationError('x').name).toBe('ValidationError');
  });

  it('przenosi szczegóły do podświetlenia pól formularza', () => {
    const details = [{ path: 'amountMinor', message: 'Oczekiwano liczby dodatniej' }];
    expect(new ValidationError('Błąd.', details).details).toEqual(details);
  });

  it('komunikaty domyślne są po polsku i nadają się dla użytkownika', () => {
    expect(new UnauthorizedError().message).toBe('Nieprawidłowy e-mail lub PIN.');
    expect(new AiBudgetExceededError().message).toBe('Wyczerpano miesięczny limit OCR.');
  });
});

describe('isAppError', () => {
  it('rozpoznaje własną hierarchię', () => {
    expect(isAppError(new NotFoundError())).toBe(true);
    expect(isAppError(new AppError('INTERNAL_ERROR', 'x', 500))).toBe(true);
  });

  it('odrzuca wszystko inne', () => {
    expect(isAppError(new Error('zwykły'))).toBe(false);
    expect(isAppError('NOT_FOUND')).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});
