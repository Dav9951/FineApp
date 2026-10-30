/*
 Kolumna `documents.account_id` (ADR-059) — konto wskazane przy wrzuceniu dokumentu albo
 w korekcie nagłówka. drizzle-kit gubi przy `ADD COLUMN` akcję `ON DELETE`, więc jest
 dopisana ręcznie: usunięcie konta czyści podpowiedź, nie blokuje usunięcia.
*/
ALTER TABLE `documents` ADD `account_id` text REFERENCES accounts(id) ON DELETE SET NULL;
