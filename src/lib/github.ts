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
  const name = filename.replace(/\.md$/, "");
  const d = new Date(name);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
