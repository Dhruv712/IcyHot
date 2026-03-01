/**
 * Memory storage — semantic dedup + upsert.
 * Stores extracted memories with embeddings, deduplicating via cosine similarity.
 */

import { db } from "@/db";
import { memories } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { embedTexts } from "./embed";
import { generateAbstractEmbedding } from "./abstract";
import type { ExtractedMemory } from "./extract";
import type { JournalMentionReference } from "@/lib/journalRichText";

const SIMILARITY_THRESHOLD = 0.92;

export async function storeMemories(
  userId: string,
  extracted: ExtractedMemory[],
  entryDate: string,
  contacts: { id: string; name: string }[],
  explicitMentions: JournalMentionReference[] = [],
): Promise<{ created: number; reinforced: number }> {
  if (extracted.length === 0) return { created: 0, reinforced: 0 };

  // 1. Embed all memory texts in batch
  const texts = extracted.map((m) => m.content);
  const embeddings = await embedTexts(texts);

  let created = 0;
  let reinforced = 0;

  // 2. For each memory, check for semantic duplicates and insert/reinforce
  //    Run in parallel batches of 5 to speed up within Vercel's 60s limit
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
        )
      )
    );
    for (let k = 0; k < results.length; k++) {
      const r = results[k];
      if (r.status === "fulfilled") {
        if (r.value === "created") created++;
        else if (r.value === "reinforced") reinforced++;
      } else {
        console.error(
          `[memory-store] Failed to store memory: "${batch[k].content.slice(0, 50)}..."`,
          r.reason
        );
      }
    }
  }

  console.log(
    `[memory-store] Stored ${created} new, reinforced ${reinforced} existing`
  );
  return { created, reinforced };
}

async function storeOneMemory(
  userId: string,
  memory: ExtractedMemory,
  embedding: number[],
  entryDate: string,
  contacts: { id: string; name: string }[],
  explicitMentions: JournalMentionReference[],
): Promise<"created" | "reinforced" | "skipped"> {
  // Check for semantic duplicates using cosine similarity
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
    // Reinforce existing memory
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
      `[memory-store] Reinforced (sim=${rows[0].similarity.toFixed(3)}): "${existing.content.slice(0, 60)}..."`
    );
    return "reinforced";
  }

  // Resolve contact names → IDs
  const contactIds = resolveContactIds(
    memory.peopleInvolvedNames,
    memory.content,
    contacts,
    explicitMentions,
  );

  // Insert new memory
  const [inserted] = await db
    .insert(memories)
    .values({
      userId,
      content: memory.content,
      embedding,
      source: "journal",
      sourceDate: entryDate,
      contactIds: contactIds.length > 0 ? JSON.stringify(contactIds) : null,
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

  // Fire-and-forget: generate abstract embedding (non-blocking)
  generateAbstractEmbedding(memory.content).then((abstractEmb) => {
    if (abstractEmb && inserted) {
      db.update(memories)
        .set({ abstractEmbedding: abstractEmb })
        .where(eq(memories.id, inserted.id))
        .then(() =>
          console.log(
            `[memory-store] Abstract embedding saved for "${memory.content.slice(0, 40)}..."`
          )
        )
        .catch((err) =>
          console.error(`[memory-store] Failed to save abstract embedding:`, err)
        );
    }
  });

  return "created";
}

function resolveContactIds(
  peopleInvolvedNames: string[],
  memoryContent: string,
  contacts: { id: string; name: string }[],
  explicitMentions: JournalMentionReference[],
): string[] {
  const ids = new Set<string>();
  const explicitByLabel = new Map(
    explicitMentions.map((mention) => [mention.label.toLowerCase(), mention]),
  );
  const explicitByFirstName = new Map<string, JournalMentionReference[]>();

  for (const mention of explicitMentions) {
    const firstName = mention.label.toLowerCase().split(/\s+/)[0];
    const bucket = explicitByFirstName.get(firstName) ?? [];
    bucket.push(mention);
    explicitByFirstName.set(firstName, bucket);
  }

  for (const name of peopleInvolvedNames ?? []) {
    const nameLower = name.toLowerCase().trim();
    const explicitExact = explicitByLabel.get(nameLower);
    if (explicitExact) {
      ids.add(explicitExact.contactId);
      continue;
    }

    const firstName = nameLower.split(/\s+/)[0];
    const explicitFirstMatches = explicitByFirstName.get(firstName) ?? [];
    if (explicitFirstMatches.length === 1) {
      ids.add(explicitFirstMatches[0].contactId);
      continue;
    }

    // Try exact match first
    const exact = contacts.find((c) => c.name.toLowerCase() === nameLower);
    if (exact) {
      ids.add(exact.id);
      continue;
    }

    // Try first-name match (if the contact list name contains the given name)
    const partial = contacts.find((c) => {
      const parts = c.name.toLowerCase().split(/\s+/);
      return parts.some((p) => p === nameLower);
    });
    if (partial) {
      ids.add(partial.id);
    }
  }

  const memoryLower = memoryContent.toLowerCase();
  for (const mention of explicitMentions) {
    if (memoryLower.includes(mention.label.toLowerCase())) {
      ids.add(mention.contactId);
    }
  }

  return [...ids];
}
