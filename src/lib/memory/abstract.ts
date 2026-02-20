/**
 * Abstract memory generation — Phase 7.
 * Strips names, dates, locations from a memory to produce a structural/emotional abstract.
 * The abstract is then embedded to enable cross-domain connection discovery.
 */

import Anthropic from "@anthropic-ai/sdk";
import { embedSingle } from "./embed";

const ABSTRACT_PROMPT = `Rewrite this personal memory as a brief abstract description of the underlying dynamic, stripping ALL names, dates, locations, and specific entities. Focus on:
- The emotional arc or dynamic
- The behavioral pattern
- The relational structure
- The situational archetype

Examples of good abstractions:
- Original: "On February 3, you showed Nivitha Mavuluri the Katz's Deli scene from When Harry Met Sally at your apartment in Paris"
  Abstract: "Sharing a beloved cultural touchstone with a romantic partner to build intimacy through vulnerability — letting someone see what shaped you"

- Original: "You cold-emailed the Eames Foundation to get a private tour of the house"
  Abstract: "Taking bold initiative to create a meaningful experience by reaching out to strangers — a pattern of not letting social barriers stop you from pursuing what excites you"

- Original: "Georg Von Manstein cancelled dinner plans for the third time this month"
  Abstract: "Repeated cancellations from a friend creating a pattern of unreliability that erodes trust and generates quiet frustration"

Rules:
1. Output ONLY the abstract — no explanation, no labels, no markdown
2. 1-2 sentences maximum
3. Strip ALL proper nouns, dates, and locations — replace with relational roles (friend, partner, colleague)
4. Capture the WHY and the PATTERN, not just the WHAT
5. Be specific about the emotional/behavioral dynamic, not generic

Memory to abstract:
"{content}"`;

export async function abstractMemory(content: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const client = new Anthropic({ timeout: 15_000 });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: ABSTRACT_PROMPT.replace("{content}", content),
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  if (!text || text.length < 10) {
    throw new Error(`Abstract too short: "${text}"`);
  }

  return text;
}

/**
 * Generate abstract text and embed it in one call.
 * Returns the embedding vector (1024-dim) or null on failure.
 */
export async function generateAbstractEmbedding(
  content: string
): Promise<number[] | null> {
  try {
    const abstractText = await abstractMemory(content);
    const embedding = await embedSingle(abstractText);
    return embedding;
  } catch (error) {
    console.error(
      `[abstract] Failed to generate abstract embedding: ${error instanceof Error ? error.message : error}`
    );
    return null;
  }
}
