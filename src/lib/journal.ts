import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import {
  contacts,
  interactions,
  journalSyncState,
  journalInsights,
  journalOpenLoops,
  journalNewPeople,
  journalDrafts,
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { listJournalFiles, getJournalFileContent, parseJournalDate } from "./github";

// ── Types ──────────────────────────────────────────────────────────────

interface ExtractedInteraction {
  contactName: string;
  contactId: string | null;
  summary: string;
  sentiment: "great" | "good" | "neutral" | "awkward";
  followUps: string[];
}

interface ExtractedDynamic {
  contactName: string;
  contactId: string | null;
  insight: string;
}

interface ExtractedOpenLoop {
  content: string;
  contactName: string | null;
  contactId: string | null;
}

interface ExtractedPlace {
  name: string;
  context: string;
  contactNames: string[];
}

interface ExtractedNewPerson {
  name: string;
  context: string;
  category: "potential_contact" | "passing_mention";
}

interface ExtractionResult {
  interactions: ExtractedInteraction[];
  recurringThemes: string[];
  relationshipDynamics: ExtractedDynamic[];
  openLoops: ExtractedOpenLoop[];
  personalReflections: string[];
  placesExperiences: ExtractedPlace[];
  newPeople: ExtractedNewPerson[];
}

export interface SyncResult {
  processed: number;
  interactions: number;
  insights: number;
  openLoops: number;
  newPeople: number;
}

// ── Main sync function ─────────────────────────────────────────────────

export async function syncJournalEntries(userId: string): Promise<SyncResult> {
  // 1. Get sync state
  const [syncState] = await db
    .select()
    .from(journalSyncState)
    .where(eq(journalSyncState.userId, userId));

  const processedFiles: string[] = syncState?.processedFiles
    ? JSON.parse(syncState.processedFiles)
    : [];
  const processedSet = new Set(processedFiles);

  // 2. List files from GitHub
  const files = await listJournalFiles();

  // 3. Find new files to process
  const newFiles = files.filter((f) => !processedSet.has(f.name));

  if (newFiles.length === 0) {
    return { processed: 0, interactions: 0, insights: 0, openLoops: 0, newPeople: 0 };
  }

  // 4. Fetch contacts for matching
  const allContacts = await db
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(eq(contacts.userId, userId));

  const draftRows = await db
    .select({
      entryDate: journalDrafts.entryDate,
      content: journalDrafts.content,
    })
    .from(journalDrafts)
    .where(eq(journalDrafts.userId, userId));

  const draftsByDate = new Map(draftRows.map((draft) => [draft.entryDate, draft.content]));

  const result: SyncResult = {
    processed: 0,
    interactions: 0,
    insights: 0,
    openLoops: 0,
    newPeople: 0,
  };

  // 5. Process each new file
  for (const file of newFiles) {
    const entryDate = parseJournalDate(file.name);
    if (!entryDate) {
      console.log(`[journal-sync] Skipping ${file.name}: could not parse date`);
      continue;
    }

    const content = draftsByDate.get(entryDate) ?? (await getJournalFileContent(file.path));
    if (!content.trim()) {
      console.log(`[journal-sync] Skipping ${file.name}: empty content`);
      continue;
    }

    console.log(`[journal-sync] Processing ${file.name} (${content.length} chars, ${allContacts.length} contacts)`);

    const extraction = await extractInsights(content, entryDate, allContacts);
    if (!extraction) {
      // Still mark as processed so we don't retry on error
      console.log(`[journal-sync] ${file.name}: extraction returned null`);
      processedSet.add(file.name);
      continue;
    }

    console.log(`[journal-sync] ${file.name}: extracted ${extraction.interactions.length} interactions, ${extraction.openLoops.length} open loops, ${extraction.newPeople.length} new people`);
    for (const ix of extraction.interactions) {
      console.log(`[journal-sync]   interaction: "${ix.contactName}" (id: ${ix.contactId}) - ${ix.sentiment}`);
    }

    // 6. Write extracted data to DB
    const counts = await writeExtractionToDb(userId, entryDate, extraction, allContacts);
    result.interactions += counts.interactions;
    result.insights += counts.insights;
    result.openLoops += counts.openLoops;
    result.newPeople += counts.newPeople;
    result.processed++;

    processedSet.add(file.name);
  }

  // 7. Update sync state
  const newProcessedFiles = JSON.stringify([...processedSet]);
  if (syncState) {
    await db
      .update(journalSyncState)
      .set({ lastSyncedAt: new Date(), processedFiles: newProcessedFiles })
      .where(eq(journalSyncState.id, syncState.id));
  } else {
    await db.insert(journalSyncState).values({
      userId,
      lastSyncedAt: new Date(),
      processedFiles: newProcessedFiles,
    });
  }

  return result;
}

// ── LLM Extraction ────────────────────────────────────────────────────

async function extractInsights(
  journalText: string,
  entryDate: string,
  contactList: { id: string; name: string }[]
): Promise<ExtractionResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[journal-extract] ANTHROPIC_API_KEY is not set!");
    return null;
  }

  try {
    const client = new Anthropic();

    const contactListStr = contactList.length > 0
      ? contactList.map((c) => `- "${c.name}" (id: "${c.id}")`).join("\n")
      : "(no contacts yet)";

    // Use Haiku for long entries to stay within Vercel Hobby 10s timeout.
    // Sonnet gives higher quality extraction but takes 15-30s for long entries.
    const LONG_ENTRY_THRESHOLD = 4000;
    const model =
      journalText.length >= LONG_ENTRY_THRESHOLD
        ? "claude-haiku-4-5-20251001"
        : "claude-sonnet-4-20250514";
    console.log(`[journal-extract] Using model=${model} for ${journalText.length} chars`);

    // Use streaming to keep the connection alive during generation.
    const stream = client.messages.stream({
      model,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `You are analyzing a personal journal entry written by Dhruv. When writing insights, reflections, dynamics, or any text that refers to the journal author, use "you" (second person) — never say "the writer" or "the author."

Dhruv has these contacts in his tracker:
${contactListStr}

Journal entry date: ${entryDate}
---
${journalText}
---

Extract ALL of the following categories. Be thorough — this journal entry is rich with information. Return ONLY valid JSON (no markdown, no explanation):

{
  "interactions": [
    {
      "contactName": "Person's name as mentioned in journal",
      "contactId": "matching contact ID from the list above, or null if not in their contacts",
      "summary": "What they did together / discussed / the nature of the interaction (2-3 sentences max)",
      "sentiment": "great" | "good" | "neutral" | "awkward",
      "followUps": ["any specific follow-up items or unresolved things from this interaction"]
    }
  ],
  "recurringThemes": [
    "A behavioral pattern or tendency that seems like it could be recurring — something the writer does repeatedly or struggles with. Write in second person ('You tend to...'). Only include genuine patterns, not one-off events."
  ],
  "relationshipDynamics": [
    {
      "contactName": "Person's name",
      "contactId": "matching ID or null",
      "insight": "A deeper observation about this relationship — how they balance each other, conflict patterns, growth moments, what makes this relationship work or struggle"
    }
  ],
  "openLoops": [
    {
      "content": "A CONCRETE next action the writer needs to take. Must be something they can actually DO — not a vague observation or wish. Good: 'Buy replacement earring backing for Nivitha'. Bad: 'Find the lost earring' (too vague). Bad: 'Help with coffee business' (not a specific action).",
      "contactName": "related person or null",
      "contactId": "matching ID or null"
    }
  ],
  "personalReflections": [
    "A self-awareness moment, value expressed, or growth observation from the entry. Quote or closely paraphrase the writer's own words when possible. Write in second person."
  ],
  "placesExperiences": [
    {
      "name": "Place or experience name (restaurant, hike, event, recipe, etc.)",
      "context": "Brief description of what happened there and the vibe",
      "contactNames": ["people who were there"]
    }
  ],
  "newPeople": [
    {
      "name": "Full name if available, first name otherwise",
      "context": "How they were mentioned — who they are, relationship to the writer",
      "category": "potential_contact" if they seem like someone the writer might interact with again, or "passing_mention" if they're just part of the story
    }
  ]
}

Guidelines:
- For interactions: create one per person or per distinct hangout. If the writer spent the whole weekend with one person, that can be ONE interaction with a rich summary, not separate ones for each activity.
- For sentiment: infer from the journal's tone. "great" = clearly positive, connected. "good" = pleasant but unremarkable. "neutral" = factual, no strong emotion. "awkward" = tension, discomfort, or conflict.
- For newPeople: only include people NOT in the contact list above. Don't include the writer themselves.
- For contactId: match names carefully. Use the exact IDs from the contact list. If the journal uses a first name and there's only one contact with that first name, match it. If ambiguous, set null.
- For openLoops: BE EXTREMELY SELECTIVE. Only include items where the writer has a concrete, specific action they need to take. Each open loop must pass this test: "Could someone read this and know EXACTLY what to do?" If not, don't include it. Do NOT create an open loop for something already captured in a followUp on an interaction — avoid all duplication. Aim for 0-3 open loops per entry; most entries should have 0-1.
- For interactions.followUps: Keep this array EMPTY unless there is a truly distinct action item from the interaction that isn't captured in openLoops. Do not duplicate between followUps and openLoops — if something belongs in openLoops, put it ONLY there.
- For recurringThemes: only include if the journal suggests this is a PATTERN, not a one-time thing. E.g., "I always do this" or if the behavior is described as characteristic.`,
        },
      ],
    });

    const response = await stream.finalMessage();

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    console.log(`[journal-extract] Response: stop_reason=${response.stop_reason}, text length=${text.length}`);

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`[journal-extract] No JSON found in response. First 500 chars: ${text.slice(0, 500)}`);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as ExtractionResult;
    console.log(`[journal-extract] Parsed OK: ${parsed.interactions?.length ?? 0} interactions`);
    return parsed;
  } catch (error) {
    console.error("Journal extraction error:", error);
    return null;
  }
}

