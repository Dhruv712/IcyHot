/**
 * Memory storage — semantic dedup + upsert.
 * Stores extracted memories with embeddings, deduplicating via cosine similarity.
 */

import { db } from "@/db";
import { memories } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { embedTexts } from "./embed";
import type { ExtractedMemory } from "./extract";

const SIMILARITY_THRESHOLD = 0.92;

export async function storeMemories(
  userId: string,
  extracted: ExtractedMemory[],
  entryDate: string,
  contacts: { id: string; name: string }[]
): Promise<{ created: number; reinforced: number }> {
  if (extracted.length === 0) return { created: 0, reinforced: 0 };

  // 1. Embed all memory texts in batch
  const texts = extracted.map((m) => m.content);
  const embeddings = await embedTexts(texts);

  let created = 0;
  let reinforced = 0;

  // 2. For each memory, check for semantic duplicates and insert/reinforce
  for (let i = 0; i < extracted.length; i++) {
    const memory = extracted[i];
    const embedding = embeddings[i];

    try {
      const result = await storeOneMemory(
        userId,
        memory,
        embedding,
        entryDate,
        contacts
      );
      if (result === "created") created++;
      else if (result === "reinforced") reinforced++;
    } catch (error) {
      console.error(
        `[memory-store] Failed to store memory: "${memory.content.slice(0, 50)}..."`,
        error
      );
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
  contacts: { id: string; name: string }[]
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
  const contactIds = resolveContactIds(memory.contactNames, contacts);

  // Insert new memory
  await db.insert(memories).values({
    userId,
    content: memory.content,
    embedding,
    source: "journal",
    sourceDate: entryDate,
    contactIds: contactIds.length > 0 ? JSON.stringify(contactIds) : null,
    strength: memory.significance === "high" ? 1.5 : memory.significance === "medium" ? 1.0 : 0.7,
    activationCount: 1,
    lastActivatedAt: new Date(),
  });

  return "created";
}

function resolveContactIds(
  contactNames: string[],
  contacts: { id: string; name: string }[]
): string[] {
  if (!contactNames || contactNames.length === 0) return [];

  const ids: string[] = [];
  for (const name of contactNames) {
    const nameLower = name.toLowerCase().trim();
    // Try exact match first
    const exact = contacts.find(
      (c) => c.name.toLowerCase() === nameLower
    );
    if (exact) {
      ids.push(exact.id);
      continue;
    }
    // Try first-name match (if the contact list name contains the given name)
    const partial = contacts.find((c) => {
      const parts = c.name.toLowerCase().split(/\s+/);
      return parts.some((p) => p === nameLower);
    });
    if (partial) {
      ids.push(partial.id);
    }
  }
  return [...new Set(ids)]; // Deduplicate
}
