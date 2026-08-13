CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`job_id` text,
	`sender` text NOT NULL,
	`recipient` text NOT NULL,
	`kind` text NOT NULL,
	`content_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `agent_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`source_id` text,
	`subject_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`objective` text NOT NULL,
	`budget_jobs` integer DEFAULT 3 NOT NULL,
	`budget_tokens` integer DEFAULT 6000 NOT NULL,
	`used_jobs` integer DEFAULT 0 NOT NULL,
	`used_tokens` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `improvement_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`title` text NOT NULL,
	`rationale` text NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`scope_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`branch_name` text,
	`implementation_summary` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `study_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`academic_item_id` text,
	`subject_id` text,
	`title` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`generated_by` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`academic_item_id`) REFERENCES `academic_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `agent_jobs` ADD `run_id` text REFERENCES agent_runs(id);--> statement-breakpoint
ALTER TABLE `agent_jobs` ADD `parent_job_id` text;--> statement-breakpoint
ALTER TABLE `agent_jobs` ADD `agent_role` text DEFAULT 'planner' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_jobs` ADD `token_budget` integer DEFAULT 2400 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_jobs` ADD `usage_json` text;--> statement-breakpoint
CREATE UNIQUE INDEX `documents_source_external_unique` ON `documents` (`source_id`,`storage_key`);