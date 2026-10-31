CREATE TABLE "appointment_push_subscriptions" (
	"appointment_id" text NOT NULL,
	"browser_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_push_subscriptions_appointment_id_browser_id_pk" PRIMARY KEY("appointment_id","browser_id")
);
--> statement-breakpoint
ALTER TABLE "appointment_push_subscriptions" ADD CONSTRAINT "appointment_push_subscriptions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_push_subscriptions" ADD CONSTRAINT "appointment_push_subscriptions_browser_id_push_subscriptions_browser_id_fk" FOREIGN KEY ("browser_id") REFERENCES "public"."push_subscriptions"("browser_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_push_subscriptions_browser_idx" ON "appointment_push_subscriptions" USING btree ("browser_id");