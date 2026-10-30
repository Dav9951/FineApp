/*
 Tabela `idempotency_keys` (ADR-037) — zapamiętane odpowiedzi operacji z nagłówkiem
 `Idempotency-Key`, pierwszym użyciem jest `POST /transactions`. Tylko nowa tabela,
 danych nie rusza.
*/
CREATE TABLE `idempotency_keys` (
	`household_id` text NOT NULL,
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`status_code` integer NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`household_id`, `scope`, `key`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_idempotency_created` ON `idempotency_keys` (`created_at`);