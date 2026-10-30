/*
 Planer budżetu — grupy i kolejność linii (F9-11, ADR-081): tabela `budget_draft_groups`
 z 03 §3.21 i kolumna `budget_draft_lines.group_id`. drizzle-kit przy ADD COLUMN gubi
 akcję klucza obcego — `ON DELETE set null` dopisane ręcznie (usunięcie grupy przenosi
 linie do „Bez grupy", nie kasuje ich). Istniejące szkice zostają bez grup.
*/
CREATE TABLE `budget_draft_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`section` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `budget_drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budget_draft_groups_section_check" CHECK("budget_draft_groups"."section" IN ('income', 'expense', 'pools'))
);
--> statement-breakpoint
CREATE INDEX `idx_budget_groups_draft` ON `budget_draft_groups` (`draft_id`,`section`,`sort_order`);--> statement-breakpoint
ALTER TABLE `budget_draft_lines` ADD `group_id` text REFERENCES budget_draft_groups(id) ON DELETE set null;