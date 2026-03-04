CREATE TYPE "public"."chat_message_role" AS ENUM('user', 'assistant');
CREATE TYPE "public"."chat_message_status" AS ENUM('streaming', 'complete', 'error');

CREATE TABLE "chat_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "last_message_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" "chat_message_role" NOT NULL,
  "content" text NOT NULL,
  "status" "chat_message_status" DEFAULT 'complete' NOT NULL,
  "model" text,
  "retrieval_stats" jsonb,
  "sources" jsonb,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "chat_threads"
  ADD CONSTRAINT "chat_threads_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk"
  FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "chat_threads_user_last_message_idx" ON "chat_threads" USING btree ("user_id", "last_message_at");
CREATE INDEX "chat_messages_thread_created_idx" ON "chat_messages" USING btree ("thread_id", "created_at");
CREATE INDEX "chat_messages_user_created_idx" ON "chat_messages" USING btree ("user_id", "created_at");
