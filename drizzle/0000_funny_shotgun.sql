CREATE TABLE `academic_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`source_external_id` text NOT NULL,
	`subject_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`starts_at` integer,
	`due_at` integer,
	`status` text DEFAULT 'inbox' NOT NULL,
	`evidence` text NOT NULL,
	`confidence` integer DEFAULT 100 NOT NULL,
	`source_url` text,
	`source_snapshot_hash` text,
	`raw_json` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`actor` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`subject_id` text,
	`academic_item_id` text,
	`name` text NOT NULL,
	`mime_type` text,
	`storage_key` text NOT NULL,
	`checksum` text NOT NULL,
	`source_url` text,
	`extracted_text` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`academic_item_id`) REFERENCES `academic_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`display_name` text NOT NULL,
	`base_url` text,
	`status` text DEFAULT 'unconfigured' NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`color` text,
	`teacher_names_json` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_normalized_name_unique` ON `subjects` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`status` text NOT NULL,
	`discovered_count` integer DEFAULT 0 NOT NULL,
	`changed_count` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error_summary` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
