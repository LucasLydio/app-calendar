CREATE TABLE "appointments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"service" text NOT NULL,
	"appointment_date" date NOT NULL,
	"appointment_time" time NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"calendar_sync_status" text DEFAULT 'not_queued' NOT NULL,
	"calendar_sync_error" text,
	"calendar_synced_at" timestamp with time zone,
	"google_event_id" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "appointments_status_check" CHECK ("appointments"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "appointments_calendar_sync_status_check" CHECK ("appointments"."calendar_sync_status" IN ('not_queued', 'pending', 'synced', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "availability" (
	"singleton_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"time_zone" text NOT NULL,
	"weekly_slots" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_singleton_check" CHECK ("availability"."singleton_id" = 1)
);
--> statement-breakpoint
CREATE TABLE "calendar_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"appointment_id" text NOT NULL,
	"action" text DEFAULT 'create' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"google_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "calendar_outbox_status_check" CHECK ("calendar_outbox"."status" IN ('pending', 'processing', 'synced', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"browser_id" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "calendar_outbox" ADD CONSTRAINT "calendar_outbox_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_status_date_idx" ON "appointments" USING btree ("status","appointment_date","appointment_time");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_active_slot_unique_idx" ON "appointments" USING btree ("appointment_date","appointment_time") WHERE "appointments"."status" IN ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "calendar_outbox_due_idx" ON "calendar_outbox" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_outbox_active_appointment_idx" ON "calendar_outbox" USING btree ("appointment_id") WHERE "calendar_outbox"."status" IN ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");