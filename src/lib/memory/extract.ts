/**
 * Memory extraction — Prompt A.
 * Extracts atomic memories from a journal entry via LLM.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { JournalMentionReference } from "@/lib/journalRichText";

export const MEMORY_ROLE_TAGS = [
  "family",
  "close_friend",
  "friend",
  "colleague",
  "acquaintance",
  "other",
] as const;

export type MemoryRoleTag = (typeof MEMORY_ROLE_TAGS)[number];

export interface ExtractedMemoryRoleHint {
  name: string;
  role: MemoryRoleTag;
}

export interface ExtractedMemory {
  content: string;
  semanticContent: string;
  peopleInvolvedNames: string[];
  peopleRoleHints: ExtractedMemoryRoleHint[];
  locationHints?: string[];
  temporalHints?: string[];
  semanticFallback?: boolean;
  significance: "high" | "medium" | "low";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRoleTag(value: unknown): MemoryRoleTag {
  const normalized =
    typeof value === "string"
      ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
  return MEMORY_ROLE_TAGS.includes(normalized as MemoryRoleTag)
    ? (normalized as MemoryRoleTag)
    : "other";
}

function sanitizeSemanticText(
  input: string,
  roleHints: ExtractedMemoryRoleHint[],
  peopleInvolvedNames: string[]
): string {
  let text = input;

  const roleByName = new Map<string, MemoryRoleTag>();
  for (const hint of roleHints) {
    const key = hint.name.toLowerCase().trim();
    if (!key) continue;
    roleByName.set(key, normalizeRoleTag(hint.role));
  }

  const allNames = Array.from(
    new Set(
      [...peopleInvolvedNames, ...roleHints.map((hint) => hint.name)]
        .map((name) => name.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => b.length - a.length);

  for (const name of allNames) {
    const role = roleByName.get(name.toLowerCase()) ?? "other";
    text = text.replace(
      new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi"),
      `[${role}]`
    );
  }

  // Remove explicit temporal specificity for semantic geometry.
  text = text
    .replace(
      /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/gi,
      "[time]"
    )
    .replace(
      /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
      "[time]"
    )
    .replace(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi, "[time]")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[time]")
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, "[time]")
    .replace(/\b\d{4}\b/g, "[time]")
    .replace(/\[(time)\](?:\s*\[(time)\])+/gi, "[time]");

  // Strip capitalized location phrase tails conservatively.
  text = text.replace(
    /\b(?:in|at|from|near|around|on)\s+(?:the\s+)?(?:[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,3})/g,
    ""
  );

  text = text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

  return text;
}

function deriveSemanticFromContent(
  content: string,
  roleHints: ExtractedMemoryRoleHint[],
  peopleInvolvedNames: string[]
): string {
  return sanitizeSemanticText(content, roleHints, peopleInvolvedNames);
}

export async function extractMemories(
  journalText: string,
  entryDate: string,
  existingContacts: {
    id: string;
    name: string;
    relationshipType?:
      | "family"
      | "close_friend"
      | "friend"
      | "colleague"
      | "acquaintance"
      | "other";
  }[],
  explicitMentions: JournalMentionReference[] = [],
  timeoutMs: number = 90_000
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
      ? existingContacts
          .map(
            (c) =>
              `- "${c.name}" (id: "${c.id}", relationshipType: "${c.relationshipType ?? "other"}")`
          )
          .join("\n")
      : "(no contacts yet)";
  const mentionListStr =
    explicitMentions.length > 0
      ? explicitMentions
          .map(
            (m) =>
              `- "${m.label}" (contact id: "${m.contactId}", mentioned ${m.occurrences} time${m.occurrences === 1 ? "" : "s"})`,
          )
          .join("\n")
      : "(no explicit mentions)";

  const prompt = `You are extracting personal memories from a journal entry.

The journal belongs to Dhruv. Use "you" (second person) in memory text.

Known contacts:
${contactListStr}

Explicitly tagged people in this entry:
${mentionListStr}

## Journal entry date: ${entryDate}

## Entry text:
${journalText}

Return ONLY valid JSON:
{
  "memories": [
    {
      "content": "Detailed, self-contained memory statement with names/dates/places preserved",
      "semanticContent": "De-identified semantic version with role tags only (no names, no explicit dates/times/locations)",
      "peopleInvolvedNames": ["exact names involved if any"],
      "peopleRoleHints": [
        {
          "name": "person name from peopleInvolvedNames",
          "role": "family" | "close_friend" | "friend" | "colleague" | "acquaintance" | "other"
        }
      ],
      "locationHints": ["optional location hints from the event"],
      "temporalHints": ["optional temporal hints from the event"],
      "significance": "high" | "medium" | "low"
    }
  ]
}

Rules:
1. Extract atomic memories at the right granularity: each memory is one coherent takeaway.
2. "content" must remain human-readable and specific (who/when/where/what).
3. "semanticContent" must be role-only and de-identified:
   - Replace people with role tags like [close_friend], [colleague], [family].
   - Do NOT include real names.
   - Do NOT include explicit dates/times.
   - Do NOT include explicit places.
   - Preserve core event, emotional dynamic, decision, or pattern.
4. Keep peopleInvolvedNames exhaustive and use full names when available.
5. If uncertain about a role, use "other".
6. significance:
   - high: major events/decisions/intense emotional states
   - medium: notable interactions, observations, plans
   - low: routine but still potentially useful context
7. Be exhaustive but avoid duplicates.
8. Return JSON only, no markdown or commentary.`;

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

    const parsed = JSON.parse(jsonMatch[0]) as { memories: Array<Record<string, unknown>> };

    if (!Array.isArray(parsed.memories)) {
      console.error("[memory-extract] Response missing memories array");
      return [];
    }

    const valid: ExtractedMemory[] = parsed.memories
      .map((rawMemory) => {
        const content =
          typeof rawMemory.content === "string" ? rawMemory.content.trim() : "";
        if (!content) return null;

        const peopleInvolvedNames = Array.isArray(rawMemory.peopleInvolvedNames)
          ? rawMemory.peopleInvolvedNames
              .map((name) => (typeof name === "string" ? name.trim() : ""))
              .filter(Boolean)
          : [];

        const peopleRoleHints = Array.isArray(rawMemory.peopleRoleHints)
          ? rawMemory.peopleRoleHints
              .map((hint): ExtractedMemoryRoleHint | null => {
                if (!hint || typeof hint !== "object") return null;
                const typed = hint as { name?: unknown; role?: unknown };
                const name =
                  typeof typed.name === "string" ? typed.name.trim() : "";
                if (!name) return null;
                return {
                  name,
                  role: normalizeRoleTag(typed.role),
                };
              })
              .filter((hint): hint is ExtractedMemoryRoleHint => Boolean(hint))
          : [];

        const providedSemantic =
          typeof rawMemory.semanticContent === "string"
            ? rawMemory.semanticContent.trim()
            : "";
        let semanticContent = sanitizeSemanticText(
          providedSemantic,
          peopleRoleHints,
          peopleInvolvedNames
        );
        let semanticFallback = false;
        if (!semanticContent || semanticContent.length < 8) {
          semanticContent = deriveSemanticFromContent(
            content,
            peopleRoleHints,
            peopleInvolvedNames
          );
          semanticFallback = true;
        }

        if (!semanticContent || semanticContent.length < 8) {
          return null;
        }

        const significance =
          rawMemory.significance === "high" ||
          rawMemory.significance === "medium" ||
          rawMemory.significance === "low"
            ? rawMemory.significance
            : "medium";

        const locationHints = Array.isArray(rawMemory.locationHints)
          ? rawMemory.locationHints
              .map((hint) => (typeof hint === "string" ? hint.trim() : ""))
              .filter(Boolean)
              .slice(0, 6)
          : undefined;
        const temporalHints = Array.isArray(rawMemory.temporalHints)
          ? rawMemory.temporalHints
              .map((hint) => (typeof hint === "string" ? hint.trim() : ""))
              .filter(Boolean)
              .slice(0, 6)
          : undefined;

        const extractedMemory: ExtractedMemory = {
          content,
          semanticContent,
          peopleInvolvedNames,
          peopleRoleHints,
          semanticFallback,
          significance,
          ...(locationHints ? { locationHints } : {}),
          ...(temporalHints ? { temporalHints } : {}),
        };

        return extractedMemory;
      })
      .filter((memory): memory is ExtractedMemory => Boolean(memory));

    console.log(
      `[memory-extract] Extracted ${valid.length} memories (${valid.filter((m) => m.significance === "high").length} high, ${valid.filter((m) => m.significance === "medium").length} medium, ${valid.filter((m) => m.significance === "low").length} low, ${valid.filter((m) => m.semanticFallback).length} semantic-fallback)`
    );

    return valid;
  } catch (error) {
    console.error("[memory-extract] Extraction failed:", error);
    return [];
  }
}
