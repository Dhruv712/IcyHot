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
  existingContacts: { id: string; name: string }[],
  timeoutMs: number = 40_000
): Promise<ExtractedMemory[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[memory-extract] ANTHROPIC_API_KEY is not set!");
    return [];
  }

  const client = new Anthropic({
    timeout: timeoutMs,
  });

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

Extract every discrete, atomic piece of information from this journal entry. Each memory should capture one meaningful thing — a single fact, event, feeling, decision, observation, or plan.

CRITICAL: Every memory must be SELF-CONTAINED. Someone reading a single memory in isolation, months from now, with no other context, must fully understand WHEN it happened, WHERE it happened, WHO was involved (and who they are), and WHAT the situation was. Always embed:
- Temporal context: date, time of day, "during X meeting"
- Location context with maximum inferrable detail: city, neighborhood, venue, or setting ("in Palo Alto", "at Café Lomi in the 10th arrondissement", "on a Zoom call from your apartment in Paris")
- Relational context: who the person is — "your girlfriend", "a neuroscience professor at Stanford", "your cofounder"
- Situational context: what event or setting this occurred in

If the journal entry mentions or implies a location (city, country, venue, neighborhood, "at home", "at the office", etc.), ALWAYS include it in the memory. If Dhruv is writing from a particular city or country, embed that geographic context IN EACH MEMORY from that context.

Return ONLY valid JSON (no markdown, no explanation):

{
  "memories": [
    {
      "content": "A single atomic memory statement in second person, with full temporal, locational, and relational context",
      "contactNames": ["names of people involved, if any"],
      "significance": "high" | "medium" | "low"
    }
  ]
}

## What makes a good atomic memory:

Note: these are largely fictional, and serve only as examples of quality. Notice how each one is fully self-contained — you could read any single memory in isolation and understand the full picture. Notice also the RIGHT LEVEL OF GRANULARITY — each memory captures one meaningful unit of information, not one sentence fragment.

EVENTS & INTERACTIONS:
- "On the afternoon of January 15, 2026, you went to Café Lomi in the 10th arrondissement in Paris with Theo Strauss, one of your closest friends from college, and he told you about his startup's pivot from B2C to B2B"
- "During a casual dinner on January 20, 2026, you and Nivitha Mavuluri, your girlfriend, tried the new Thai place on Rue de Bretagne in Paris and she loved the pad kra pao"
- "On the evening of February 3, 2026, from your apartment in Paris, you had a 2-hour phone call with Mom where she told you about Dad's knee surgery being scheduled for March 15"
- "On August 11, 2025, you had a Zoom call with Jerry Lu from Maveron (the VC firm started by Howard Schultz) where he told you they think education needs to be redesigned from the ground up rather than just adding AI to existing systems"

FEELINGS & EMOTIONAL STATES:
- "On the morning of January 22, 2026, at your apartment in Berlin, you felt anxious about the upcoming product launch but energized after the team standup at work"
- "After Fynn Comerford, one of your closest friends in Berlin, helped you move apartments in Kreuzberg on January 28, 2026, you felt a deep sense of gratitude toward him"
- "On the evening of February 1, 2026 in Berlin, you were irritated that Georg Von Manstein, a friend from your Berlin circle, cancelled plans last minute for the third time"

DECISIONS & INTENTIONS:
- "On January 18, 2026, at your apartment in Paris, you decided to start waking up at 6:30am instead of 7:30am"
- "During a run along the Canal Saint-Martin in Paris on February 5, 2026, you committed to running the Berlin half-marathon in September"
- "While working on your side project from your apartment in Paris the evening of January 25, 2026, you started considering switching from React to Svelte"

OBSERVATIONS & INSIGHTS:
- "Reflecting in your journal on January 30, 2026, you noticed that you're most productive when you work from the BnF library in Paris, not from home"
- "On February 2, 2026, you realized that your conversations with Sarah Hua, a colleague at work in San Francisco, always gravitate toward work stress and rarely anything fun"
- "After a tense dinner at a restaurant in Mitte, Berlin on January 27, 2026, you think the tension between Fynn Comerford and Georg Von Manstein was about the unresolved apartment deposit issue"

FACTS & INFORMATION:
- "You learned on February 8, 2026 that Theo Strauss's company, based in Berlin, just closed a €2M seed round led by Point Nine"
- "During a phone call on February 3, 2026, Mom mentioned that your cousin Priya is getting married in December in Jaipur"
- "On January 19, 2026, you discovered that the gym near your apartment in the 10th arrondissement in Paris closes at 9pm on weekdays, not 10pm like you thought"

PLACES & EXPERIENCES:
- "On the afternoon of February 10, 2026, you discovered a great co-working space called Station F near Châtelet in Paris"
- "On a Saturday in late January 2026, the hike in Fontainebleau (about an hour south of Paris) with the bouldering circuit was your favorite outdoor activity of the month"

## Rules:

1. SELF-CONTAINED CONTEXT (MOST IMPORTANT). Every memory must include:
   - WHEN: The date or time period ("On February 11, 2026", "During the morning of...", "That evening")
   - WHERE: The location — city, venue, neighborhood, or setting ("in Palo Alto", "at Stanford", "on a Zoom call from Paris", "at your apartment in Berlin"). If the journal implies a location, include it. If Dhruv is clearly in a specific city, embed it.
   - WHO: Full names AND their relationship to you ("Theo Strauss, one of your closest friends", "Anthony Wagner, a neuroscience professor at Stanford", "Nivitha Mavuluri, your girlfriend")
   - WHAT SITUATION: The setting or event ("During your meeting at the Stanford neuroscience lab", "At a dinner party at Fynn's apartment in Kreuzberg", "While working on the CS229 problem set")
   A memory like "Anthony Wagner asked about your vision" is USELESS. Instead: "During a meeting at the Stanford neuroscience lab in Palo Alto on the morning of February 11, 2026, Anthony Wagner, a neuroscience professor, asked what your vision is and where this is going, and you gave a decent but relatively subpar answer."
