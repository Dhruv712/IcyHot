import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import {
  contacts,
  interactions,
  journalSyncState,
  journalInsights,
  journalOpenLoops,
  journalNewPeople,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
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
    if (!entryDate) continue;

    const content = await getJournalFileContent(file.path);
    if (!content.trim()) continue;

    const extraction = await extractInsights(content, entryDate, allContacts);
    if (!extraction) {
      // Still mark as processed so we don't retry on error
      processedSet.add(file.name);
      continue;
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
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const client = new Anthropic();

    const contactListStr = contactList.length > 0
      ? contactList.map((c) => `- "${c.name}" (id: "${c.id}")`).join("\n")
      : "(no contacts yet)";

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
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

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as ExtractionResult;
  } catch (error) {
    console.error("Journal extraction error:", error);
    return null;
  }
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

  // 2. Recurring themes → journal_insights
  for (const theme of extraction.recurringThemes) {
    await db.insert(journalInsights).values({
      userId,
      entryDate,
      category: "recurring_theme",
      content: theme,
    });
    counts.insights++;
  }

  // 3. Relationship dynamics → journal_insights (with contactId)
  for (const dynamic of extraction.relationshipDynamics) {
    const contactId = resolveContactId(dynamic.contactName, dynamic.contactId);
    await db.insert(journalInsights).values({
      userId,
      entryDate,
      category: "relationship_dynamic",
      contactId,
      content: dynamic.insight,
    });
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

  // 5. Personal reflections → journal_insights
  for (const reflection of extraction.personalReflections) {
    await db.insert(journalInsights).values({
      userId,
      entryDate,
      category: "personal_reflection",
      content: reflection,
    });
    counts.insights++;
  }

  // 6. Places & experiences → journal_insights
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