// ── Insight Reinforcement ──────────────────────────────────────────────

/** Compute relevance score: reinforcement × recency decay × importance boost */
function computeRelevanceScore(
  reinforcementCount: number,
  lastReinforcedAt: Date,
  contactImportance?: number
): number {
  const daysSinceReinforced =
    (Date.now() - lastReinforcedAt.getTime()) / (1000 * 60 * 60 * 24);
  // Slow decay — half-life of 60 days (insights stay relevant much longer than interactions)
  const recencyDecay = Math.exp((-Math.LN2 / 60) * daysSinceReinforced);
  const importanceBoost = contactImportance && contactImportance >= 7 ? 1.5 : 1.0;
  return reinforcementCount * recencyDecay * importanceBoost;
}

/** Check if two insight strings are semantically similar (word overlap >60%) */
function insightsAreSimilar(a: string, b: string): boolean {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  // Substring containment
  if (aLower.includes(bLower) || bLower.includes(aLower)) return true;
  // Word overlap
  const aWords = new Set(aLower.split(/\s+/).filter((w) => w.length > 3));
  const bWords = new Set(bLower.split(/\s+/).filter((w) => w.length > 3));
  if (aWords.size === 0 || bWords.size === 0) return false;
  const overlap = [...aWords].filter((w) => bWords.has(w)).length;
  return overlap / Math.min(aWords.size, bWords.size) > 0.6;
}

