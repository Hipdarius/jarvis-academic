ALTER TABLE `documents` ADD `source_path` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `academic_period` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `topic_path_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `classification_confidence` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `classification_reason` text;--> statement-breakpoint
ALTER TABLE `staged_uploads` ADD `subject_id` text REFERENCES subjects(id);--> statement-breakpoint
ALTER TABLE `staged_uploads` ADD `academic_period` text;--> statement-breakpoint
ALTER TABLE `staged_uploads` ADD `topic_path_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `staged_uploads` ADD `classification_confidence` integer;--> statement-breakpoint
ALTER TABLE `staged_uploads` ADD `classification_reason` text;