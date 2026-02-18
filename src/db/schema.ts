import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  timestamp,
  date,
  boolean,
  pgEnum,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const relationshipTypeEnum = pgEnum("relationship_type", [
  "family",
  "close_friend",
  "friend",
  "colleague",
  "acquaintance",
  "other",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groups = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  color: text("color"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: integer("expires_at"),
    tokenType: text("token_type"),
    scope: text("scope"),
  },
  (table) => [unique("accounts_user_provider_unique").on(table.userId, table.provider)]
);

export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  email: text("email"),
  relationshipType: relationshipTypeEnum("relationship_type")
    .default("friend")
    .notNull(),
  importance: integer("importance").default(5).notNull(),
  notes: text("notes"),
  bio: text("bio"), // Who this person is to the user — editable, can be auto-inferred from journal
  // Groups managed via contactGroups join table
  decayRateOverride: real("decay_rate_override"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const contactGroups = pgTable("contact_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  contactId: uuid("contact_id")
    .references(() => contacts.id, { onDelete: "cascade" })
    .notNull(),
  groupId: uuid("group_id")
    .references(() => groups.id, { onDelete: "cascade" })
    .notNull(),
});

export const sentimentEnum = pgEnum("sentiment", [
  "great",
  "good",
  "neutral",
  "awkward",
]);

export const interactions = pgTable("interactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  contactId: uuid("contact_id")
    .references(() => contacts.id, { onDelete: "cascade" })
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  note: text("note"),
  sentiment: sentimentEnum("sentiment"),
  calendarEventId: text("calendar_event_id"),
  source: text("source").default("manual"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const calendarSyncState = pgTable("calendar_sync_state", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  syncToken: text("sync_token"),
  lastSyncedAt: timestamp("last_synced_at"),
  enabled: boolean("enabled").default(true).notNull(),
});

export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  googleEventId: text("google_event_id").notNull(),
  summary: text("summary"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  attendeeEmails: text("attendee_emails"), // JSON array
  attendeeNames: text("attendee_names"), // JSON array
  processed: boolean("processed").default(false).notNull(),
  dismissed: boolean("dismissed").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const dismissedEventTitles = pgTable("dismissed_event_titles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(), // normalized lowercase title
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const calendarEventContacts = pgTable("calendar_event_contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  calendarEventId: uuid("calendar_event_id")
    .references(() => calendarEvents.id, { onDelete: "cascade" })
    .notNull(),
  contactId: uuid("contact_id")
    .references(() => contacts.id, { onDelete: "cascade" })
    .notNull(),
  matchMethod: text("match_method"), // "email_exact" | "llm_name" | "manual"
  matchConfidence: real("match_confidence"), // 0.0 - 1.0
  confirmed: boolean("confirmed").default(false).notNull(),
  interactionCreated: boolean("interaction_created").default(false).notNull(),
});

// ── Journal Integration ────────────────────────────────────────────────

export const journalSyncState = pgTable("journal_sync_state", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  lastSyncedAt: timestamp("last_synced_at"),
  processedFiles: text("processed_files"), // JSON array of processed filenames
});

export const journalInsights = pgTable("journal_insights", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  entryDate: date("entry_date").notNull(),
  category: text("category").notNull(), // "recurring_theme" | "relationship_dynamic" | "personal_reflection" | "place_experience"
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  content: text("content").notNull(),
  reinforcementCount: integer("reinforcement_count").default(1).notNull(),
  lastReinforcedAt: timestamp("last_reinforced_at").defaultNow().notNull(),
  relevanceScore: real("relevance_score").default(1.0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const journalOpenLoops = pgTable("journal_open_loops", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  entryDate: date("entry_date").notNull(),
  content: text("content").notNull(),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolved_at"),
  snoozedUntil: date("snoozed_until"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Daily Suggestions ──────────────────────────────────────────────────

export const dailySuggestions = pgTable(
  "daily_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    contactId: uuid("contact_id")
      .references(() => contacts.id, { onDelete: "cascade" })
      .notNull(),
    blurb: text("blurb").notNull(),
    suggestedDate: date("suggested_date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("daily_suggestions_user_date_contact").on(
      table.userId,
      table.suggestedDate,
      table.contactId
    ),
  ]
);

export const journalNewPeople = pgTable("journal_new_people", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  entryDate: date("entry_date").notNull(),
  name: text("name").notNull(),
  context: text("context").notNull(),
  category: text("category").notNull(), // "potential_contact" | "passing_mention"
  dismissed: boolean("dismissed").default(false).notNull(),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Daily Briefings ──────────────────────────────────────────────────

export const dailyBriefings = pgTable(
  "daily_briefings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    briefingDate: date("briefing_date").notNull(),
    content: text("content").notNull(), // JSON string of structured briefing
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("daily_briefings_user_date").on(table.userId, table.briefingDate),
  ]
);
