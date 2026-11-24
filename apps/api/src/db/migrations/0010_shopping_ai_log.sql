/*
 Odczyty list zakupów w dzienniku odczytu i w zużyciu AI (ADR-107, 03 §3.22, §3.26).
 Dziennik dostaje źródło wpisu i odnośnik do importu; import — tokeny i chwilę odczytu.
 Kolumny dodawane bez przebudowy tabeli: istniejące wpisy dziennika to dokumenty.
*/
ALTER TABLE `document_logs` ADD `source` text DEFAULT 'document' NOT NULL CONSTRAINT "document_logs_source_check" CHECK("source" IN ('document', 'shopping'));--> statement-breakpoint
ALTER TABLE `document_logs` ADD `shopping_import_id` text REFERENCES `shopping_imports`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `shopping_imports` ADD `ai_input_tokens` integer;--> statement-breakpoint
ALTER TABLE `shopping_imports` ADD `ai_output_tokens` integer;--> statement-breakpoint
ALTER TABLE `shopping_imports` ADD `processed_at` integer;
