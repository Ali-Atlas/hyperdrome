CREATE TABLE "economy_snapshots" (
	"slot" bigint PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"teams" jsonb NOT NULL,
	"supply" bigint,
	"minted" bigint NOT NULL,
	"burned" bigint NOT NULL,
	"open_listings" integer NOT NULL,
	"trades" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_decisions" (
	"action_id" uuid PRIMARY KEY NOT NULL,
	"team_user_id" uuid NOT NULL,
	"slot" bigint NOT NULL,
	"step" varchar(10) NOT NULL,
	"subject" varchar(64) NOT NULL,
	"method" varchar(32) NOT NULL,
	"tx_hash" text,
	"status" varchar(10) NOT NULL,
	"reason" text NOT NULL,
	"numbers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_decisions" ADD CONSTRAINT "team_decisions_team_user_id_users_id_fk" FOREIGN KEY ("team_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_economy_snapshots_at" ON "economy_snapshots" USING btree ("at");--> statement-breakpoint
CREATE INDEX "idx_team_decisions_created_at" ON "team_decisions" USING btree ("created_at");