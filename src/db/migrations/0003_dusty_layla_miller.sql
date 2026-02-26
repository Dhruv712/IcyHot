CREATE TABLE "journal_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"content" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"committed_to_github_at" timestamp,
	"github_sha" text
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024),
	"abstract_embedding" vector(1024),
	"source" text NOT NULL,
	"source_date" date NOT NULL,
	"contact_ids" text,
	"strength" real DEFAULT 1 NOT NULL,
	"activation_count" integer DEFAULT 1 NOT NULL,
	"last_activated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"memory_a_id" uuid NOT NULL,
	"memory_b_id" uuid NOT NULL,
	"connection_type" text,
	"weight" real DEFAULT 0.5 NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_co_activated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_implications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024),
	"implication_type" text,
	"implication_order" integer DEFAULT 1,
	"source_memory_ids" text NOT NULL,
	"strength" real DEFAULT 1 NOT NULL,
	"last_reinforced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"processed_files" text,
	"last_processed_at" timestamp,
	CONSTRAINT "memory_sync_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "provocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"trigger_content" text NOT NULL,
	"trigger_source" text NOT NULL,
	"provocation" text NOT NULL,
	"supporting_memory_ids" text NOT NULL,
	"supporting_memory_contents" text NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_drafts" ADD CONSTRAINT "journal_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_connections" ADD CONSTRAINT "memory_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_connections" ADD CONSTRAINT "memory_connections_memory_a_id_memories_id_fk" FOREIGN KEY ("memory_a_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_connections" ADD CONSTRAINT "memory_connections_memory_b_id_memories_id_fk" FOREIGN KEY ("memory_b_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_implications" ADD CONSTRAINT "memory_implications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_sync_state" ADD CONSTRAINT "memory_sync_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provocations" ADD CONSTRAINT "provocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_drafts_user_date" ON "journal_drafts" USING btree ("user_id","entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_connections_pair" ON "memory_connections" USING btree ("memory_a_id","memory_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provocations_user_date_trigger" ON "provocations" USING btree ("user_id","date","trigger_content");