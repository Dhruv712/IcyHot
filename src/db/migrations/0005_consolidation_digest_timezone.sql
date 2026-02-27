ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "time_zone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consolidation_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"digest_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"run_started_at" timestamp NOT NULL,
	"run_completed_at" timestamp NOT NULL,
	"clusters_processed" integer DEFAULT 0 NOT NULL,
	"anti_clusters_processed" integer DEFAULT 0 NOT NULL,
	"connections_created" integer DEFAULT 0 NOT NULL,
	"connections_strengthened" integer DEFAULT 0 NOT NULL,
	"implications_created" integer DEFAULT 0 NOT NULL,
	"implications_reinforced" integer DEFAULT 0 NOT NULL,
	"implications_filtered" integer DEFAULT 0 NOT NULL,
	"summary" text NOT NULL,
	"details" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consolidation_digests" ADD CONSTRAINT "consolidation_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "consolidation_digests_user_date" ON "consolidation_digests" USING btree ("user_id","digest_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consolidation_digests_user_created_idx" ON "consolidation_digests" USING btree ("user_id","created_at");
