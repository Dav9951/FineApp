CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_currency` text DEFAULT 'PLN' NOT NULL,
	`timezone` text DEFAULT 'Europe/Warsaw' NOT NULL,
	`locale` text DEFAULT 'pl-PL' NOT NULL,
	`back_posting_limit_months` integer DEFAULT 1 NOT NULL,
	`month_start_day` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "households_month_start_day_check" CHECK("households"."month_start_day" BETWEEN 1 AND 28)
);
--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_hash` text NOT NULL,
	`ip_hash` text,
	`succeeded` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auth_attempts_email` ON `auth_attempts` (`email_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_auth_attempts_ip` ON `auth_attempts` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`device_label` text,
	`user_agent` text,
	`ip_hash` text,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_user` ON `auth_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_auth_sessions_token` ON `auth_sessions` (`refresh_token_hash`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`pin_hash` text NOT NULL,
	`pin_updated_at` integer NOT NULL,
	`avatar_color` text,
	`last_login_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`allocation_class` text NOT NULL,
	`currency` text DEFAULT 'PLN' NOT NULL,
	`opening_balance_minor` integer DEFAULT 0 NOT NULL,
	`opening_balance_on` text NOT NULL,
	`institution` text,
	`color` text,
	`icon` text,
	`include_in_net_worth` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "accounts_type_check" CHECK("accounts"."type" IN ('checking', 'cash', 'savings', 'investment', 'other')),
	CONSTRAINT "accounts_allocation_class_check" CHECK("accounts"."allocation_class" IN ('spending', 'savings', 'investment'))
);
--> statement-breakpoint
CREATE INDEX `idx_accounts_household` ON `accounts` (`household_id`,`is_archived`,`sort_order`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`icon` text,
	`color` text,
	`ai_hints` text,
	`is_system` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "categories_kind_check" CHECK("categories"."kind" IN ('expense', 'income', 'transfer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_categories_slug` ON `categories` (`household_id`,`kind`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_categories_parent` ON `categories` (`household_id`,`parent_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `income_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`owner_user_id` text,
	`counts_toward_allocation` integer DEFAULT true NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "income_sources_kind_check" CHECK("income_sources"."kind" IN ('salary', 'business', 'freelance', 'benefit', 'rental', 'investment', 'refund', 'gift', 'sale', 'other'))
);
--> statement-breakpoint
CREATE INDEX `idx_income_sources_household` ON `income_sources` (`household_id`,`is_archived`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`purpose` text,
	`target_amount_minor` integer,
	`target_date` text,
	`starting_amount_minor` integer DEFAULT 0 NOT NULL,
	`linked_account_id` text,
	`progress_source` text DEFAULT 'contributions' NOT NULL,
	`contribution_mode` text DEFAULT 'fixed' NOT NULL,
	`contribution_amount_minor` integer,
	`contribution_percent_bps` integer,
	`priority` integer DEFAULT 0 NOT NULL,
	`color` text,
	`icon` text,
	`status` text DEFAULT 'active' NOT NULL,
	`achieved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "goals_kind_check" CHECK("goals"."kind" IN ('savings', 'investment')),
	CONSTRAINT "goals_purpose_check" CHECK("goals"."purpose" IN ('down_payment', 'emergency_fund', 'vacation', 'car', 'renovation', 'retirement', 'education', 'custom')),
	CONSTRAINT "goals_progress_source_check" CHECK("goals"."progress_source" IN ('contributions', 'account_balance')),
	CONSTRAINT "goals_contribution_mode_check" CHECK("goals"."contribution_mode" IN ('fixed', 'percent_of_income', 'none')),
	CONSTRAINT "goals_status_check" CHECK("goals"."status" IN ('active', 'paused', 'achieved', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `idx_goals_household` ON `goals` (`household_id`,`status`,`priority`);--> statement-breakpoint
CREATE TABLE `liabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`creditor` text,
	`currency` text DEFAULT 'PLN' NOT NULL,
	`opening_balance_minor` integer NOT NULL,
	`balance_as_of` text NOT NULL,
	`monthly_payment_minor` integer NOT NULL,
	`installments_total` integer,
	`installments_remaining_at_as_of` integer,
	`interest_rate_bps` integer,
	`payment_day` integer,
	`first_payment_on` text,
	`final_payment_on` text,
	`payment_account_id` text,
	`category_id` text,
	`recurring_rule_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recurring_rule_id`) REFERENCES `recurring_rules`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "liabilities_kind_check" CHECK("liabilities"."kind" IN ('mortgage', 'cash_loan', 'car_loan', 'installment', 'credit_card', 'bnpl', 'private', 'other')),
	CONSTRAINT "liabilities_payment_day_check" CHECK("liabilities"."payment_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE INDEX `idx_liabilities_household` ON `liabilities` (`household_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `allocation_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`effective_from_month` text NOT NULL,
	`savings_percent_bps` integer DEFAULT 0 NOT NULL,
	`investment_percent_bps` integer DEFAULT 0 NOT NULL,
	`debt_percent_bps` integer DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_allocation_month` ON `allocation_targets` (`household_id`,`effective_from_month`);--> statement-breakpoint
CREATE TABLE `recurring_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`due_on` text NOT NULL,
	`month_key` text NOT NULL,
	`planned_amount_minor` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`transaction_id` text,
	`posted_amount_minor` integer,
	`posted_at` integer,
	`skipped_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `recurring_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recurring_occurrences_status_check" CHECK("recurring_occurrences"."status" IN ('planned', 'posted', 'skipped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_occurrence_rule_due` ON `recurring_occurrences` (`rule_id`,`due_on`);--> statement-breakpoint
CREATE INDEX `idx_occurrence_month` ON `recurring_occurrences` (`household_id`,`month_key`,`status`);--> statement-breakpoint
CREATE TABLE `recurring_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`flow` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`amount_is_estimate` integer DEFAULT false NOT NULL,
	`currency` text DEFAULT 'PLN' NOT NULL,
	`account_id` text,
	`counter_account_id` text,
	`category_id` text,
	`income_source_id` text,
	`goal_id` text,
	`liability_id` text,
	`allocation_override` text,
	`frequency` text NOT NULL,
	`interval_count` integer DEFAULT 1 NOT NULL,
	`day_of_month` integer,
	`weekday` integer,
	`month_of_year` integer,
	`anchor_date` text NOT NULL,
	`start_month` text NOT NULL,
	`end_month` text,
	`auto_post` integer DEFAULT false NOT NULL,
	`is_fixed_expense` integer DEFAULT false NOT NULL,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`counter_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`income_source_id`) REFERENCES `income_sources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`liability_id`) REFERENCES `liabilities`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recurring_rules_flow_check" CHECK("recurring_rules"."flow" IN ('expense', 'income', 'transfer')),
	CONSTRAINT "recurring_rules_allocation_override_check" CHECK("recurring_rules"."allocation_override" IN ('none', 'savings', 'investment')),
	CONSTRAINT "recurring_rules_frequency_check" CHECK("recurring_rules"."frequency" IN ('monthly', 'weekly', 'biweekly', 'quarterly', 'yearly', 'every_n_months')),
	CONSTRAINT "recurring_rules_day_of_month_check" CHECK("recurring_rules"."day_of_month" BETWEEN 1 AND 31),
	CONSTRAINT "recurring_rules_weekday_check" CHECK("recurring_rules"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "recurring_rules_month_of_year_check" CHECK("recurring_rules"."month_of_year" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE INDEX `idx_recurring_rules_household` ON `recurring_rules` (`household_id`,`is_active`,`flow`);--> statement-breakpoint
CREATE TABLE `planned_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`estimated_amount_minor` integer NOT NULL,
	`amount_is_estimate` integer DEFAULT true NOT NULL,
	`currency` text DEFAULT 'PLN' NOT NULL,
	`due_month` text NOT NULL,
	`due_on` text,
	`category_id` text,
	`account_id` text,
	`liability_id` text,
	`priority` text DEFAULT 'should' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`set_aside_enabled` integer DEFAULT false NOT NULL,
	`set_aside_account_id` text,
	`set_aside_goal_id` text,
	`set_aside_start_month` text,
	`already_set_aside_minor` integer DEFAULT 0 NOT NULL,
	`repeats_yearly` integer DEFAULT false NOT NULL,
	`previous_instance_id` text,
	`transaction_id` text,
	`posted_amount_minor` integer,
	`posted_at` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`liability_id`) REFERENCES `liabilities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`set_aside_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`set_aside_goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`previous_instance_id`) REFERENCES `planned_expenses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "planned_expenses_priority_check" CHECK("planned_expenses"."priority" IN ('must', 'should', 'nice')),
	CONSTRAINT "planned_expenses_status_check" CHECK("planned_expenses"."status" IN ('planned', 'funding', 'ready', 'posted', 'deferred', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `idx_planned_due` ON `planned_expenses` (`household_id`,`status`,`due_month`);--> statement-breakpoint
CREATE INDEX `idx_planned_active` ON `planned_expenses` (`household_id`,`due_month`) WHERE "planned_expenses"."status" IN ('planned', 'funding', 'ready');--> statement-breakpoint
CREATE TABLE `document_items` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`raw_text` text,
	`description` text NOT NULL,
	`quantity` real,
	`unit_price_minor` integer,
	`amount_minor` integer NOT NULL,
	`direction` text DEFAULT 'outflow' NOT NULL,
	`booked_on` text,
	`suggested_category_id` text,
	`suggested_category_name` text,
	`confidence` real,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`transaction_id` text,
	`duplicate_of_transaction_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`suggested_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`duplicate_of_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "document_items_direction_check" CHECK("document_items"."direction" IN ('inflow', 'outflow')),
	CONSTRAINT "document_items_review_status_check" CHECK("document_items"."review_status" IN ('pending', 'accepted', 'rejected', 'merged'))
);
--> statement-breakpoint
CREATE INDEX `idx_document_items` ON `document_items` (`document_id`,`line_no`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`original_filename` text NOT NULL,
	`storage_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`page_count` integer,
	`ai_provider` text,
	`ai_model` text,
	`ai_request_id` text,
	`ai_input_tokens` integer,
	`ai_output_tokens` integer,
	`ai_cost_minor` integer,
	`ai_raw_response` text,
	`parsed_summary` text,
	`detected_month_key` text,
	`error_code` text,
	`error_message` text,
	`processed_at` integer,
	`uploaded_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "documents_kind_check" CHECK("documents"."kind" IN ('receipt', 'bank_statement', 'invoice', 'other')),
	CONSTRAINT "documents_status_check" CHECK("documents"."status" IN ('uploaded', 'processing', 'parsed', 'failed', 'committed', 'discarded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_documents_sha` ON `documents` (`household_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `idx_documents_status` ON `documents` (`household_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`booked_on` text NOT NULL,
	`month_key` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'PLN' NOT NULL,
	`account_id` text,
	`counter_account_id` text,
	`category_id` text,
	`income_source_id` text,
	`liability_id` text,
	`goal_id` text,
	`source_allocation_class` text,
	`target_allocation_class` text,
	`allocation_override` text,
	`description` text,
	`merchant` text,
	`notes` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_document_id` text,
	`recurring_occurrence_id` text,
	`planned_expense_id` text,
	`external_ref` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`counter_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`income_source_id`) REFERENCES `income_sources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`liability_id`) REFERENCES `liabilities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recurring_occurrence_id`) REFERENCES `recurring_occurrences`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`planned_expense_id`) REFERENCES `planned_expenses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transactions_type_check" CHECK("transactions"."type" IN ('expense', 'income', 'transfer')),
	CONSTRAINT "transactions_status_check" CHECK("transactions"."status" IN ('posted', 'pending', 'void')),
	CONSTRAINT "transactions_amount_positive_check" CHECK("transactions"."amount_minor" > 0),
	CONSTRAINT "transactions_source_allocation_class_check" CHECK("transactions"."source_allocation_class" IN ('spending', 'savings', 'investment')),
	CONSTRAINT "transactions_target_allocation_class_check" CHECK("transactions"."target_allocation_class" IN ('spending', 'savings', 'investment')),
	CONSTRAINT "transactions_allocation_override_check" CHECK("transactions"."allocation_override" IN ('none', 'savings', 'investment')),
	CONSTRAINT "transactions_source_check" CHECK("transactions"."source" IN ('manual', 'ocr', 'recurring', 'planned', 'import'))
);
--> statement-breakpoint
CREATE INDEX `idx_tx_month` ON `transactions` (`household_id`,`month_key`,`booked_on`);--> statement-breakpoint
CREATE INDEX `idx_tx_account` ON `transactions` (`account_id`,`booked_on`);--> statement-breakpoint
CREATE INDEX `idx_tx_counter` ON `transactions` (`counter_account_id`,`booked_on`);--> statement-breakpoint
CREATE INDEX `idx_tx_category` ON `transactions` (`category_id`,`month_key`);--> statement-breakpoint
CREATE INDEX `idx_tx_allocation` ON `transactions` (`household_id`,`month_key`,`target_allocation_class`,`source_allocation_class`) WHERE "transactions"."type" = 'transfer' AND "transactions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_tx_goal` ON `transactions` (`goal_id`,`month_key`);--> statement-breakpoint
CREATE INDEX `idx_tx_liability` ON `transactions` (`liability_id`,`booked_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tx_external` ON `transactions` (`household_id`,`external_ref`) WHERE "transactions"."external_ref" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
