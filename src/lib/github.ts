import { db } from "@/db";
import { journalDrafts } from "@/db/schema";
import { eq, and, or, isNull, lt } from "drizzle-orm";

const REPO_OWNER = "Dhruv712";
const REPO_NAME = "Obsidian_Journals";
const JOURNAL_PATH = "Journals";

interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  type: "file" | "dir";
}

/**
 * List all journal markdown files in the repo.
 */
export async function listJournalFiles(): Promise<GitHubFile[]> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT not set");

  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${JOURNAL_PATH}`,
    {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github.v3+json",
      },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }

  const files: GitHubFile[] = await res.json();
  return files.filter((f) => f.type === "file" && f.name.endsWith(".md"));
}

/**
 * Fetch the raw content of a single journal file.
 */
export async function getJournalFileContent(path: string): Promise<string> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT not set");

  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github.v3+json",
      },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  // GitHub returns base64-encoded content
  return Buffer.from(data.content, "base64").toString("utf-8");
}

/**
 * Parse the journal filename into a date.
 * Format: "February 15, 2026.md" → "2026-02-15"
 */
export function parseJournalDate(filename: string): string | null {
  const name = filename.replace(/\.md$/, "").trim();
  const match = name.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!match) return null;

  const monthLabel = match[1];
  const day = Number(match[2]);
  const year = Number(match[3]);
  const month = MONTHS.findIndex(
    (m) => m.toLowerCase() === monthLabel.toLowerCase()
  );
  if (month < 0 || !Number.isInteger(day) || !Number.isInteger(year)) return null;

  const check = new Date(year, month, day);
  if (
    check.getFullYear() !== year ||
    check.getMonth() !== month ||
    check.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Generate a journal filename from a Date object.
 * e.g. new Date("2026-02-25") → "February 25, 2026.md"
 */
export function journalFilename(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}.md`;
}

/**
 * Get the SHA of a journal file, if it exists.
 * Returns null if file doesn't exist (404).
 */
export async function getJournalFileSha(filename: string): Promise<string | null> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT not set");

  const path = `${JOURNAL_PATH}/${filename}`;
  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github.v3+json",
      },
      cache: "no-store",
    }
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.sha;
}

/**
 * Create or update a journal file in the GitHub repo.
 * If sha is provided, updates existing file; otherwise creates new.
 */
export async function createOrUpdateJournalFile(
  filename: string,
  content: string,
  sha?: string | null
): Promise<{ sha: string }> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT not set");

  const path = `${JOURNAL_PATH}/${filename}`;
  const encodedContent = Buffer.from(content, "utf-8").toString("base64");

  const body: Record<string, string> = {
    message: `journal entry for ${filename.replace(/\.md$/, "")}`,
    content: encodedContent,
  };

  if (sha) {
    body.sha = sha;
  }

  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const respBody = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${respBody}`);
  }

  const data = await res.json();
  return { sha: data.content.sha };
}

/**
 * Commit all dirty drafts (where updatedAt > committedToGithubAt) to GitHub.
 * Called by the daily cron job before journal sync.
 * Returns the number of files committed.
 */
export async function commitDirtyDraftsToGithub(userId: string): Promise<{ committed: number }> {
  // Find drafts that have been updated since their last GitHub commit
  const dirtyDrafts = await db
    .select()
    .from(journalDrafts)
    .where(
      and(
        eq(journalDrafts.userId, userId),
        or(
          isNull(journalDrafts.committedToGithubAt),
          lt(journalDrafts.committedToGithubAt, journalDrafts.updatedAt)
        )
      )
    );

  let committed = 0;

  for (const draft of dirtyDrafts) {
    try {
      const d = new Date(draft.entryDate + "T12:00:00");
      const filename = journalFilename(d);

      // Get current SHA from GitHub (needed for updates)
      const currentSha = await getJournalFileSha(filename);

      // Commit to GitHub
      const result = await createOrUpdateJournalFile(filename, draft.content, currentSha);

      // Update draft record with new SHA and commit timestamp
      await db
        .update(journalDrafts)
        .set({
          githubSha: result.sha,
          committedToGithubAt: new Date(),
        })
        .where(eq(journalDrafts.id, draft.id));

      committed++;
      console.log(`[github] Committed draft for ${draft.entryDate} → ${filename}`);
    } catch (error) {
      console.error(`[github] Failed to commit draft for ${draft.entryDate}:`, error);
      // Continue with other drafts — don't let one failure block the rest
    }
  }

  return { committed };
}
