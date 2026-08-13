CREATE TABLE `staged_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`checksum` text NOT NULL,
	`academic_item_id` text,
	`match_confidence` integer,
	`match_reason` text,
	`status` text DEFAULT 'staged' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`academic_item_id`) REFERENCES `academic_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staged_uploads_object_key_unique` ON `staged_uploads` (`object_key`);