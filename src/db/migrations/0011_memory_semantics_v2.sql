ALTER TABLE "memories"
ADD COLUMN IF NOT EXISTS "semantic_content" text;
--> statement-breakpoint
ALTER TABLE "memories"
ADD COLUMN IF NOT EXISTS "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "memories"
ADD COLUMN IF NOT EXISTS "extraction_version" text DEFAULT 'v1' NOT NULL;