2. RIGHT LEVEL OF GRANULARITY. "Atomic" means one MEANINGFUL UNIT of information — not one sentence fragment. A meeting with someone where they shared their perspective is ONE memory, not two (one for "you had a call" and another for "they said X"). The goal is that each memory stands alone as a meaningful, self-contained piece of knowledge.
   BAD (too granular):
   - "On August 11, 2025, you had a Zoom call with Jerry Lu from Maveron, the VC firm started by Howard Schultz"
   - "On August 11, 2025, Jerry Lu from Maveron told you they think education needs to be redesigned from the ground up"
   GOOD (right granularity):
   - "On August 11, 2025, you had a Zoom call with Jerry Lu from Maveron (the VC firm started by Howard Schultz) where he told you they think education needs to be redesigned from the ground up rather than just adding AI to existing systems"
   However, if a meeting covers MULTIPLE DISTINCT TOPICS, those should be separate memories — the key is that each memory captures one coherent takeaway, not that it maps 1:1 to sentences.
3. BE EXHAUSTIVE. Extract every piece of information worth remembering. A typical journal entry may yield 10-25 memories. If you're producing fewer than 5, you're being too conservative.
4. BE SPECIFIC. Include names (first AND last, if available), places, cities, dates, numbers, and details. "You had dinner with a friend" is useless. "On the evening of January 20, 2026, you had dinner with Theo Strauss, one of your closest friends from college, at Le Bouillon Chartier in the 9th arrondissement in Paris and he ordered the escargots" is memorable.
5. PRESERVE EMOTIONAL NUANCE. Don't flatten emotions into generic statements. "You felt good" is useless. "After cancelling on Georg Von Manstein the evening of February 1, 2026 in Berlin, you felt relieved but slightly guilty" is memorable.
6. INCLUDE IMPLICIT INFORMATION. If the journal says "another late night at the office," that implies a pattern — extract both the event AND the pattern observation.
7. HEDGE ATTRIBUTED EMOTIONS. When describing an emotional reaction attributed to someone else, use hedging language like "you thought" or "you felt like" rather than stating it as objective fact.
   * Journal: "When she left, Ali was stupefied. She had no clue I spoke Japanese. It really impressed her."
   * BAD: "Ali Debow was stupefied and impressed that you spoke Japanese at the restaurant in Shibuya on January 16, 2026"
   * GOOD: "You thought Ali Debow, your close friend, was stupefied and impressed that you spoke Japanese at the restaurant in Shibuya on the evening of January 16, 2026"
8. QUOTE SUBJECTIVE DESCRIPTORS. When the journal uses subjective or colorful language, preserve it in quotes rather than presenting it as objective fact.
   * Journal: "I discovered an epic beer garden with a chic bungalow in the back."
   * BAD: "On Saturday afternoon, January 17, 2026, you discovered an epic beer garden in Ojai"
   * GOOD: "On Saturday afternoon, January 17, 2026, you discovered an 'epic' beer garden in Ojai with a 'chic' bungalow in the back with a bar and pool table inside"
9. SPECIFY TIMEFRAMES. When the journal mentions both a start and end time (or they can be inferred), include both.
   * Journal: "We discussed next week's plans from 1 p.m. until 1:35 p.m."
   * BAD: "You discussed next week's plans until 1:35 p.m. at the office on Friday, January 16, 2026"
   * GOOD: "You discussed next week's plans with Georg Von Manstein and Theo Strauss from 1 p.m. until 1:35 p.m. at the BCV office in San Francisco on Friday, January 16, 2026"
10. SPECIFY TRANSITIONS. When the journal describes going from one thing to another, include both the origin and destination.
   * Journal: "We discussed next week's plans until 1:35 p.m., then I had to run to get on a Zoom with Kevin."
   * BAD: "You had to run at 1:35 p.m. to get on a Zoom call with Kevin Zhang on Friday, January 16, 2026"
   * GOOD: "You had to leave your meeting with Georg Von Manstein and Theo Strauss at 1:35 p.m. to get on a Zoom call with Kevin Zhang at the BCV office in San Francisco on Friday, January 16, 2026"
11. RESOLVE PRONOUNS. When a person is referenced with a pronoun ("he", "she", "they"), always repeat their full identifying information. Never rely on another memory for context.
   * Journal: "Eventually the guy sitting next to me, whose name was Marquel, and I were just freaking out over the views."
   * BAD: "You and Marquel were freaking out over the views"
   * GOOD: "You and Marquel, the guy who sat next to you on your flight from San Francisco to Los Angeles on Friday, January 16, 2026, were freaking out together over how beautiful the views were"
12. For contactNames: match to the known contacts list. Use the exact name as it appears in the contact list, first AND last if available. If the journal uses a nickname or first name only, match it to the most likely contact. If uncertain about who the most likely contact is, still match it, but write "(inferred last name)" after the name. If a last name is not specified AND the person is not in the contacts list, add the most relevant identifying descriptor instead.
13. For significance:
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
