/**
 * Memory pipeline orchestrator.
 * Processes journal entries → extract memories → embed → store.
 * Runs in parallel to the existing journal insight pipeline.
 */

import { db } from "@/db";
import { contacts, memorySyncState } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  listJournalFiles,
  getJournalFileContent,
  parseJournalDate,
} from "@/lib/github";
import { extractMemories } from "./extract";
import { storeMemories } from "./store";

export interface MemoryProcessResult {
  filesProcessed: number;
  memoriesCreated: number;
  memoriesReinforced: number;
  remaining: number;
}

export async function processMemories(
  userId: string,
  options?: { limit?: number }
): Promise<MemoryProcessResult> {
  const maxFiles = options?.limit ?? Infinity;
  const result: MemoryProcessResult = {
    filesProcessed: 0,
    memoriesCreated: 0,
    memoriesReinforced: 0,
    remaining: 0,
  };

  // 1. Get sync state — which files have already been processed?
  const [syncState] = await db
    .select()
    .from(memorySyncState)
    .where(eq(memorySyncState.userId, userId))
    .limit(1);

  const processedSet = new Set<string>(
    syncState?.processedFiles ? JSON.parse(syncState.processedFiles) : []
  );

  // 2. List all journal files from GitHub
  const allFiles = await listJournalFiles();
  const newFiles = allFiles.filter((f) => !processedSet.has(f.name));

  if (newFiles.length === 0) {
    console.log("[memory-pipeline] No new files to process");
    return result;
  }

  console.log(
    `[memory-pipeline] ${newFiles.length} new file(s) to process`
  );

  // 3. Get all contacts for name resolution
  const allContacts = await db
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(eq(contacts.userId, userId));

  // 4. Process each new file (up to limit)
  for (const file of newFiles) {
    if (result.filesProcessed >= maxFiles) break;
    const entryDate = parseJournalDate(file.name);
    if (!entryDate) {
      console.warn(`[memory-pipeline] Skipping "${file.name}" — can't parse date`);
      processedSet.add(file.name);
      continue;
    }

    try {
      console.log(`[memory-pipeline] Processing "${file.name}" (${entryDate})`);

      const content = await getJournalFileContent(file.path);
      if (!content || content.trim().length < 50) {
        console.log(`[memory-pipeline] Skipping "${file.name}" — too short`);
        processedSet.add(file.name);
        continue;
      }

      // Extract memories via LLM
      const extracted = await extractMemories(content, entryDate, allContacts);
      if (extracted.length === 0) {
        console.log(`[memory-pipeline] No memories extracted from "${file.name}"`);
        processedSet.add(file.name);
        continue;
      }

      // Store with embedding + semantic dedup
      const counts = await storeMemories(
        userId,
        extracted,
        entryDate,
        allContacts
      );

      result.memoriesCreated += counts.created;
      result.memoriesReinforced += counts.reinforced;
      result.filesProcessed++;
      processedSet.add(file.name);

      console.log(
        `[memory-pipeline] "${file.name}": ${extracted.length} extracted, ${counts.created} created, ${counts.reinforced} reinforced`
      );
    } catch (error) {
      console.error(
        `[memory-pipeline] Failed to process "${file.name}":`,
        error
      );
      // Don't add to processedSet — retry next time
    }
  }

  // 5. Count remaining unprocessed files
  result.remaining = newFiles.filter((f) => !processedSet.has(f.name)).length;

  // 6. Update sync state
  const newProcessedFiles = JSON.stringify([...processedSet]);
  if (syncState) {
    await db
      .update(memorySyncState)
      .set({
        processedFiles: newProcessedFiles,
        lastProcessedAt: new Date(),
      })
      .where(eq(memorySyncState.id, syncState.id));
  } else {
    await db.insert(memorySyncState).values({
      userId,
      processedFiles: newProcessedFiles,
      lastProcessedAt: new Date(),
    });
  }

  console.log(
    `[memory-pipeline] Done: ${result.filesProcessed} files, ${result.memoriesCreated} new memories, ${result.memoriesReinforced} reinforced`
  );
  return result;
}
