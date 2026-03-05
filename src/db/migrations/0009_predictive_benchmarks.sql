DO $$ BEGIN
  CREATE TYPE "public"."predictive_benchmark_trigger" AS ENUM('nightly', 'manual');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."predictive_benchmark_mode" AS ENUM('quick', 'full');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."predictive_benchmark_status" AS ENUM('running', 'complete', 'error');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE "user_predictive_status"
ADD COLUMN IF NOT EXISTS "last_scored_at" timestamp;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "predictive_benchmark_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "trigger" "predictive_benchmark_trigger" NOT NULL,
  "mode" "predictive_benchmark_mode" NOT NULL,
  "status" "predictive_benchmark_status" DEFAULT 'running' NOT NULL,
  "model_key" text,
  "model_version" text,
  "baseline_key" text DEFAULT 'persistence_v1' NOT NULL,
  "frame_count" integer NOT NULL,
  "checkpoint_schedule" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sample_limit" integer NOT NULL,
  "started_at" timestamp NOT NULL,
  "completed_at" timestamp,
  "duration_ms" integer,
  "summary_json" jsonb,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "predictive_benchmark_runs" ADD CONSTRAINT "predictive_benchmark_runs_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "predictive_benchmark_runs_user_created_idx"
ON "predictive_benchmark_runs" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "predictive_benchmark_runs_user_status_idx"
ON "predictive_benchmark_runs" USING btree ("user_id", "status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "predictive_benchmark_points" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "checkpoint_size" integer NOT NULL,
  "sample_count" integer NOT NULL,
  "mae" real NOT NULL,
  "mse" real NOT NULL,
  "directional_hit_rate" real NOT NULL,
  "baseline_mae" real NOT NULL,
  "baseline_mse" real NOT NULL,
  "baseline_directional_hit_rate" real NOT NULL,
  "mae_gain_pct" real NOT NULL,
  "directional_gain_pct" real NOT NULL,
  "per_dimension_json" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "predictive_benchmark_points" ADD CONSTRAINT "predictive_benchmark_points_run_id_predictive_benchmark_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."predictive_benchmark_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "predictive_benchmark_points" ADD CONSTRAINT "predictive_benchmark_points_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "predictive_benchmark_points_run_checkpoint_idx"
ON "predictive_benchmark_points" USING btree ("run_id", "checkpoint_size");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "predictive_benchmark_points_user_created_idx"
ON "predictive_benchmark_points" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "predictive_benchmark_points_run_idx"
ON "predictive_benchmark_points" USING btree ("run_id");
