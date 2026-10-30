/*
 Planer budżetu (Faza 9, F9-1, ADR-075…079): `budget_drafts` i `budget_draft_lines`
 z 03 §3.19–3.20. Tylko nowe tabele — istniejących danych nie dotyka.
*/
CREATE TABLE `budget_draft_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`flow` text NOT NULL,
	`name` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`category_id` text,
	`income_source_id` text,
	`goal_id` text,
	`liability_id` text,
	`due_on` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`recurring_rule_id` text,
	`planned_expense_id` text,
	`source_amount_minor` integer,
	`average_months` integer,
	`is_excluded` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `budget_drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`income_source_id`) REFERENCES `income_sources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`liability_id`) REFERENCES `liabilities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recurring_rule_id`) REFERENCES `recurring_rules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`planned_expense_id`) REFERENCES `planned_expenses`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "budget_draft_lines_flow_check" CHECK("budget_draft_lines"."flow" IN ('income', 'expense', 'savings', 'investment')),
	CONSTRAINT "budget_draft_lines_origin_check" CHECK("budget_draft_lines"."origin" IN ('manual', 'recurring', 'planned', 'set_aside', 'goal', 'liability')),
	CONSTRAINT "budget_draft_lines_average_months_check" CHECK("budget_draft_lines"."average_months" IN (3, 6, 12))
);
--> statement-breakpoint
CREATE INDEX `idx_budget_lines_draft` ON `budget_draft_lines` (`draft_id`,`flow`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_budget_line_rule` ON `budget_draft_lines` (`draft_id`,`recurring_rule_id`) WHERE "budget_draft_lines"."recurring_rule_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_budget_line_planned` ON `budget_draft_lines` (`draft_id`,`planned_expense_id`,`origin`) WHERE "budget_draft_lines"."planned_expense_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_budget_line_goal` ON `budget_draft_lines` (`draft_id`,`goal_id`) WHERE "budget_draft_lines"."origin" = 'goal';--> statement-breakpoint
CREATE UNIQUE INDEX `uq_budget_line_liability` ON `budget_draft_lines` (`draft_id`,`liability_id`) WHERE "budget_draft_lines"."origin" = 'liability';--> statement-breakpoint
CREATE TABLE `budget_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`month_key` text NOT NULL,
	`notes` text,
	`last_filled_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_budget_draft_month` ON `budget_drafts` (`household_id`,`month_key`);