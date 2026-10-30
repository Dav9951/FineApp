/**
 * Punkt wejścia paczki `@fineapp/shared`.
 *
 * Paczka jest jedynym źródłem kontraktów dzielonych przez API i front: schematy Zod
 * (DTO), typy domenowe, enumy oraz helpery pieniądza i miesiąca. Kontrakt powstaje
 * tutaj **przed** implementacją po obu stronach — dzięki temu backend i front nie mogą
 * rozjechać się w cichy sposób (patrz `plans/02-architecture.md`).
 */
export * from './domain/primitives.js';
export * from './domain/enums.js';
export * from './domain/pin.js';
export * from './domain/account.js';
export * from './domain/income-source.js';
export * from './domain/allocation.js';
export * from './domain/transaction.js';
export * from './domain/closed-month.js';
export * from './domain/recurring.js';
export * from './domain/liability.js';
export * from './domain/goal.js';
export * from './domain/allocation-status.js';
export * from './domain/planned-expense.js';
export * from './domain/document.js';
export * from './domain/budget.js';
export * from './domain/budget-layout.js';
export * from './utils/money.js';
export * from './utils/money-words.js';
export * from './utils/month.js';
export * from './utils/date-tz.js';
export * from './utils/names.js';
export * from './dto/envelope.js';
export * from './dto/auth.js';
export * from './dto/account.js';
export * from './dto/category.js';
export * from './dto/income-source.js';
export * from './dto/transaction.js';
export * from './dto/month.js';
export * from './dto/recurring.js';
export * from './dto/liability.js';
export * from './dto/goal.js';
export * from './dto/allocation.js';
export * from './dto/planned-expense.js';
export * from './dto/document.js';
export * from './dto/settings.js';
export * from './dto/budget.js';
