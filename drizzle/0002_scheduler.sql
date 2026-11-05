ALTER TABLE "batches" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "drones" ADD COLUMN "in_batch" bigint;