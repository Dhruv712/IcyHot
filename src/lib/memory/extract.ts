/**
 * Memory extraction — Prompt A.
 * Extracts atomic memories from a journal entry via LLM.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface ExtractedMemory {
  content: string;
  contactNames: string[];
  significance: "high" | "medium" | "low";
}

export async function extractMemories(
  journalText: string,
  entryDate: string,
  existingContacts: { id: string; name: string }[]
): Promise<ExtractedMemory[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[memory-extract] ANTHROPIC_API_KEY is not set!");
    return [];
  }

  const client = new Anthropic();

  const contactListStr =
    existingContacts.length > 0
      ? existingContacts.map((c) => `- "${c.name}" (id: "${c.id}")`).join("\n")
      : "(no contacts yet)";

  const prompt = `You are analyzing a personal journal entry to extract atomic memories — discrete, individual pieces of information that are worth remembering long-term.

The journal belongs to Dhruv. When writing memories, use "you" (second person) — never say "the writer" or "the author" or "Dhruv."

Known contacts:
${contactListStr}

## Journal entry date: ${entryDate}

## ${journalText}

Extract every discrete, atomic piece of information from this journal entry. Each memory should capture ONE specific thing — a single fact, event, feeling, decision, observation, or plan.

Return ONLY valid JSON (no markdown, no explanation):

{
  "memories": [
    {
      "content": "A single atomic memory statement in second person",
      "contactNames": ["names of people involved, if any"],
      "significance": "high" | "medium" | "low"
    }
  ]
}

## What makes a good atomic memory:

Note: these are largely fictional, and serve only as examples of quality.

EVENTS & INTERACTIONS:
- "You went to Café Lomi with Theo Strauss and talked about his startup pivot from B2C to B2B"
- "You and Nivitha Mavuluri tried the new Thai place on Rue de Bretagne and she loved the pad kra pao"
- "You had a 2-hour phone call with Mom where she told you about Dad's knee surgery being scheduled for March 15"

FEELINGS & EMOTIONAL STATES:
- "You felt anxious about the product launch but energized after the team standup"
- "You felt a deep sense of gratitude toward Fynn for helping you move apartments"
- "You were irritated that Georg Von Manstein cancelled plans last minute for the third time"

DECISIONS & INTENTIONS:
- "You decided to start waking up at 6:30am instead of 7:30am"
- "You committed to running the Berlin half-marathon in September"
- "You're considering switching from React to Svelte for your side project"

OBSERVATIONS & INSIGHTS:
- "You noticed that you're most productive when you work from the library, not from home"
- "You realized that your conversations with Sarah always gravitate toward work stress and rarely anything fun"
- "You think the tension between Fynn Comerford and Georg Von Manstein at dinner was about the unresolved apartment deposit issue"

FACTS & INFORMATION:
- "Theo Strauss's company just closed a €2M seed round led by Point Nine"
- "Mom mentioned that your cousin Priya is getting married in December in Jaipur"
- "The gym near your apartment closes at 9pm on weekdays, not 10pm like you thought"

PLACES & EXPERIENCES:
- "You discovered a great co-working space called Station F near Châtelet"
- "The hike in Fontainebleau with the bouldering circuit was your favorite outdoor activity this month"

## Rules:

1. BE EXHAUSTIVE. Extract every piece of information worth remembering. A typical journal entry may yield 10-25 memories. If you're producing fewer than 5, you're being too conservative.
2. BE ATOMIC. Each memory should contain exactly ONE piece of information. If a sentence has two facts ("We went to dinner and she told me about her promotion"), make TWO memories.
3. BE SPECIFIC. Include names (first AND last, if available), places, dates, numbers, and details. "You had dinner with a friend" is useless. "You had dinner with Theo Strauss at Le Bouillon Chartier and he ordered the escargots" is memorable.
4. PRESERVE EMOTIONAL NUANCE. Don't flatten emotions into generic statements. "You felt good" is useless. "You felt relieved and slightly guilty about cancelling on Georg" is memorable.
5. INCLUDE IMPLICIT INFORMATION. If the journal says "another late night at the office," that implies a pattern — extract both the event AND the pattern observation.
6. For contactNames: match to the known contacts list. Use the exact name as it appears in the contact list, first AND last if available. If the journal uses a nickname or first name only, match it to the most likely contact. Leave the array empty if no one is mentioned.
7. For significance:
   - "high": Major life events, important decisions, strong emotions, relationship milestones
   - "medium": Notable interactions, interesting observations, plans being made
   - "low": Routine details, minor facts, passing observations (still extract these — they build context over time)`;

  try {
    // Use Sonnet for quality extraction
    const stream = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const response = await stream.finalMessage();
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    console.log(
      `[memory-extract] Response: stop_reason=${response.stop_reason}, text length=${text.length}`
    );

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(
        `[memory-extract] No JSON found in response. First 500 chars: ${text.slice(0, 500)}`
      );
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      memories: ExtractedMemory[];
    };

    if (!Array.isArray(parsed.memories)) {
      console.error("[memory-extract] Response missing memories array");
      return [];
    }

    // Validate each memory
    const valid = parsed.memories.filter((m) => {
      if (!m.content || typeof m.content !== "string") return false;
      if (!Array.isArray(m.contactNames)) m.contactNames = [];
      if (!["high", "medium", "low"].includes(m.significance))
        m.significance = "medium";
      return true;
    });

    console.log(
      `[memory-extract] Extracted ${valid.length} memories (${valid.filter((m) => m.significance === "high").length} high, ${valid.filter((m) => m.significance === "medium").length} medium, ${valid.filter((m) => m.significance === "low").length} low)`
    );

    return valid;
  } catch (error) {
    console.error("[memory-extract] Extraction failed:", error);
    return [];
  }
}
