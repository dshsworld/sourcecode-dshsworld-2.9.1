ALTER TABLE `scenes` ADD `building` text DEFAULT '본관' NOT NULL;--> statement-breakpoint
ALTER TABLE `scenes` ADD `map_x` real;--> statement-breakpoint
ALTER TABLE `scenes` ADD `map_y` real;--> statement-breakpoint
ALTER TABLE `scenes` ADD `elevator_group` text;