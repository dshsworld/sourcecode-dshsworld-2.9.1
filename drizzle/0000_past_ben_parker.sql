CREATE TABLE `hidden_demo_links` (
	`id` integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_scene` text NOT NULL,
	`to_scene` text NOT NULL,
	`yaw` real NOT NULL,
	`pitch` real DEFAULT -18 NOT NULL,
	`label` text NOT NULL,
	`kind` text DEFAULT 'walk' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_links_from_scene` ON `links` (`from_scene`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_links_unique_position` ON `links` (`from_scene`,`to_scene`,`yaw`,`pitch`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`ip_hash` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`floor` text NOT NULL,
	`node_type` text NOT NULL,
	`image_8k` text NOT NULL,
	`image_4k` text NOT NULL,
	`thumb` text,
	`original_key` text,
	`initial_yaw` real DEFAULT 0 NOT NULL,
	`initial_pitch` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
