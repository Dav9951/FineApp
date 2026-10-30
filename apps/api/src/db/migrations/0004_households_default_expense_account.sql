/*
 Kolumna `households.default_expense_account_id` (ADR-070) — konto proponowane przy
 wydatkach i skanie. drizzle-kit gubi przy `ADD COLUMN` akcję `ON DELETE`, więc jest
 dopisana ręcznie: usunięcie konta czyści ustawienie, nie blokuje usunięcia.
*/
ALTER TABLE `households` ADD `default_expense_account_id` text REFERENCES accounts(id) ON DELETE SET NULL;
