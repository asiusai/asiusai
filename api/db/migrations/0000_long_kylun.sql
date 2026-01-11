CREATE TABLE `athena_pings` (
	`id` text PRIMARY KEY NOT NULL,
	`dongle_id` text NOT NULL,
	`create_time` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `athena_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`dongle_id` text NOT NULL,
	`method` text NOT NULL,
	`params` text NOT NULL,
	`expiry` integer,
	`create_time` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `device_users` (
	`user_id` text NOT NULL,
	`dongle_id` text NOT NULL,
	`permission` text NOT NULL,
	`create_time` integer NOT NULL,
	PRIMARY KEY(`user_id`, `dongle_id`)
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`dongle_id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`alias` text,
	`device_type` text,
	`ignore_uploads` integer,
	`openpilot_version` text,
	`serial` text NOT NULL,
	`imei` text NOT NULL,
	`imei2` text NOT NULL,
	`created_time` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_public_key_unique` ON `devices` (`public_key`);--> statement-breakpoint
CREATE TABLE `files` (
	`key` text PRIMARY KEY NOT NULL,
	`dongle_id` text NOT NULL,
	`route_id` text,
	`segment` integer,
	`file` text NOT NULL,
	`size` integer NOT NULL,
	`processing_status` text DEFAULT 'queued' NOT NULL,
	`processing_error` text,
	`create_time` integer NOT NULL,
	`updated_time` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `logs` (
	`id` text PRIMARY KEY NOT NULL,
	`dongle_id` text NOT NULL,
	`raw` text NOT NULL,
	`create_time` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `route_settings` (
	`dongle_id` text NOT NULL,
	`route_id` text NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`is_preserved` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`dongle_id`, `route_id`)
);
--> statement-breakpoint
CREATE TABLE `segments` (
	`dongle_id` text NOT NULL,
	`route_id` text NOT NULL,
	`segment` integer NOT NULL,
	`start_time` integer,
	`end_time` integer,
	`start_lat` real,
	`start_lng` real,
	`end_lat` real,
	`end_lng` real,
	`distance` real,
	`version` text,
	`git_branch` text,
	`git_commit` text,
	`git_commit_date` text,
	`git_dirty` integer,
	`git_remote` text,
	`platform` text,
	`vin` text,
	`create_time` integer NOT NULL,
	PRIMARY KEY(`dongle_id`, `route_id`, `segment`)
);
--> statement-breakpoint
CREATE TABLE `stats` (
	`id` text PRIMARY KEY NOT NULL,
	`dongle_id` text NOT NULL,
	`raw` text NOT NULL,
	`create_time` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `uptime` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event` text NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`regdate` integer NOT NULL,
	`superuser` integer NOT NULL,
	`user_id` text NOT NULL,
	`username` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);