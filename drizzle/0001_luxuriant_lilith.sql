CREATE TABLE "date_specific_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT 'default' NOT NULL,
	"exception_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "date_specific_exceptions_time_check" CHECK ("date_specific_exceptions"."start_time" < "date_specific_exceptions"."end_time")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "date_specific_exceptions_unique_idx" ON "date_specific_exceptions" USING btree ("user_id","exception_date","start_time","end_time");--> statement-breakpoint
CREATE INDEX "date_specific_exceptions_user_date_idx" ON "date_specific_exceptions" USING btree ("user_id","exception_date");