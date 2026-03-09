/**
 * Memory storage — semantic dedup + upsert.
 * Stores extracted memories with embeddings, deduplicating via cosine similarity.
 */

import { db } from "@/db";
import { memories } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { embedTexts } from "./embed";
import { generateAbstractEmbedding } from "./abstract";
import {
  MEMORY_ROLE_TAGS,
  type ExtractedMemory,
  type MemoryRoleTag,
} from "./extract";
import type { JournalMentionReference } from "@/lib/journalRichText";

const SIMILARITY_THRESHOLD = 0.92;

interface ContactRef {
  id: string;
  name: string;
  relationshipType?: MemoryRoleTag;
}

interface ResolvedContacts {
  contactIds: string[];
  nameToContactId: Map<string, string>;
  mentionNamesFromContent: string[];
}

interface MemoryPersonMetadata {
  name: string;
  contactId: string | null;
  role: MemoryRoleTag;
}

interface MemoryMetadataJson {
  people: MemoryPersonMetadata[];
  roleTags: MemoryRoleTag[];
  locationHints?: string[];
  temporalHints?: string[];
  semanticFallback?: boolean;
}

function normalizeRoleTag(value: unknown): MemoryRoleTag {
  const normalized =
    typeof value === "string"
      ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";

  return MEMORY_ROLE_TAGS.includes(normalized as MemoryRoleTag)
    ? (normalized as MemoryRoleTag)
    : "other";
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function uniqueNames(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function firstNameToken(name: string): string {
  return normalizeName(name).split(/\s+/)[0] ?? "";
}

export async function storeMemories(
  userId: string,
  extracted: ExtractedMemory[],
  entryDate: string,
  contacts: ContactRef[],
  explicitMentions: JournalMentionReference[] = [],
): Promise<{ created: number; reinforced: number }> {
  if (extracted.length === 0) return { created: 0, reinforced: 0 };

  // Embed semantic text only so geometry is metadata-debiased.
  const texts = extracted.map((m) => m.semanticContent || m.content);
  const embeddings = await embedTexts(texts);

  let created = 0;
  let reinforced = 0;

  // Run in parallel batches of 5 to stay within API time limits.
  const BATCH_SIZE = 5;
  for (let start = 0; start < extracted.length; start += BATCH_SIZE) {
    const batch = extracted.slice(start, start + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((memory, j) =>
        storeOneMemory(
          userId,
          memory,
          embeddings[start + j],
          entryDate,
          contacts,
          explicitMentions,
        ),
      ),
    );

    for (let k = 0; k < results.length; k++) {
      const result = results[k];
      if (result.status === "fulfilled") {
        if (result.value === "created") created++;
        else if (result.value === "reinforced") reinforced++;
      } else {
        console.error(
          `[memory-store] Failed to store memory: "${batch[k].content.slice(0, 80)}..."`,
          result.reason,
        );
      }
    }
  }

  console.log(
    `[memory-store] Stored ${created} new, reinforced ${reinforced} existing`,
  );
  return { created, reinforced };
}

async function storeOneMemory(
  userId: string,
  memory: ExtractedMemory,
  embedding: number[],
  entryDate: string,
  contacts: ContactRef[],
  explicitMentions: JournalMentionReference[],
): Promise<"created" | "reinforced" | "skipped"> {
  // Check for semantic duplicates using cosine similarity on semantic embedding.
  const similar = await db.execute(sql`
    SELECT id, content, 1 - (embedding <=> ${sql.raw(`'[${embedding.join(",")}]'`)}::vector) as similarity
    FROM memories
    WHERE user_id = ${userId}
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> ${sql.raw(`'[${embedding.join(",")}]'`)}::vector) > ${SIMILARITY_THRESHOLD}
    ORDER BY similarity DESC
    LIMIT 1
  `);

  const rows = similar.rows as Array<{
    id: string;
    content: string;
    similarity: number;
  }>;

  if (rows.length > 0) {
    const existing = rows[0];
    await db
      .update(memories)
      .set({
        activationCount: sql`${memories.activationCount} + 1`,
        lastActivatedAt: new Date(),
        strength: sql`${memories.strength} + 0.05`,
      })
      .where(eq(memories.id, existing.id));

    console.log(
      `[memory-store] Reinforced (sim=${rows[0].similarity.toFixed(3)}): "${existing.content.slice(0, 80)}..."`,
    );
    return "reinforced";
  }

  const resolvedContacts = resolveContacts(
    memory.peopleInvolvedNames,
    memory.content,
    contacts,
    explicitMentions,
  );

  const roleHintByName = new Map<string, MemoryRoleTag>();
  for (const hint of memory.peopleRoleHints ?? []) {
    const key = normalizeName(hint.name);
    if (!key) continue;
    roleHintByName.set(key, normalizeRoleTag(hint.role));
  }

  const relationshipRoleByContactId = new Map<string, MemoryRoleTag>();
  for (const contact of contacts) {
    relationshipRoleByContactId.set(
      contact.id,
      normalizeRoleTag(contact.relationshipType),
    );
  }

  const metadataNames = uniqueNames([
    ...memory.peopleInvolvedNames,
    ...(memory.peopleRoleHints ?? []).map((hint) => hint.name),
    ...resolvedContacts.mentionNamesFromContent,
  ]);

  const people: MemoryPersonMetadata[] = metadataNames.map((name) => {
    const key = normalizeName(name);
    const contactId = resolvedContacts.nameToContactId.get(key) ?? null;
    const hintRole = roleHintByName.get(key) ?? "other";
    const relationshipRole = contactId
      ? relationshipRoleByContactId.get(contactId)
      : undefined;

    return {
      name,
      contactId,
      role: relationshipRole ?? hintRole ?? "other",
    };
  });

  const metadata: MemoryMetadataJson = {
    people,
    roleTags: Array.from(new Set(people.map((person) => person.role))),
    ...(memory.locationHints?.length
      ? { locationHints: uniqueNames(memory.locationHints).slice(0, 6) }
      : {}),
    ...(memory.temporalHints?.length
      ? { temporalHints: uniqueNames(memory.temporalHints).slice(0, 6) }
      : {}),
    ...(memory.semanticFallback ? { semanticFallback: true } : {}),
  };

  const [inserted] = await db
    .insert(memories)
    .values({
      userId,
      content: memory.content,
      semanticContent: memory.semanticContent,
      embedding,
      abstractEmbedding: null,
      metadataJson: metadata as unknown as Record<string, unknown>,
      extractionVersion: "v2",
      source: "journal",
      sourceDate: entryDate,
      contactIds:
        resolvedContacts.contactIds.length > 0
          ? JSON.stringify(resolvedContacts.contactIds)
          : null,
      strength:
        memory.significance === "high"
          ? 1.5
          : memory.significance === "medium"
            ? 1.0
            : 0.7,
      activationCount: 1,
      lastActivatedAt: new Date(),
    })
    .returning({ id: memories.id });

  // Fire-and-forget: abstract embedding remains derived from display text.
  generateAbstractEmbedding(memory.content).then((abstractEmb) => {
    if (abstractEmb && inserted) {
      db.update(memories)
        .set({ abstractEmbedding: abstractEmb })
        .where(eq(memories.id, inserted.id))
        .then(() =>
          console.log(
            `[memory-store] Abstract embedding saved for "${memory.content.slice(0, 60)}..."`,
          ),
        )
        .catch((err) =>
          console.error(`[memory-store] Failed to save abstract embedding:`, err),
        );
    }
  });

  return "created";
}

function resolveContacts(
  peopleInvolvedNames: string[],
  memoryContent: string,
  contacts: ContactRef[],
  explicitMentions: JournalMentionReference[],
): ResolvedContacts {
  const ids = new Set<string>();
  const nameToContactId = new Map<string, string>();

  const explicitByLabel = new Map(
    explicitMentions.map((mention) => [normalizeName(mention.label), mention]),
  );
  const explicitByFirstName = new Map<string, JournalMentionReference[]>();
  for (const mention of explicitMentions) {
    const firstName = firstNameToken(mention.label);
    const bucket = explicitByFirstName.get(firstName) ?? [];
    bucket.push(mention);
    explicitByFirstName.set(firstName, bucket);
  }

  const contactsByExactName = new Map(
    contacts.map((contact) => [normalizeName(contact.name), contact]),
  );
  const contactsByFirstName = new Map<string, ContactRef[]>();
  for (const contact of contacts) {
    const firstName = firstNameToken(contact.name);
    const bucket = contactsByFirstName.get(firstName) ?? [];
    bucket.push(contact);
    contactsByFirstName.set(firstName, bucket);
  }

  const candidateNames = uniqueNames(peopleInvolvedNames);
  const mentionNamesFromContent: string[] = [];
  const memoryLower = memoryContent.toLowerCase();

  for (const mention of explicitMentions) {
    if (memoryLower.includes(normalizeName(mention.label))) {
      ids.add(mention.contactId);
      mentionNamesFromContent.push(mention.label);
      nameToContactId.set(normalizeName(mention.label), mention.contactId);
    }
  }

  for (const name of candidateNames) {
    const nameLower = normalizeName(name);
    if (!nameLower) continue;

    // 1) Explicit mention exact label
    const explicitExact = explicitByLabel.get(nameLower);
    if (explicitExact) {
      ids.add(explicitExact.contactId);
      nameToContactId.set(nameLower, explicitExact.contactId);
      continue;
    }

    // 2) Explicit mention unique first-name match
    const first = firstNameToken(name);
    const explicitFirst = explicitByFirstName.get(first) ?? [];
    if (explicitFirst.length === 1) {
      ids.add(explicitFirst[0].contactId);
      nameToContactId.set(nameLower, explicitFirst[0].contactId);
      continue;
    }

    // 3) Contact exact full-name match
    const contactExact = contactsByExactName.get(nameLower);
    if (contactExact) {
      ids.add(contactExact.id);
      nameToContactId.set(nameLower, contactExact.id);
      continue;
    }

    // 4) Contact unique first-name match
    const contactFirst = contactsByFirstName.get(first) ?? [];
    if (contactFirst.length === 1) {
      ids.add(contactFirst[0].id);
      nameToContactId.set(nameLower, contactFirst[0].id);
    }
  }

  return {
    contactIds: Array.from(ids),
    nameToContactId,
    mentionNamesFromContent: uniqueNames(mentionNamesFromContent),
  };
}
