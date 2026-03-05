CREATE TABLE IF NOT EXISTS "journal_state_frames" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "entry_date" date NOT NULL,
  "entry_id" uuid,
  "state_vector" jsonb NOT NULL,
  "taxonomy_version" text DEFAULT 'core10_v1' NOT NULL,
  "content_hash" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "journal_state_frames" ADD CONSTRAINT "journal_state_frames_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "journal_state_frames" ADD CONSTRAINT "journal_state_frames_entry_id_journal_drafts_id_fk"
    FOREIGN KEY ("entry_id") REFERENCES "public"."journal_drafts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journal_state_frames_user_date_idx" ON "journal_state_frames" USING btree ("user_id", "entry_date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journal_state_frames_user_entry_idx" ON "journal_state_frames" USING btree ("user_id", "entry_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_state_frames_user_date_sort_idx" ON "journal_state_frames" USING btree ("user_id", "entry_date");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "state_transition_models" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "model_key" text NOT NULL,
  "model_version" text NOT NULL,
  "artifact_schema_version" integer DEFAULT 1 NOT NULL,
  "trained_through_entry_date" date NOT NULL,
  "config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metrics_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "artifact_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "state_transition_models" ADD CONSTRAINT "state_transition_models_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "state_transition_models" ADD COLUMN IF NOT EXISTS "model_key" text;
ALTER TABLE "state_transition_models" ADD COLUMN IF NOT EXISTS "model_version" text;
ALTER TABLE "state_transition_models" ADD COLUMN IF NOT EXISTS "artifact_schema_version" integer DEFAULT 1;
ALTER TABLE "state_transition_models" ADD COLUMN IF NOT EXISTS "trained_through_entry_date" date;
ALTER TABLE "state_transition_models" ADD COLUMN IF NOT EXISTS "config_json" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE "state_transition_models" ADD COLUMN IF NOT EXISTS "metrics_json" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE "state_transition_models" ADD COLUMN IF NOT EXISTS "artifact_json" jsonb DEFAULT '{}'::jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "state_transition_models_user_created_idx" ON "state_transition_models" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "state_transition_models_user_model_idx" ON "state_transition_models" USING btree ("user_id", "model_key", "created_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_predictive_scores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "memory_id" uuid NOT NULL,
  "model_key" text NOT NULL,
  "model_version" text NOT NULL,
  "predictive_score" real NOT NULL,
  "why_json" jsonb DEFAULT '[]'::jsonb,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "memory_predictive_scores" ADD CONSTRAINT "memory_predictive_scores_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "memory_predictive_scores" ADD CONSTRAINT "memory_predictive_scores_memory_id_memories_id_fk"
    FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "memory_predictive_scores" ADD COLUMN IF NOT EXISTS "model_key" text;
ALTER TABLE "memory_predictive_scores" ADD COLUMN IF NOT EXISTS "model_version" text;
ALTER TABLE "memory_predictive_scores" ADD COLUMN IF NOT EXISTS "predictive_score" real;
ALTER TABLE "memory_predictive_scores" ADD COLUMN IF NOT EXISTS "why_json" jsonb DEFAULT '[]'::jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memory_predictive_scores_user_memory_model_idx" ON "memory_predictive_scores" USING btree ("user_id", "memory_id", "model_key", "model_version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_predictive_scores_user_model_idx" ON "memory_predictive_scores" USING btree ("user_id", "model_key", "updated_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "predictive_model_overrides" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "model_key" text NOT NULL,
  "config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "predictive_model_overrides" ADD CONSTRAINT "predictive_model_overrides_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "predictive_global_config" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "model_key" text NOT NULL,
  "config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "predictive_global_config" ("id", "model_key", "config_json")
SELECT 1, 'seq_linear_v1', '{}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM "predictive_global_config" WHERE "id" = 1
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_predictive_status" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "backfill_complete_at" timestamp,
  "last_entry_processed_at" timestamp,
  "last_trained_at" timestamp,
  "active_model_key" text,
  "active_model_version" text,
  "frames_count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_predictive_status" ADD CONSTRAINT "user_predictive_status_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "user_predictive_status" ADD COLUMN IF NOT EXISTS "active_model_key" text;
ALTER TABLE "user_predictive_status" ADD COLUMN IF NOT EXISTS "active_model_version" text;
ALTER TABLE "user_predictive_status" ADD COLUMN IF NOT EXISTS "frames_count" integer DEFAULT 0;
ALTER TABLE "user_predictive_status" ADD COLUMN IF NOT EXISTS "backfill_complete_at" timestamp;
ALTER TABLE "user_predictive_status" ADD COLUMN IF NOT EXISTS "last_entry_processed_at" timestamp;
ALTER TABLE "user_predictive_status" ADD COLUMN IF NOT EXISTS "last_trained_at" timestamp;
