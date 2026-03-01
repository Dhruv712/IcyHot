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
  index,
  vector,
  jsonb,
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
  timeZone: text("time_zone").default("UTC").notNull(),
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

export const journalNudgeTypeEnum = pgEnum("journal_nudge_type", [
  "tension",
  "callback",
  "eyebrow_raise",
]);

export const journalNudgeFeedbackEnum = pgEnum("journal_nudge_feedback_value", [
  "up",
  "down",
]);

export const journalNudgeReasonEnum = pgEnum("journal_nudge_reason", [
  "too_vague",
  "wrong_connection",
  "already_obvious",
  "bad_tone",
  "not_now",
]);

export const journalReminderStatusEnum = pgEnum("journal_reminder_status", [
  "active",
  "done",
  "dismissed",
]);

export const journalReminderRepeatRuleEnum = pgEnum("journal_reminder_repeat_rule", [
  "none",
  "daily",
  "weekly",
  "monthly",
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

// ── Journal Drafts (autosave to DB, commit to GitHub via cron) ────────

export const journalDrafts = pgTable(
  "journal_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    entryDate: date("entry_date").notNull(),
    content: text("content").notNull(),
    contentJson: jsonb("content_json"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    committedToGithubAt: timestamp("committed_to_github_at"),
    githubSha: text("github_sha"),
  },
  (table) => [
    uniqueIndex("journal_drafts_user_date").on(table.userId, table.entryDate),
  ]
);

export const journalReminders = pgTable(
  "journal_reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    entryDate: date("entry_date").notNull(),
    entryId: uuid("entry_id").references(() => journalDrafts.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    body: text("body"),
    sourceText: text("source_text").notNull(),
    selectionAnchor: jsonb("selection_anchor"),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    status: journalReminderStatusEnum("status").default("active").notNull(),
    dueAt: timestamp("due_at").notNull(),
    repeatRule: journalReminderRepeatRuleEnum("repeat_rule").default("none").notNull(),
    lastTriggeredAt: timestamp("last_triggered_at"),
    completedAt: timestamp("completed_at"),
    dismissedAt: timestamp("dismissed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("journal_reminders_user_due_idx").on(table.userId, table.dueAt),
    index("journal_reminders_user_status_due_idx").on(
      table.userId,
      table.status,
      table.dueAt
    ),
  ]
);

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

// ── Push Notifications ──────────────────────────────────────────────

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("push_subscriptions_user_endpoint").on(table.userId, table.endpoint),
  ]
);

// ── Weekly Retrospectives ───────────────────────────────────────────

export const weeklyRetros = pgTable(
  "weekly_retros",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    weekStart: date("week_start").notNull(),
    content: text("content").notNull(), // JSON string of WeeklyRetroContent
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("weekly_retros_user_week").on(table.userId, table.weekStart),
  ]
);

// ── Consolidation Digests ───────────────────────────────────────────

export const consolidationDigests = pgTable(
  "consolidation_digests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    digestDate: date("digest_date").notNull(),
    timeZone: text("time_zone").notNull(),
    runStartedAt: timestamp("run_started_at").notNull(),
    runCompletedAt: timestamp("run_completed_at").notNull(),
    clustersProcessed: integer("clusters_processed").default(0).notNull(),
    antiClustersProcessed: integer("anti_clusters_processed").default(0).notNull(),
    connectionsCreated: integer("connections_created").default(0).notNull(),
    connectionsStrengthened: integer("connections_strengthened").default(0).notNull(),
    implicationsCreated: integer("implications_created").default(0).notNull(),
    implicationsReinforced: integer("implications_reinforced").default(0).notNull(),
    implicationsFiltered: integer("implications_filtered").default(0).notNull(),
    summary: text("summary").notNull(),
    details: text("details").notNull(), // JSON payload of created/reinforced items
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("consolidation_digests_user_date").on(table.userId, table.digestDate),
    index("consolidation_digests_user_created_idx").on(table.userId, table.createdAt),
  ]
);

// ── Health Score Snapshots ──────────────────────────────────────────

export const healthScoreSnapshots = pgTable(
  "health_score_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    snapshotDate: date("snapshot_date").notNull(),
    score: integer("score").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("health_score_snapshots_user_date").on(table.userId, table.snapshotDate),
  ]
);

