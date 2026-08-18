ALTER TABLE `fmhy_search_leases` ADD `status` enum('waiting','active') DEFAULT 'waiting' NOT NULL;--> statement-breakpoint
ALTER TABLE `fmhy_search_leases` ADD `createdAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
CREATE INDEX `fmhy_search_lease_status_idx` ON `fmhy_search_leases` (`status`,`createdAt`);