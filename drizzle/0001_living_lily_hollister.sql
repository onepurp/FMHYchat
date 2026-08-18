CREATE TABLE `fmhy_protection_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`minuteStartedAt` timestamp NOT NULL,
	`kind` varchar(64) NOT NULL,
	`count` int NOT NULL,
	CONSTRAINT `fmhy_protection_metrics_id` PRIMARY KEY(`id`),
	CONSTRAINT `fmhy_protection_metric_minute_kind_unique` UNIQUE(`minuteStartedAt`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `fmhy_rate_buckets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scope` varchar(16) NOT NULL,
	`subjectHash` varchar(64) NOT NULL,
	`windowStartedAt` timestamp NOT NULL,
	`requestCount` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `fmhy_rate_buckets_id` PRIMARY KEY(`id`),
	CONSTRAINT `fmhy_rate_bucket_scope_subject_window_unique` UNIQUE(`scope`,`subjectHash`,`windowStartedAt`)
);
--> statement-breakpoint
CREATE TABLE `fmhy_search_leases` (
	`leaseId` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `fmhy_search_leases_leaseId` PRIMARY KEY(`leaseId`)
);
--> statement-breakpoint
CREATE TABLE `fmhy_source_cache` (
	`pageUrl` varchar(512) NOT NULL,
	`resourcesJson` mediumtext,
	`freshUntil` timestamp,
	`refreshLeaseId` varchar(64),
	`refreshLeaseUntil` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fmhy_source_cache_pageUrl` PRIMARY KEY(`pageUrl`)
);
--> statement-breakpoint
CREATE INDEX `fmhy_protection_metric_minute_idx` ON `fmhy_protection_metrics` (`minuteStartedAt`);--> statement-breakpoint
CREATE INDEX `fmhy_rate_bucket_expires_idx` ON `fmhy_rate_buckets` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `fmhy_search_lease_expires_idx` ON `fmhy_search_leases` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `fmhy_source_cache_fresh_idx` ON `fmhy_source_cache` (`freshUntil`);--> statement-breakpoint
CREATE INDEX `fmhy_source_cache_refresh_idx` ON `fmhy_source_cache` (`refreshLeaseUntil`);