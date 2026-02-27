import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { retrieveMemories } from "@/lib/memory/retrieve";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { coerceMarginTuning, DEFAULT_MARGIN_TUNING } from "@/lib/marginTuning";

export const maxDuration = 15;

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function annotationFingerprint(
  type: string,
  text: string,
  memoryDate?: string,
  memorySnippet?: string,
): string {
  const payload = [
    type,
    normalizeWhitespace(text).toLowerCase(),
    memoryDate ?? "",
    normalizeWhitespace(memorySnippet ?? "").toLowerCase(),
  ].join("|");
  return createHash("md5").update(payload).digest("hex").slice(0, 16);
}

function buildMarginPrompt(
  paragraph: string,
  fullEntry: string,
  entryDate: string,
  memoriesContext: string,
  implicationsContext: string,
  promptAddendum: string,
  promptOverride: string,
): string {
  const entryTruncated =
    fullEntry.length > 1500 ? fullEntry.slice(0, 1500) + "..." : fullEntry;

  if (promptOverride.trim()) {
    return promptOverride
      .replaceAll("{{entryDate}}", entryDate)
      .replaceAll("{{entry}}", entryTruncated)
      .replaceAll("{{paragraph}}", paragraph)
      .replaceAll("{{memories}}", memoriesContext || "(none)")
      .replaceAll("{{implications}}", implicationsContext || "(none)");
  }

  const addendum = promptAddendum.trim()
    ? `\nEXTRA DIRECTIVE FROM USER:\n${promptAddendum.trim()}\n`
    : "";

  return `You are a margin annotator for a personal journal. You have access to their past memories. Your job: produce 0 or 1 margin annotations.

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
- Be willing to annotate when the signal is clearly useful, even if not dramatic

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
- Max 1 annotation. 1 sentence. Under 22 words.
- The memory must DIRECTLY relate to the paragraph's actual point, not just share a person or topic.
- Use concrete anchors when possible: who, when, and what happened.
- No therapy-speak. No "perhaps." No "have you considered." No "what does that tell you."
- Never compare two unrelated interactions just because they involve overlapping people.
- Never annotate unless you'd bet money a thoughtful friend would notice the same thing.
- When in doubt, return empty. Empty is always better than forced.

${addendum}

JSON only:
{"annotations": [{"type": "ghost_question" | "tension", "text": "...", "memoryDate": "YYYY-MM-DD", "memorySnippet": "...", "confidence": 0.0}]}

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
  minModelConfidence: number,
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
        confidence?: number;
      }>;
    };

    return (parsed.annotations || [])
      .filter((a) => a.text && a.text.length > 8 && a.text.length < 220)
      .filter((a) => a.type === "ghost_question" || a.type === "tension")
      .filter(
        (a) =>
          typeof a.confidence === "number" &&
          a.confidence >= minModelConfidence,
      )
      .slice(0, 1) // Hard cap: 1 annotation per paragraph
      .map((a) => ({
        id: `${annotationFingerprint(
          a.type,
          a.text,
          a.memoryDate,
          a.memorySnippet,
        )}-${paragraphIndex}`,
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

  const { paragraph, fullEntry, entryDate, paragraphIndex, tuning } =
    await request.json();
  const resolvedTuning = coerceMarginTuning(
    tuning ?? DEFAULT_MARGIN_TUNING,
  );
  const server = resolvedTuning.server;

  if (
    !paragraph ||
    typeof paragraph !== "string" ||
    paragraph.trim().length < 20
  ) {
    return NextResponse.json({ annotations: [], paragraphHash: "" });
  }

  const trimmedParagraph = paragraph.trim();
  const wordCount = trimmedParagraph.split(/\s+/).filter(Boolean).length;
  if (wordCount < server.minParagraphWords) {
    return NextResponse.json({ annotations: [], paragraphHash: "" });
  }

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
      (m) => m.activationScore >= server.minActivationScore,
    );
    const topScore = retrieval.memories[0]?.activationScore ?? 0;
    const secondScore = retrieval.memories[1]?.activationScore ?? 0;
    const hasClearSignal =
      topScore >= server.strongTopOverride ||
      (topScore >= server.minTopActivation &&
        (topScore - secondScore >= server.minTopGap || strongMemories.length >= 2));

    console.log(
      `[margin] Retrieved ${retrieval.memories.length} memories, ${strongMemories.length} above threshold (${server.minActivationScore}). Top scores:`,
      retrieval.memories.slice(0, 4).map((m) => ({
        score: m.activationScore.toFixed(3),
        hop: m.hop,
        snippet: m.content.slice(0, 60),
      })),
    );

    // No strong memories or no clear top signal = nothing worth annotating.
    if (
      (strongMemories.length === 0 && retrieval.implications.length === 0) ||
      !hasClearSignal
    ) {
      return NextResponse.json({ annotations: [], paragraphHash });
    }

    // 3. Build context — only pass strong memories (max 4, not 6)
    const memoriesContext = strongMemories
      .slice(0, server.maxMemoriesContext)
      .map((m) => `[${m.sourceDate}] ${m.content}`)
      .join("\n");

    const implicationsContext = retrieval.implications
      .slice(0, server.maxImplicationsContext)
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
            resolvedTuning.promptAddendum,
            resolvedTuning.promptOverride,
          ),
        },
      ],
    });

    // 5. Parse response
    const text =
      response.content[0].type === "text"
        ? response.content[0].text.trim()
        : "";
    const annotations = parseAnnotations(
      text,
      paragraphIndex ?? 0,
      server.minModelConfidence,
    );

    return NextResponse.json({ annotations, paragraphHash });
  } catch (error) {
    console.error("[margin] Error:", error);
    // Fail silently — annotations just don't appear
    return NextResponse.json({ annotations: [], paragraphHash });
  }
}
