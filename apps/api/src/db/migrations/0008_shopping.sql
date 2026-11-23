/*
 Listy zakupów (Faza 10, ADR-093…097): tabele shopping_lists, shopping_products,
 shopping_items, shopping_imports, shopping_import_items z 03 §3.23–3.27
 oraz households.shopping_initialized_at (03 §3.1). Tylko struktura — zestaw startowy
 zakłada serwis przy pierwszym wejściu w Zakupy (07 §14.6), nie migracja.
*/
CREATE TABLE `shopping_import_items` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`import_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`name` text NOT NULL,
	`source_text` text NOT NULL,
	`quantity_milli` integer,
	`unit` text,
	`quantity_overridden` integer DEFAULT false NOT NULL,
	`base_amount_milli` integer,
	`base_unit` text,
	`package_amount_milli` integer,
	`package_label` text,
	`pantry_staple` integer DEFAULT false NOT NULL,
	`section` text NOT NULL,
	`confidence_bps` integer NOT NULL,
	`already_have` integer DEFAULT false NOT NULL,
	`selected` integer DEFAULT true NOT NULL,
	`merge_into_item_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `shopping_imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merge_into_item_id`) REFERENCES `shopping_items`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "shopping_import_items_name_check" CHECK(length("shopping_import_items"."name") BETWEEN 1 AND 80),
	CONSTRAINT "shopping_import_items_quantity_check" CHECK("shopping_import_items"."quantity_milli" IS NULL OR "shopping_import_items"."quantity_milli" > 0),
	CONSTRAINT "shopping_import_items_unit_check" CHECK("shopping_import_items"."unit" IN ('pcs', 'pack', 'kg', 'g', 'l', 'ml')),
	CONSTRAINT "shopping_import_items_quantity_unit_check" CHECK(("shopping_import_items"."quantity_milli" IS NULL) = ("shopping_import_items"."unit" IS NULL)),
	CONSTRAINT "shopping_import_items_base_unit_check" CHECK("shopping_import_items"."base_unit" IN ('g', 'ml', 'pcs')),
	CONSTRAINT "shopping_import_items_amounts_check" CHECK(("shopping_import_items"."base_amount_milli" IS NULL OR "shopping_import_items"."base_amount_milli" > 0) AND ("shopping_import_items"."package_amount_milli" IS NULL OR "shopping_import_items"."package_amount_milli" > 0)),
	CONSTRAINT "shopping_import_items_section_check" CHECK("shopping_import_items"."section" IN ('produce', 'bakery', 'dairy', 'meat_fish', 'dry_goods', 'frozen', 'drinks', 'household_chemicals', 'hygiene', 'home', 'other')),
	CONSTRAINT "shopping_import_items_confidence_check" CHECK("shopping_import_items"."confidence_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE INDEX `idx_shopping_import_items_import` ON `shopping_import_items` (`import_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `shopping_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`list_id` text NOT NULL,
	`kind` text NOT NULL,
	`input` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`source_url` text,
	`source_text` text,
	`file_paths` text DEFAULT '[]' NOT NULL,
	`servings_factor_bps` integer,
	`recipe_title` text,
	`base_servings` integer,
	`notes` text,
	`ai_model` text,
	`ai_raw_response` text,
	`cost_minor` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shopping_imports_kind_check" CHECK("shopping_imports"."kind" IN ('list_photo', 'recipe')),
	CONSTRAINT "shopping_imports_input_check" CHECK("shopping_imports"."input" IN ('image', 'url', 'text')),
	CONSTRAINT "shopping_imports_status_check" CHECK("shopping_imports"."status" IN ('processing', 'parsed', 'committed', 'discarded', 'failed')),
	CONSTRAINT "shopping_imports_factor_check" CHECK("shopping_imports"."servings_factor_bps" IS NULL OR "shopping_imports"."servings_factor_bps" BETWEEN 2500 AND 40000)
);
--> statement-breakpoint
CREATE INDEX `idx_shopping_imports_status` ON `shopping_imports` (`household_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `shopping_items` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`list_id` text NOT NULL,
	`product_id` text,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`quantity_milli` integer,
	`unit` text,
	`note` text,
	`section` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`import_id` text,
	`checked_at` integer,
	`checked_by` text,
	`cleared_at` integer,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `shopping_products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_id`) REFERENCES `shopping_imports`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`checked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "shopping_items_name_check" CHECK(length("shopping_items"."name") BETWEEN 1 AND 80),
	CONSTRAINT "shopping_items_quantity_check" CHECK("shopping_items"."quantity_milli" IS NULL OR "shopping_items"."quantity_milli" > 0),
	CONSTRAINT "shopping_items_unit_check" CHECK("shopping_items"."unit" IN ('pcs', 'pack', 'kg', 'g', 'l', 'ml')),
	CONSTRAINT "shopping_items_quantity_unit_check" CHECK(("shopping_items"."quantity_milli" IS NULL) = ("shopping_items"."unit" IS NULL)),
	CONSTRAINT "shopping_items_note_check" CHECK("shopping_items"."note" IS NULL OR length("shopping_items"."note") <= 120),
	CONSTRAINT "shopping_items_section_check" CHECK("shopping_items"."section" IN ('produce', 'bakery', 'dairy', 'meat_fish', 'dry_goods', 'frozen', 'drinks', 'household_chemicals', 'hygiene', 'home', 'other')),
	CONSTRAINT "shopping_items_source_check" CHECK("shopping_items"."source" IN ('manual', 'list_photo', 'recipe')),
	CONSTRAINT "shopping_items_cleared_check" CHECK("shopping_items"."cleared_at" IS NULL OR "shopping_items"."checked_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_shopping_items_list` ON `shopping_items` (`household_id`,`list_id`,`cleared_at`,`checked_at`);--> statement-breakpoint
CREATE INDEX `idx_shopping_items_name` ON `shopping_items` (`household_id`,`list_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `shopping_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "shopping_lists_name_check" CHECK(length("shopping_lists"."name") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_shopping_lists_default` ON `shopping_lists` (`household_id`) WHERE "shopping_lists"."is_default" = 1;--> statement-breakpoint
CREATE INDEX `idx_shopping_lists_household` ON `shopping_lists` (`household_id`,`archived_at`,`sort_order`);--> statement-breakpoint
CREATE TABLE `shopping_products` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`section` text NOT NULL,
	`is_staple` integer DEFAULT false NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shopping_products_name_check" CHECK(length("shopping_products"."name") BETWEEN 1 AND 80),
	CONSTRAINT "shopping_products_section_check" CHECK("shopping_products"."section" IN ('produce', 'bakery', 'dairy', 'meat_fish', 'dry_goods', 'frozen', 'drinks', 'household_chemicals', 'hygiene', 'home', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_shopping_products_name` ON `shopping_products` (`household_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `idx_shopping_products_usage` ON `shopping_products` (`household_id`,`last_used_at`);--> statement-breakpoint
ALTER TABLE `households` ADD `shopping_initialized_at` integer;