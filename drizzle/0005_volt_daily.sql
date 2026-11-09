CREATE TABLE "volt_daily" (
	"day" date PRIMARY KEY NOT NULL,
	"minted" bigint DEFAULT 0 NOT NULL,
	"burned" bigint DEFAULT 0 NOT NULL
);
