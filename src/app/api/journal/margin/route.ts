import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { retrieveMemories } from "@/lib/memory/retrieve";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";

export const maxDuration = 15;

function buildMarginPrompt(
  paragraph: string,
  fullEntry: string,
  entryDate: string,
  memoriesContext: string,
  implicationsContext: string,
): string {
  const entryTruncated =
    fullEntry.length > 1500 ? fullEntry.slice(0, 1500) + "..." : fullEntry;

  return `You are a margin annotator for a personal journal. You write SHORT notes in the margin — like a sharp coach reading over someone's shoulder. You have access to their past memories.

TODAY'S DATE: ${entryDate}

FULL ENTRY SO FAR:
${entryTruncated}

PARAGRAPH JUST WRITTEN:
"${paragraph}"

PAST MEMORIES (from their journal/calendar history):
${memoriesContext || "(no relevant memories found)"}

PATTERNS/IMPLICATIONS FROM THEIR HISTORY:
${implicationsContext || "(none)"}

YOUR JOB: Read the paragraph. Check it against the past memories. Produce 0-2 margin annotations.

TWO TYPES:
1. GHOST QUESTION — A probing question they haven't asked themselves. Must reference a specific memory. Not generic. Not "have you considered" — more like "You said X on [date]. What changed?"
2. TENSION — Flag a specific contradiction between what they're writing now and what they wrote/did before. Cite the date and what they said. Not a gentle nudge — name the contradiction directly.

RULES:
- 1 sentence each. Max 20 words. No exceptions.
- Ground EVERY annotation in a specific memory with a date. If you can't cite something specific, don't write it.
- No therapy-speak. No "perhaps." No "it's worth noting." No "have you considered." Say the thing directly.
- If the paragraph is mundane, logistical, or has no interesting tension with past memories: return EMPTY. Most paragraphs should return nothing. Only fire when something genuinely interesting jumps out.
- Name names. Cite dates. Be specific or be silent.
- Tone: direct, warm, slightly provocative. A smart friend's margin scribble, not a therapist's note.
- Never compliment or affirm what they wrote. You're not here to validate — you're here to push.

Return ONLY valid JSON:
{
  "annotations": [
    {
      "type": "ghost_question" | "tension",
      "text": "The annotation — one sentence, specific, grounded",
      "memoryDate": "YYYY-MM-DD of the cited memory",
      "memorySnippet": "Brief excerpt from the memory being referenced (10-15 words)"
    }
  ]
}

If nothing interesting: {"annotations": []}`;
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
      .slice(0, 2)
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

    // 2. No memories = nothing to ground on
    if (
      retrieval.memories.length === 0 &&
      retrieval.implications.length === 0
    ) {
      return NextResponse.json({ annotations: [], paragraphHash });
    }

    // 3. Build context
    const memoriesContext = retrieval.memories
      .slice(0, 6)
      .map((m) => `[${m.sourceDate}] ${m.content}`)
      .join("\n");

    const implicationsContext = retrieval.implications
      .slice(0, 3)
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
