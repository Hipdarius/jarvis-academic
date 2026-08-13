CREATE TABLE `agent_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`input_json` text NOT NULL,
	`result_json` text,
	`provider` text,
	`model` text,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE TABLE `knowledge_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`subject` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_canvases` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`brief` text NOT NULL,
	`subject` text NOT NULL,
	`status` text DEFAULT 'idea' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worker_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worker_tokens_token_hash_unique` ON `worker_tokens` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `academic_items_source_external_unique` ON `academic_items` (`source_id`,`source_external_id`);