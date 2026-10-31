ALTER TABLE "appointments" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "service_name" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "service_price" integer;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "service_duration" integer;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_service_id_idx" ON "appointments" USING btree ("service_id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_price_check" CHECK ("appointments"."service_price" IS NULL OR "appointments"."service_price" >= 0);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_duration_check" CHECK ("appointments"."service_duration" IS NULL OR "appointments"."service_duration" > 0);