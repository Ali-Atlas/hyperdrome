CREATE TABLE "catalog_templates" (
	"kind" varchar(4) NOT NULL,
	"template" smallint NOT NULL,
	"name" varchar(100) NOT NULL,
	"rarity" varchar(15) NOT NULL,
	"image_url" text,
	"cap" integer,
	"data" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_templates_kind_template_pk" PRIMARY KEY("kind","template")
);
