CREATE TABLE `academic_item_overrides` (
	`academic_item_id` text PRIMARY KEY NOT NULL,
	`status` text,
	`due_at` integer,
	`due_at_overridden` integer DEFAULT false NOT NULL,
	`subject_id` text,
	`subject_overridden` integer DEFAULT false NOT NULL,
	`user_note` text,
	`dismissed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`academic_item_id`) REFERENCES `academic_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`source_id` text,
	`academic_item_id` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`acknowledged_at` integer,
	`resolved_at` integer,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`academic_item_id`) REFERENCES `academic_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_fingerprint_unique` ON `alerts` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `alerts_status_last_seen_idx` ON `alerts` (`status`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `sync_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`requested_at` integer NOT NULL,
	`claimed_at` integer,
	`finished_at` integer,
	`lease_id` text,
	`result_json` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `sync_requests_status_requested_idx` ON `sync_requests` (`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `worker_status` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`version` text NOT NULL,
	`cycle_started_at` integer,
	`cycle_finished_at` integer,
	`next_sync_at` integer,
	`heartbeat_at` integer NOT NULL,
	`last_error` text,
	`provider_statuses_json` text DEFAULT '[]' NOT NULL
);
