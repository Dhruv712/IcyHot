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

CRITICAL: Every memory must be SELF-CONTAINED. Someone reading a single memory in isolation, months from now, with no other context, must fully understand WHEN it happened, WHO was involved (and who they are), and WHAT the situation was. Always embed temporal context (date, time of day, "during X meeting"), relational context (who the person is — "your girlfriend", "a neuroscience professor", "your cofounder"), and situational context (what event or setting this occurred in).

Return ONLY valid JSON (no markdown, no explanation):

{
  "memories": [
    {
      "content": "A single atomic memory statement in second person, with full temporal and relational context",
      "contactNames": ["names of people involved, if any"],
      "significance": "high" | "medium" | "low"
    }
  ]
}

## What makes a good atomic memory:

Note: these are largely fictional, and serve only as examples of quality. Notice how each one is fully self-contained — you could read any single memory in isolation and understand the full picture.

EVENTS & INTERACTIONS:
- "On the afternoon of January 15, 2026, you went to Café Lomi with Theo Strauss, one of your closest friends from college, and he told you about his startup's pivot from B2C to B2B"
- "During a casual dinner on January 20, 2026, you and Nivitha Mavuluri, your girlfriend, tried the new Thai place on Rue de Bretagne and she loved the pad kra pao"
- "On the evening of February 3, 2026, you had a 2-hour phone call with Mom where she told you about Dad's knee surgery being scheduled for March 15"

FEELINGS & EMOTIONAL STATES:
- "On the morning of January 22, 2026, you felt anxious about the upcoming product launch but energized after the team standup at work"
- "After Fynn Comerford, one of your closest friends in Berlin, helped you move apartments on January 28, 2026, you felt a deep sense of gratitude toward him"
- "On the evening of February 1, 2026, you were irritated that Georg Von Manstein, a friend from your Berlin circle, cancelled plans last minute for the third time"

DECISIONS & INTENTIONS:
- "On January 18, 2026, you decided to start waking up at 6:30am instead of 7:30am"
- "During a run on February 5, 2026, you committed to running the Berlin half-marathon in September"
- "While working on your side project the evening of January 25, 2026, you started considering switching from React to Svelte"

OBSERVATIONS & INSIGHTS:
- "Reflecting in your journal on January 30, 2026, you noticed that you're most productive when you work from the library, not from home"
- "On February 2, 2026, you realized that your conversations with Sarah Hua, a colleague, always gravitate toward work stress and rarely anything fun"
- "After a tense dinner on January 27, 2026, you think the tension between Fynn Comerford and Georg Von Manstein was about the unresolved apartment deposit issue"

FACTS & INFORMATION:
- "You learned on February 8, 2026 that Theo Strauss's company just closed a €2M seed round led by Point Nine"
- "During a phone call on February 3, 2026, Mom mentioned that your cousin Priya is getting married in December in Jaipur"
- "On January 19, 2026, you discovered that the gym near your apartment closes at 9pm on weekdays, not 10pm like you thought"

PLACES & EXPERIENCES:
- "On the afternoon of February 10, 2026, you discovered a great co-working space called Station F near Châtelet"
- "On a Saturday in late January 2026, the hike in Fontainebleau with the bouldering circuit was your favorite outdoor activity of the month"

## Rules:

1. SELF-CONTAINED CONTEXT (MOST IMPORTANT). Every memory must include:
   - WHEN: The date or time period ("On February 11, 2026", "During the morning of...", "That evening")
   - WHO: Full names AND their relationship to you ("Theo Strauss, one of your closest friends", "Anthony Wagner, a neuroscience professor at Stanford", "Nivitha Mavuluri, your girlfriend")
   - WHAT SITUATION: The setting or event ("During your meeting at the Stanford neuroscience lab", "At a dinner party at Fynn's apartment", "While working on the CS229 problem set")
   A memory like "Anthony Wagner asked about your vision" is USELESS. Instead: "During a meeting at the Stanford neuroscience lab on the morning of February 11, 2026, Anthony Wagner, a neuroscience professor, asked what your vision is and where this is going, and you gave a decent but relatively subpar answer."
2. BE EXHAUSTIVE. Extract every piece of information worth remembering. A typical journal entry may yield 10-25 memories. If you're producing fewer than 5, you're being too conservative.
3. BE ATOMIC. Each memory should contain exactly ONE piece of information. If a sentence has two facts ("We went to dinner and she told me about her promotion"), make TWO memories. But each one must still have full context.
4. BE SPECIFIC. Include names (first AND last, if available), places, dates, numbers, and details. "You had dinner with a friend" is useless. "On the evening of January 20, 2026, you had dinner with Theo Strauss, one of your closest friends from college, at Le Bouillon Chartier and he ordered the escargots" is memorable.
5. PRESERVE EMOTIONAL NUANCE. Don't flatten emotions into generic statements. "You felt good" is useless. "After cancelling on Georg Von Manstein the evening of February 1, 2026, you felt relieved but slightly guilty" is memorable.
6. INCLUDE IMPLICIT INFORMATION. If the journal says "another late night at the office," that implies a pattern — extract both the event AND the pattern observation.
7. For contactNames: match to the known contacts list. Use the exact name as it appears in the contact list, first AND last if available. If the journal uses a nickname or first name only, match it to the most likely contact. Leave the array empty if no one is mentioned.
8. For significance:
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
