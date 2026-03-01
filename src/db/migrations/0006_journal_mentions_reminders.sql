ALTER TABLE "journal_drafts" ADD COLUMN IF NOT EXISTS "content_json" jsonb;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."journal_reminder_status" AS ENUM('active', 'done', 'dismissed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."journal_reminder_repeat_rule" AS ENUM('none', 'daily', 'weekly', 'monthly');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_reminders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "entry_date" date NOT NULL,
  "entry_id" uuid,
  "title" text NOT NULL,
  "body" text,
  "source_text" text NOT NULL,
  "selection_anchor" jsonb,
  "contact_id" uuid,
  "status" "journal_reminder_status" DEFAULT 'active' NOT NULL,
  "due_at" timestamp NOT NULL,
  "repeat_rule" "journal_reminder_repeat_rule" DEFAULT 'none' NOT NULL,
  "last_triggered_at" timestamp,
  "completed_at" timestamp,
  "dismissed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "journal_reminders" ADD CONSTRAINT "journal_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "journal_reminders" ADD CONSTRAINT "journal_reminders_entry_id_journal_drafts_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_drafts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "journal_reminders" ADD CONSTRAINT "journal_reminders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_reminders_user_due_idx" ON "journal_reminders" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_reminders_user_status_due_idx" ON "journal_reminders" USING btree ("user_id","status","due_at");
