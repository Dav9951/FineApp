/*
 Dopisanie `family_id` do `auth_sessions` (03 §3.3).

 Napisane ręcznie, bo wygenerowane `ALTER TABLE ... ADD COLUMN ... NOT NULL` bez wartości
 domyślnej jest w SQLite błędem **zawsze**, nawet na pustej tabeli. Zamiast dokładać
 sztuczny `DEFAULT ''`, który zostałby w schemacie na zawsze, tabela jest odtwarzana
 standardową dwunastokrokową procedurą SQLite.

 Wiersze sprzed tej migracji powstały, zanim istniała rotacja, więc każdy z nich jest
 własną rodziną: `family_id = id`.
*/
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `auth_sessions_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`family_id` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`device_label` text,
	`user_agent` text,
	`ip_hash` text,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `auth_sessions_new`
	(`id`, `user_id`, `family_id`, `refresh_token_hash`, `device_label`, `user_agent`,
	 `ip_hash`, `expires_at`, `revoked_at`, `last_used_at`, `created_at`)
SELECT `id`, `user_id`, `id`, `refresh_token_hash`, `device_label`, `user_agent`,
	 `ip_hash`, `expires_at`, `revoked_at`, `last_used_at`, `created_at`
FROM `auth_sessions`;--> statement-breakpoint
DROP TABLE `auth_sessions`;--> statement-breakpoint
ALTER TABLE `auth_sessions_new` RENAME TO `auth_sessions`;--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_user` ON `auth_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_family` ON `auth_sessions` (`family_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_auth_sessions_token` ON `auth_sessions` (`refresh_token_hash`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
