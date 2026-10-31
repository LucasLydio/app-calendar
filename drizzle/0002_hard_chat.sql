CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_name_check" CHECK (char_length(trim("services"."name")) > 0),
	CONSTRAINT "services_price_check" CHECK ("services"."price_cents" >= 0),
	CONSTRAINT "services_duration_check" CHECK ("services"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE INDEX "services_created_at_idx" ON "services" USING btree ("created_at");