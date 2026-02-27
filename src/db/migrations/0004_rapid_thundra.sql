CREATE TYPE "public"."journal_nudge_feedback" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."journal_nudge_reason" AS ENUM('too_vague', 'wrong_connection', 'already_obvious', 'bad_tone', 'not_now');--> statement-breakpoint
CREATE TYPE "public"."journal_nudge_type" AS ENUM('tension', 'callback', 'eyebrow_raise');--> statement-breakpoint
CREATE TABLE "journal_nudge_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nudge_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"feedback" "journal_nudge_feedback" NOT NULL,
	"reason" "journal_nudge_reason",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"paragraph_hash" text NOT NULL,
	"paragraph_index" integer NOT NULL,
	"type" "journal_nudge_type" NOT NULL,
	"hook" text NOT NULL,
	"evidence_memory_id" uuid,
	"evidence_memory_date" date,
	"retrieval_top_score" real NOT NULL,
	"retrieval_second_score" real NOT NULL,
	"utility_score" real NOT NULL,
	"model_confidence" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"centroid" vector(1024) NOT NULL,
	"label" text NOT NULL,
	"pos_x" real NOT NULL,
	"pos_y" real NOT NULL,
	"member_count" integer NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_nudge_feedback" ADD CONSTRAINT "journal_nudge_feedback_nudge_id_journal_nudges_id_fk" FOREIGN KEY ("nudge_id") REFERENCES "public"."journal_nudges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_nudge_feedback" ADD CONSTRAINT "journal_nudge_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_nudges" ADD CONSTRAINT "journal_nudges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_nudges" ADD CONSTRAINT "journal_nudges_evidence_memory_id_memories_id_fk" FOREIGN KEY ("evidence_memory_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_clusters" ADD CONSTRAINT "memory_clusters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_nudge_feedback_nudge_user" ON "journal_nudge_feedback" USING btree ("nudge_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_nudges_user_para_hash_idx" ON "journal_nudges" USING btree ("user_id","entry_date","paragraph_hash","type");--> statement-breakpoint
CREATE INDEX "journal_nudges_user_created_idx" ON "journal_nudges" USING btree ("user_id","created_at");
