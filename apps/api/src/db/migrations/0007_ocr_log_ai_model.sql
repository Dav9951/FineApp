/*
 Dziennik odczytu dokumentów (ADR-086): tabela `document_logs` z 03 §3.22.
 Model odczytu w ustawieniach (ADR-085): kolumna `households.ai_model`; istniejące
 gospodarstwo przechodzi na Haiku 5.5 — powrót na Sonnet jednym kliknięciem w Ustawieniach.
*/
CREATE TABLE `document_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`document_id` text,
	`document_name` text,
	`level` text NOT NULL,
	`event` text NOT NULL,
	`message` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "document_logs_level_check" CHECK("document_logs"."level" IN ('info', 'warn', 'error')),
	CONSTRAINT "document_logs_event_check" CHECK("document_logs"."event" IN ('started', 'prepared', 'parsed', 'failed', 'upload_rejected'))
);
--> statement-breakpoint
CREATE INDEX `idx_document_logs_household` ON `document_logs` (`household_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_document_logs_document` ON `document_logs` (`document_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `households` ADD `ai_model` text;--> statement-breakpoint
UPDATE `households` SET `ai_model` = 'claude-haiku-5-5';