/**
 * Try to reinforce an existing insight instead of creating a duplicate.
 * Returns true if an existing insight was reinforced, false if we should insert new.
 */
async function tryReinforceInsight(
  userId: string,
  category: string,
  content: string,
  contactId: string | null,
  entryDate: string,
  contactImportance?: number
): Promise<boolean> {
  // Fetch existing insights in this category for this user (limit to recent ones for performance)
  const existing = await db
    .select({
      id: journalInsights.id,
      content: journalInsights.content,
      reinforcementCount: journalInsights.reinforcementCount,
      contactId: journalInsights.contactId,
    })
    .from(journalInsights)
    .where(
      and(
        eq(journalInsights.userId, userId),
        eq(journalInsights.category, category)
      )
    )
    .orderBy(desc(journalInsights.lastReinforcedAt))
    .limit(100);

  // Find a match — for relationship_dynamic, also check same contact
  const match = existing.find((e) => {
    if (category === "relationship_dynamic" && contactId && e.contactId !== contactId) {
      return false;
    }
    return insightsAreSimilar(e.content, content);
  });

  if (!match) return false;

  const newCount = match.reinforcementCount + 1;
  const now = new Date();
  const score = computeRelevanceScore(newCount, now, contactImportance);

  // Reinforce: bump count, update timestamp, keep the longer/newer wording
  const bestContent = content.length > match.content.length ? content : match.content;

  await db
    .update(journalInsights)
    .set({
      reinforcementCount: newCount,
      lastReinforcedAt: now,
      relevanceScore: score,
      content: bestContent,
      entryDate, // update to most recent entry date
    })
    .where(eq(journalInsights.id, match.id));

  return true;
}

// ── Write to DB ────────────────────────────────────────────────────────

