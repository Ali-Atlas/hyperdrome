CREATE TYPE "public"."pack_open_status" AS ENUM('pending', 'committed', 'revealed');--> statement-breakpoint
CREATE TABLE "pack_opens" (
	"action_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"pack_id" bigint,
	"kind" varchar(4) NOT NULL,
	"tier" smallint NOT NULL,
	"secret_enc" text NOT NULL,
	"status" "pack_open_status" DEFAULT 'pending' NOT NULL,
	"commit_tx" varchar(64),
	"reveal_tx" varchar(64),
	"tokens" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pack_opens_pack_id_unique" UNIQUE("pack_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_bucket_window_start_pk" PRIMARY KEY("bucket","window_start")
);
--> statement-breakpoint
ALTER TABLE "demo_signups" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "demo_signups" CASCADE;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "http_status" integer;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD COLUMN "token_id" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "action_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pack_opens" ADD CONSTRAINT "pack_opens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pack_opens_user_id" ON "pack_opens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_marketplace_token_id" ON "marketplace_listings" USING btree ("token_id");