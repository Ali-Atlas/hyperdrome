CREATE TABLE "wallet_challenges" (
	"nonce" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"message" text NOT NULL,
	"recipient" text NOT NULL,
	"wallet" varchar(64),
	"used_at" timestamp with time zone,
	"linked_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_challenges" ADD CONSTRAINT "wallet_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_wallet_challenges_user_id" ON "wallet_challenges" USING btree ("user_id");