// ── Graph-Based Memory System ──────────────────────────────────────

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }), // Voyage voyage-3
    abstractEmbedding: vector("abstract_embedding", { dimensions: 1024 }), // Abstract/structural embedding (names/dates stripped)
    source: text("source").notNull(), // "journal" | "calendar" | "interaction"
    sourceDate: date("source_date").notNull(),
    contactIds: text("contact_ids"), // JSON array of related contact UUIDs
    strength: real("strength").default(1.0).notNull(),
    activationCount: integer("activation_count").default(1).notNull(),
    lastActivatedAt: timestamp("last_activated_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);

export const journalNudges = pgTable(
  "journal_nudges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    entryDate: date("entry_date").notNull(),
    paragraphHash: text("paragraph_hash").notNull(),
    paragraphIndex: integer("paragraph_index").notNull(),
    type: journalNudgeTypeEnum("type").notNull(),
    hook: text("hook").notNull(),
    evidenceMemoryId: uuid("evidence_memory_id").references(() => memories.id, {
      onDelete: "set null",
    }),
    evidenceMemoryDate: date("evidence_memory_date"),
    retrievalTopScore: real("retrieval_top_score").notNull(),
    retrievalSecondScore: real("retrieval_second_score").notNull(),
    utilityScore: real("utility_score").notNull(),
    modelConfidence: real("model_confidence").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("journal_nudges_user_para_hash_idx").on(
      table.userId,
      table.entryDate,
      table.paragraphHash,
      table.type
    ),
    index("journal_nudges_user_created_idx").on(table.userId, table.createdAt),
  ]
);

export const journalNudgeFeedback = pgTable(
  "journal_nudge_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nudgeId: uuid("nudge_id")
      .references(() => journalNudges.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    feedback: journalNudgeFeedbackEnum("feedback").notNull(),
    reason: journalNudgeReasonEnum("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("journal_nudge_feedback_nudge_user").on(table.nudgeId, table.userId)]
);

export const memoryConnections = pgTable(
  "memory_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    memoryAId: uuid("memory_a_id")
      .references(() => memories.id, { onDelete: "cascade" })
      .notNull(),
    memoryBId: uuid("memory_b_id")
      .references(() => memories.id, { onDelete: "cascade" })
      .notNull(),
    connectionType: text("connection_type"), // "causal" | "thematic" | "contradiction" | "pattern" | "temporal_sequence" | "cross_domain" | "sensory" | "deviation" | "escalation"
    weight: real("weight").default(0.5).notNull(),
    reason: text("reason"), // Why these memories are connected
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastCoActivatedAt: timestamp("last_co_activated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("memory_connections_pair").on(table.memoryAId, table.memoryBId),
  ]
);

export const memoryImplications = pgTable("memory_implications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }),
  implicationType: text("implication_type"), // "predictive" | "emotional" | "relational" | "identity" | "behavioral" | "actionable" | "absence" | "trajectory" | "meta_cognitive" | "retrograde" | "counterfactual"
  implicationOrder: integer("implication_order").default(1), // 1st, 2nd, or 3rd order
  sourceMemoryIds: text("source_memory_ids").notNull(), // JSON array of memory UUIDs
  strength: real("strength").default(1.0).notNull(),
  lastReinforcedAt: timestamp("last_reinforced_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const provocations = pgTable(
  "provocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    date: date("date").notNull(),
    triggerContent: text("trigger_content").notNull(), // The assertion/decision that triggered this
    triggerSource: text("trigger_source").notNull(), // "journal" | "insight"
    provocation: text("provocation").notNull(), // The challenge text
    supportingMemoryIds: text("supporting_memory_ids").notNull(), // JSON array of memory UUIDs
    supportingMemoryContents: text("supporting_memory_contents").notNull(), // JSON array of content strings (for display)
    dismissed: boolean("dismissed").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("provocations_user_date_trigger").on(
      table.userId,
      table.date,
      table.triggerContent
    ),
  ]
);

export const memoryClusters = pgTable("memory_clusters", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  centroid: vector("centroid", { dimensions: 1024 }).notNull(),
  label: text("label").notNull(),
  posX: real("pos_x").notNull(),
  posY: real("pos_y").notNull(),
  memberCount: integer("member_count").notNull(),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
});

export const memorySyncState = pgTable("memory_sync_state", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  processedFiles: text("processed_files"), // JSON array of processed filenames
  lastProcessedAt: timestamp("last_processed_at"),
});
