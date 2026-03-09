CREATE TABLE IF NOT EXISTS "predictive_benchmark_window_predictions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "checkpoint_size" integer NOT NULL,
  "sample_index" integer NOT NULL,
  "target_entry_date" date NOT NULL,
  "predicted_vector_json" jsonb NOT NULL,
  "actual_vector_json" jsonb NOT NULL,
  "baseline_vector_json" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "predictive_benchmark_window_predictions" ADD CONSTRAINT "predictive_benchmark_window_predictions_run_id_predictive_benchmark_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."predictive_benchmark_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "predictive_benchmark_window_predictions" ADD CONSTRAINT "predictive_benchmark_window_predictions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "predictive_benchmark_window_predictions_run_checkpoint_sample_idx"
ON "predictive_benchmark_window_predictions" USING btree ("run_id", "checkpoint_size", "sample_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "predictive_benchmark_window_predictions_user_created_idx"
ON "predictive_benchmark_window_predictions" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "predictive_benchmark_window_predictions_run_checkpoint_idx"
ON "predictive_benchmark_window_predictions" USING btree ("run_id", "checkpoint_size");
