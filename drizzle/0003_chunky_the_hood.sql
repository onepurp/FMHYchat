CREATE TABLE `fmhy_protection_circuit` (
	`provider` varchar(32) NOT NULL,
	`failureCount` int NOT NULL,
	`failureWindowStartedAt` timestamp,
	`openUntil` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fmhy_protection_circuit_provider` PRIMARY KEY(`provider`)
);
--> statement-breakpoint
CREATE TABLE `fmhy_protection_policy` (
	`id` int NOT NULL,
	`revision` int NOT NULL,
	`clientRequestsPerMinute` int NOT NULL,
	`globalSearchesPerMinute` int NOT NULL,
	`maxConcurrency` int NOT NULL,
	`maxWaitingRequests` int NOT NULL,
	`maxQueueWaitMs` int NOT NULL,
	`circuitFailureThreshold` int NOT NULL,
	`circuitCooldownMaxSeconds` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fmhy_protection_policy_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
INSERT INTO `fmhy_protection_policy` (
  `id`, `revision`, `clientRequestsPerMinute`, `globalSearchesPerMinute`, `maxConcurrency`,
  `maxWaitingRequests`, `maxQueueWaitMs`, `circuitFailureThreshold`, `circuitCooldownMaxSeconds`
) VALUES (1, 1, 3, 6, 2, 10, 4000, 2, 60);
