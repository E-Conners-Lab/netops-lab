CREATE TABLE IF NOT EXISTS `lab_saves` (
	`id` text PRIMARY KEY NOT NULL,
	`progress` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
