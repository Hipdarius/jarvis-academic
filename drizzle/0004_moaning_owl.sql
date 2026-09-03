ALTER TABLE `staged_uploads` ADD `extracted_text` text;--> statement-breakpoint
ALTER TABLE `staged_uploads` ADD `extractor` text;--> statement-breakpoint
ALTER TABLE `staged_uploads` ADD `page_count` integer;--> statement-breakpoint
ALTER TABLE `staged_uploads` ADD `processing_message` text;--> statement-breakpoint
ALTER TABLE `staged_uploads` ADD `processing_lease_id` text;--> statement-breakpoint
ALTER TABLE `staged_uploads` ADD `processing_started_at` integer;--> statement-breakpoint
ALTER TABLE `staged_uploads` ADD `processing_finished_at` integer;--> statement-breakpoint
ALTER TABLE `staged_uploads` ADD `attempt_count` integer DEFAULT 0 NOT NULL;