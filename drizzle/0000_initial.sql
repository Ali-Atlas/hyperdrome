CREATE TYPE "public"."action_status" AS ENUM('pending', 'applied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('committed', 'settled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."bootstrap_state" AS ENUM('none', 'account', 'minted', 'done');--> statement-breakpoint
CREATE TABLE "accounts" (
	"userId" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method" varchar(40) NOT NULL,
	"seq" bigint,
	"args" jsonb,
	"tx_hash" varchar(64),
	"status" "action_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_config" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"slot" bigint PRIMARY KEY NOT NULL,
	"seed_hash" varchar(64) NOT NULL,
	"seed_enc" text,
	"seed" varchar(64),
	"status" "batch_status" DEFAULT 'committed' NOT NULL,
	"commit_tx" varchar(64),
	"settle_txs" jsonb,
	"committed_at" timestamp with time zone,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cron_ticks" (
	"slot" bigint PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drone_mods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"drone_id" uuid NOT NULL,
	"mod_id" uuid NOT NULL,
	"is_equipped" boolean DEFAULT false NOT NULL,
	CONSTRAINT "uniq_drone_mod" UNIQUE("drone_id","mod_id")
);
--> statement-breakpoint
CREATE TABLE "drone_ownership_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drone_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"start_date" timestamp with time zone DEFAULT now() NOT NULL,
	"end_date" timestamp with time zone,
	"transaction_type" varchar(20),
	"price_paid" integer
);
--> statement-breakpoint
CREATE TABLE "drone_skins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"drone_id" uuid NOT NULL,
	"skin_id" uuid NOT NULL,
	"is_equipped" boolean DEFAULT false NOT NULL,
	CONSTRAINT "uniq_drone_skin" UNIQUE("drone_id","skin_id")
);
--> statement-breakpoint
CREATE TABLE "drones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"name" varchar(100) NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"xp_to_next_level" integer DEFAULT 200 NOT NULL,
	"total_stat_budget" integer DEFAULT 29 NOT NULL,
	"unspent_points" integer DEFAULT 20 NOT NULL,
	"total_points_invested" integer DEFAULT 0 NOT NULL,
	"speed" integer DEFAULT 1 NOT NULL,
	"turning" integer DEFAULT 1 NOT NULL,
	"acceleration" integer DEFAULT 1 NOT NULL,
	"durability" integer DEFAULT 1 NOT NULL,
	"night_vision" integer DEFAULT 1 NOT NULL,
	"battery_capacity" integer DEFAULT 1 NOT NULL,
	"rain_handling" integer DEFAULT 1 NOT NULL,
	"wind_resistance" integer DEFAULT 1 NOT NULL,
	"consistency" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"total_races" integer DEFAULT 0 NOT NULL,
	"elo_rating" integer DEFAULT 1000 NOT NULL,
	"image_url" text DEFAULT '/drones/default.png' NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"applied_skin_id" uuid,
	"applied_mod_id" uuid,
	"token_id" varchar(32),
	"chain_synced_at" timestamp with time zone,
	CONSTRAINT "drones_token_id_unique" UNIQUE("token_id")
);
--> statement-breakpoint
CREATE TABLE "marketplace_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seller_id" uuid NOT NULL,
	"item_type" varchar(10) NOT NULL,
	"drone_id" uuid,
	"skin_id" uuid,
	"mod_id" uuid,
	"price" integer NOT NULL,
	"status" varchar(15) DEFAULT 'active' NOT NULL,
	"buyer_id" uuid,
	"sold_at" timestamp with time zone,
	"platform_fee" integer
);
--> statement-breakpoint
CREATE TABLE "mods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"name" varchar(100) NOT NULL,
	"rarity" varchar(15) NOT NULL,
	"description" varchar(500),
	"stat_bonus_type" varchar(50),
	"stat_bonus_value" numeric(5, 2),
	"stat_penalty_type" varchar(50),
	"stat_penalty_value" numeric(5, 2),
	"special_ability" varchar(500),
	"image_url" varchar(500),
	"template" smallint,
	"token_id" varchar(32),
	"chain_synced_at" timestamp with time zone,
	CONSTRAINT "mods_token_id_unique" UNIQUE("token_id")
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(15) DEFAULT 'completed' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"drone1_id" uuid NOT NULL,
	"drone2_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"winner_drone_id" uuid,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"loser_points_awarded" integer,
	"xp_winner" integer DEFAULT 10 NOT NULL,
	"xp_loser" integer DEFAULT 4 NOT NULL,
	"time_of_day" varchar(10) NOT NULL,
	"weather" varchar(15) NOT NULL,
	"drone1_time" numeric(10, 4),
	"drone2_time" numeric(10, 4),
	"drone1_elo_before" integer DEFAULT 1000 NOT NULL,
	"drone2_elo_before" integer DEFAULT 1000 NOT NULL,
	"drone1_elo_change" integer DEFAULT 0 NOT NULL,
	"drone2_elo_change" integer DEFAULT 0 NOT NULL,
	"race_log" jsonb,
	"batch_slot" bigint,
	"race_index" integer,
	"seed" varchar(64),
	"snapshot_a" jsonb,
	"snapshot_b" jsonb,
	"settle_tx" varchar(64),
	"log" jsonb,
	CONSTRAINT "uniq_races_batch_race" UNIQUE("batch_slot","race_index")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_number" integer NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	CONSTRAINT "seasons_season_number_unique" UNIQUE("season_number")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"name" varchar(100) NOT NULL,
	"rarity" varchar(15) NOT NULL,
	"image_url" text NOT NULL,
	"description" text,
	"template" smallint,
	"token_id" varchar(32),
	"chain_synced_at" timestamp with time zone,
	CONSTRAINT "skins_token_id_unique" UNIQUE("token_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"persona" jsonb,
	"reserve" text
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"straights" integer NOT NULL,
	"turns" integer NOT NULL,
	"laps" integer DEFAULT 3 NOT NULL,
	"length" varchar(10) NOT NULL,
	"difficulty" integer NOT NULL,
	"level_min" integer DEFAULT 1 NOT NULL,
	"level_max" integer DEFAULT 20 NOT NULL,
	"image_url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"username" varchar(50),
	"email" varchar(255) NOT NULL,
	"name" text,
	"emailVerified" timestamp,
	"image" text,
	"points" integer DEFAULT 0 NOT NULL,
	"total_races" integer DEFAULT 0 NOT NULL,
	"total_wins" integer DEFAULT 0 NOT NULL,
	"elo_rating" integer DEFAULT 1000 NOT NULL,
	"season_points" integer DEFAULT 0 NOT NULL,
	"active_drone_slots" integer DEFAULT 1 NOT NULL,
	"image_url" text,
	"near_account_id" varchar(64),
	"play_key_enc" text,
	"admin_key_enc" text,
	"key_version" integer,
	"is_team" boolean DEFAULT false NOT NULL,
	"team_persona" jsonb,
	"bootstrap_state" "bootstrap_state" DEFAULT 'none' NOT NULL,
	"bootstrap_pending" jsonb,
	"bootstrap_claimed_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_near_account_id_unique" UNIQUE("near_account_id")
);
--> statement-breakpoint
CREATE TABLE "verification_token" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drone_mods" ADD CONSTRAINT "drone_mods_drone_id_drones_id_fk" FOREIGN KEY ("drone_id") REFERENCES "public"."drones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drone_mods" ADD CONSTRAINT "drone_mods_mod_id_mods_id_fk" FOREIGN KEY ("mod_id") REFERENCES "public"."mods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drone_ownership_history" ADD CONSTRAINT "drone_ownership_history_drone_id_drones_id_fk" FOREIGN KEY ("drone_id") REFERENCES "public"."drones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drone_ownership_history" ADD CONSTRAINT "drone_ownership_history_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drone_skins" ADD CONSTRAINT "drone_skins_drone_id_drones_id_fk" FOREIGN KEY ("drone_id") REFERENCES "public"."drones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drone_skins" ADD CONSTRAINT "drone_skins_skin_id_skins_id_fk" FOREIGN KEY ("skin_id") REFERENCES "public"."skins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drones" ADD CONSTRAINT "drones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drones" ADD CONSTRAINT "drones_applied_skin_id_skins_id_fk" FOREIGN KEY ("applied_skin_id") REFERENCES "public"."skins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drones" ADD CONSTRAINT "drones_applied_mod_id_mods_id_fk" FOREIGN KEY ("applied_mod_id") REFERENCES "public"."mods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_drone_id_drones_id_fk" FOREIGN KEY ("drone_id") REFERENCES "public"."drones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_skin_id_skins_id_fk" FOREIGN KEY ("skin_id") REFERENCES "public"."skins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_mod_id_mods_id_fk" FOREIGN KEY ("mod_id") REFERENCES "public"."mods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mods" ADD CONSTRAINT "mods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_drone1_id_drones_id_fk" FOREIGN KEY ("drone1_id") REFERENCES "public"."drones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_drone2_id_drones_id_fk" FOREIGN KEY ("drone2_id") REFERENCES "public"."drones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_winner_drone_id_drones_id_fk" FOREIGN KEY ("winner_drone_id") REFERENCES "public"."drones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skins" ADD CONSTRAINT "skins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_actions_user_id" ON "actions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_drone_mods_drone_id" ON "drone_mods" USING btree ("drone_id");--> statement-breakpoint
CREATE INDEX "idx_drone_mods_mod_id" ON "drone_mods" USING btree ("mod_id");--> statement-breakpoint
CREATE INDEX "idx_ownership_drone_id" ON "drone_ownership_history" USING btree ("drone_id");--> statement-breakpoint
CREATE INDEX "idx_drone_skins_drone_id" ON "drone_skins" USING btree ("drone_id");--> statement-breakpoint
CREATE INDEX "idx_drone_skins_skin_id" ON "drone_skins" USING btree ("skin_id");--> statement-breakpoint
CREATE INDEX "idx_drones_user_id" ON "drones" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_drones_level" ON "drones" USING btree ("level");--> statement-breakpoint
CREATE INDEX "idx_drones_active" ON "drones" USING btree ("active");--> statement-breakpoint
CREATE INDEX "idx_drones_is_bot" ON "drones" USING btree ("is_bot");--> statement-breakpoint
CREATE INDEX "idx_drones_elo_rating" ON "drones" USING btree ("elo_rating");--> statement-breakpoint
CREATE INDEX "idx_marketplace_status" ON "marketplace_listings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_marketplace_item_type" ON "marketplace_listings" USING btree ("item_type");--> statement-breakpoint
CREATE INDEX "idx_marketplace_seller_id" ON "marketplace_listings" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "idx_marketplace_buyer_id" ON "marketplace_listings" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "idx_mods_user_id" ON "mods" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_mods_rarity" ON "mods" USING btree ("rarity");--> statement-breakpoint
CREATE INDEX "idx_races_drone1_id" ON "races" USING btree ("drone1_id");--> statement-breakpoint
CREATE INDEX "idx_races_drone2_id" ON "races" USING btree ("drone2_id");--> statement-breakpoint
CREATE INDEX "idx_races_created_at" ON "races" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_races_winner_drone_id" ON "races" USING btree ("winner_drone_id");--> statement-breakpoint
CREATE INDEX "idx_races_status" ON "races" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_races_scheduled_at" ON "races" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_skins_user_id" ON "skins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_skins_rarity" ON "skins" USING btree ("rarity");