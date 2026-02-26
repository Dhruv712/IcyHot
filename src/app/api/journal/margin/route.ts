import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { retrieveMemories } from "@/lib/memory/retrieve";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";

export const maxDuration = 15;

// Minimum retrieval activation score — memories below this are too tangential
const MIN_ACTIVATION_SCORE = 0.15;

function buildMarginPrompt(
  paragraph: string,
  fullEntry: string,
  entryDate: string,
  memoriesContext: string,
  implicationsContext: string,
): string {
  const entryTruncated =
    fullEntry.length > 1500 ? fullEntry.slice(0, 1500) + "..." : fullEntry;

  return `You are a margin annotator for a personal journal. You have access to their past memories. Your job: produce 0 or 1 margin annotations. Most of the time you produce 0.

TODAY: ${entryDate}

ENTRY SO FAR:
${entryTruncated}

PARAGRAPH JUST WRITTEN:
"${paragraph}"

PAST MEMORIES:
${memoriesContext || "(none)"}

PATTERNS:
${implicationsContext || "(none)"}

WHEN TO ANNOTATE (must meet ALL criteria):
- There is a DIRECT, OBVIOUS connection between the paragraph and a specific memory
- The connection reveals something the writer likely hasn't noticed — a contradiction, a blind spot, a pattern
- A smart friend reading both would independently spot the same thing

WHEN TO STAY SILENT (return empty):
- The memory is only tangentially related (same person mentioned ≠ meaningful connection)
- You'd be comparing two unrelated situations just because they share a name or context
- The question you'd ask ends with something generic like "what does that tell you?" or "how did that feel?"
- You're reaching. If you have to stretch to make the connection, it's not worth making.
- The paragraph is mundane, logistical, or descriptive without any tension

ANNOTATION TYPES:
1. GHOST QUESTION — Point out something specific they said/did before that directly contradicts or complicates what they just wrote. "You told Josh on 2/10 you'd stop doing X — what happened?"
2. TENSION — Name a concrete contradiction. "On 2/14 you said X. Now you're saying Y."

STRICT RULES:
- Max 1 annotation. 1 sentence. Under 20 words.
- The memory must DIRECTLY relate to the paragraph's actual point, not just share a person or topic.
- No therapy-speak. No "perhaps." No "have you considered." No "what does that tell you."
- Never compare two unrelated interactions just because they involve overlapping people.
- Never annotate unless you'd bet money a thoughtful friend would notice the same thing.
- When in doubt, return empty. Empty is always better than forced.

JSON only:
{"annotations": [{"type": "ghost_question" | "tension", "text": "...", "memoryDate": "YYYY-MM-DD", "memorySnippet": "..."}]}

Nothing interesting? {"annotations": []}`;
}

interface ParsedAnnotation {
  id: string;
  type: "ghost_question" | "tension";
  text: string;
  paragraphIndex: number;
  memoryDate?: string;
  memorySnippet?: string;
}

function parseAnnotations(
  text: string,
  paragraphIndex: number,
): ParsedAnnotation[] {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as {
      annotations: Array<{
        type: string;
        text: string;
        memoryDate?: string;
        memorySnippet?: string;
      }>;
    };

    return (parsed.annotations || [])
      .filter((a) => a.text && a.text.length > 5 && a.text.length < 200)
      .filter((a) => a.type === "ghost_question" || a.type === "tension")
      .slice(0, 1) // Hard cap: 1 annotation per paragraph
      .map((a) => ({
        id: crypto.randomUUID(),
        type: a.type as "ghost_question" | "tension",
        text: a.text,
        paragraphIndex,
        memoryDate: a.memoryDate,
        memorySnippet: a.memorySnippet,
      }));
  } catch {
    console.error("[margin] Failed to parse annotations:", text.slice(0, 200));
    return [];
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { paragraph, fullEntry, entryDate, paragraphIndex } =
    await request.json();

  if (
    !paragraph ||
    typeof paragraph !== "string" ||
    paragraph.trim().length < 20
  ) {
    return NextResponse.json({ annotations: [], paragraphHash: "" });
  }

  const trimmedParagraph = paragraph.trim();
  const paragraphHash = createHash("md5")
    .update(trimmedParagraph)
    .digest("hex")
    .slice(0, 12);

  try {
    // 1. Retrieve memories — optimized for speed (1 hop, no Hebbian writes)
    const retrieval = await retrieveMemories(
      session.user.id,
      trimmedParagraph,
      {
        maxMemories: 8,
        maxHops: 1,
        skipHebbian: true,
        diversify: true,
      },
    );

    // 2. Filter to strongly relevant memories only — weak matches cause forced annotations
    const strongMemories = retrieval.memories.filter(
      (m) => m.activationScore >= MIN_ACTIVATION_SCORE,
    );

    // No strong memories = nothing worth annotating
    if (strongMemories.length === 0 && retrieval.implications.length === 0) {
      return NextResponse.json({ annotations: [], paragraphHash });
    }

    // 3. Build context — only pass strong memories (max 4, not 6)
    const memoriesContext = strongMemories
      .slice(0, 4)
      .map((m) => `[${m.sourceDate}] ${m.content}`)
      .join("\n");

    const implicationsContext = retrieval.implications
      .slice(0, 2)
      .map((i) => `- ${i.content}`)
      .join("\n");

    // 4. Call Haiku for speed
    const client = new Anthropic({ timeout: 10_000 });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: buildMarginPrompt(
            trimmedParagraph,
            fullEntry || "",
            entryDate || new Date().toISOString().slice(0, 10),
            memoriesContext,
            implicationsContext,
          ),
        },
      ],
    });

    // 5. Parse response
    const text =
      response.content[0].type === "text"
        ? response.content[0].text.trim()
        : "";
    const annotations = parseAnnotations(text, paragraphIndex ?? 0);

    return NextResponse.json({ annotations, paragraphHash });
  } catch (error) {
    console.error("[margin] Error:", error);
    // Fail silently — annotations just don't appear
    return NextResponse.json({ annotations: [], paragraphHash });
  }
}