async function writeExtractionToDb(
  userId: string,
  entryDate: string,
  extraction: ExtractionResult,
  contactList: { id: string; name: string }[]
): Promise<{ interactions: number; insights: number; openLoops: number; newPeople: number }> {
  const counts = { interactions: 0, insights: 0, openLoops: 0, newPeople: 0 };

  // Helper: resolve contactId from name (fallback matching)
  function resolveContactId(name: string | null, llmId: string | null): string | null {
    if (llmId && contactList.some((c) => c.id === llmId)) return llmId;
    if (!name) return null;

    const lower = name.toLowerCase();
    // Exact full name match
    const exact = contactList.find((c) => c.name.toLowerCase() === lower);
    if (exact) return exact.id;
    // First name match (only if unique)
    const firstName = lower.split(" ")[0];
    const firstMatches = contactList.filter(
      (c) => c.name.toLowerCase().split(" ")[0] === firstName
    );
    if (firstMatches.length === 1) return firstMatches[0].id;
    return null;
  }

  // Seed with existing unresolved open loops to prevent cross-entry duplicates
  const existingLoops = await db
    .select({ content: journalOpenLoops.content })
    .from(journalOpenLoops)
    .where(
      and(
        eq(journalOpenLoops.userId, userId),
        eq(journalOpenLoops.resolved, false)
      )
    );
  const writtenLoops: string[] = existingLoops.map((l) => l.content);

  // 1. Interactions → interactions table
  for (const ix of extraction.interactions) {
    const contactId = resolveContactId(ix.contactName, ix.contactId);
    if (!contactId) continue; // Only create interactions for known contacts

    const validSentiments = ["great", "good", "neutral", "awkward"];
    await db.insert(interactions).values({
      contactId,
      userId,
      note: ix.summary,
      sentiment: validSentiments.includes(ix.sentiment) ? ix.sentiment : null,
      source: "journal",
      occurredAt: new Date(entryDate + "T12:00:00"),
    });
    counts.interactions++;

    // Follow-ups from interactions → open loops
    for (const followUp of ix.followUps) {
      await db.insert(journalOpenLoops).values({
        userId,
        entryDate,
        content: followUp,
        contactId,
      });
      writtenLoops.push(followUp);
      counts.openLoops++;
    }
  }

  // Preload contact importance for relevance scoring
  const allContactsWithImportance = await db
    .select({ id: contacts.id, importance: contacts.importance })
    .from(contacts)
    .where(eq(contacts.userId, userId));
  const contactImportanceMap = new Map(
    allContactsWithImportance.map((c) => [c.id, c.importance])
  );

  // 2. Recurring themes → journal_insights (with reinforcement dedup)
  for (const theme of extraction.recurringThemes) {
    const reinforced = await tryReinforceInsight(userId, "recurring_theme", theme, null, entryDate);
    if (!reinforced) {
      await db.insert(journalInsights).values({
        userId,
        entryDate,
        category: "recurring_theme",
        content: theme,
        relevanceScore: computeRelevanceScore(1, new Date()),
      });
    }
    counts.insights++;
  }

  // 3. Relationship dynamics → journal_insights (with reinforcement dedup)
  for (const dynamic of extraction.relationshipDynamics) {
    const contactId = resolveContactId(dynamic.contactName, dynamic.contactId);
    const importance = contactId ? contactImportanceMap.get(contactId) : undefined;
    const reinforced = await tryReinforceInsight(
      userId, "relationship_dynamic", dynamic.insight, contactId, entryDate, importance
    );
    if (!reinforced) {
      await db.insert(journalInsights).values({
        userId,
        entryDate,
        category: "relationship_dynamic",
        contactId,
        content: dynamic.insight,
        relevanceScore: computeRelevanceScore(1, new Date(), importance),
      });
    }
    counts.insights++;
  }

  // 4. Open loops → journal_open_loops (deduplicated against followUps already written)
  for (const loop of extraction.openLoops) {
    // Skip if this is too similar to an already-written open loop (from followUps)
    const lower = loop.content.toLowerCase();
    const isDuplicate = writtenLoops.some((existing) => {
      const existingLower = existing.toLowerCase();
      // Check if one contains the other or they share >60% of words
      if (existingLower.includes(lower) || lower.includes(existingLower)) return true;
      const loopWords = new Set(lower.split(/\s+/));
      const existingWords = new Set(existingLower.split(/\s+/));
      const overlap = [...loopWords].filter((w) => existingWords.has(w)).length;
      return overlap / Math.max(loopWords.size, existingWords.size) > 0.6;
    });
    if (isDuplicate) continue;

    const contactId = resolveContactId(loop.contactName, loop.contactId);
    await db.insert(journalOpenLoops).values({
      userId,
      entryDate,
      content: loop.content,
      contactId,
    });
    writtenLoops.push(loop.content);
    counts.openLoops++;
  }

  // 5. Personal reflections → journal_insights (with reinforcement dedup)
  for (const reflection of extraction.personalReflections) {
    const reinforced = await tryReinforceInsight(userId, "personal_reflection", reflection, null, entryDate);
    if (!reinforced) {
      await db.insert(journalInsights).values({
        userId,
        entryDate,
        category: "personal_reflection",
        content: reflection,
        relevanceScore: computeRelevanceScore(1, new Date()),
      });
    }
    counts.insights++;
  }

  // 6. Places & experiences → journal_insights (no dedup — places are unique events)
  for (const place of extraction.placesExperiences) {
    await db.insert(journalInsights).values({
      userId,
      entryDate,
      category: "place_experience",
      content: `${place.name}: ${place.context}`,
    });
    counts.insights++;
  }

  // 7. New people → journal_new_people
  for (const person of extraction.newPeople) {
    // Skip if they actually match an existing contact
    if (resolveContactId(person.name, null)) continue;

    await db.insert(journalNewPeople).values({
      userId,
      entryDate,
      name: person.name,
      context: person.context,
      category: person.category,
    });
    counts.newPeople++;
  }

  return counts;
}
