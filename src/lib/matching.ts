import Anthropic from "@anthropic-ai/sdk";

interface Attendee {
  email: string;
  displayName: string | null;
}

interface Contact {
  id: string;
  name: string;
  email: string | null;
}

export interface Match {
  contactId: string;
  attendeeEmail: string;
  confidence: number;
  method: "email_exact" | "name_exact" | "email_username" | "llm_name" | "title_mention" | "manual";
}

/**
 * Normalize a name for comparison: lowercase, trim, collapse whitespace.
 */
function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

// Common non-name email prefixes to filter out
const NON_NAME_PREFIXES = new Set([
  "info", "admin", "hello", "contact", "support", "noreply",
  "no-reply", "team", "sales", "help", "office", "mail",
  "newsletter", "notifications", "billing", "service",
]);

/**
 * Extract a potential human name from an email address.
 * E.g. "georg.vonmanstein@gmail.com" → "georg vonmanstein"
 *      "nivitha.s@gmail.com" → "nivitha s"
 *      "noreply@company.com" → null
 */
function extractNameFromEmail(email: string): string | null {
  const localPart = email.split("@")[0];
  if (!localPart) return null;

  // Replace separators with spaces
  const cleaned = localPart.replace(/[._\-+]/g, " ").trim().replace(/\s+/g, " ");
  if (!cleaned) return null;

  // Filter out non-name patterns
  if (NON_NAME_PREFIXES.has(cleaned.toLowerCase())) return null;

  // Remove purely numeric tokens
  const parts = cleaned.split(" ").filter((p) => !/^\d+$/.test(p));
  if (parts.length === 0) return null;

  // If what's left is a single character, not useful
  if (parts.join("").length <= 1) return null;

  return parts.join(" ").toLowerCase();
}

/**
 * Run name matching logic against contacts for a given derived name.
 * Returns the best match or null.
 */
function matchNameAgainstContacts(
  derivedName: string,
  availableContacts: Contact[],
  matchedContactIds: Set<string>
): { contact: Contact; confidence: number } | null {
  const filtered = availableContacts.filter((c) => !matchedContactIds.has(c.id));
  const nameParts = derivedName.split(" ");
  const firstName = nameParts[0];

  // Exact full name match
  const fullMatch = filtered.find((c) => normalizeName(c.name) === derivedName);
  if (fullMatch) return { contact: fullMatch, confidence: 0.8 };

  // First-name-only match (single-word contact vs derived first name, or vice versa)
  const firstOnlyMatch = filtered.find((c) => {
    const contactNorm = normalizeName(c.name);
    if (!contactNorm.includes(" ") && contactNorm === firstName) return true;
    const contactFirst = contactNorm.split(" ")[0];
    if (nameParts.length === 1 && contactFirst === derivedName) return true;
    return false;
  });
  if (firstOnlyMatch) return { contact: firstOnlyMatch, confidence: 0.7 };

  // First+last name match
  if (nameParts.length >= 2) {
    const lastName = nameParts[nameParts.length - 1];
    const firstLastMatch = filtered.find((c) => {
      const contactParts = normalizeName(c.name).split(" ");
      if (contactParts.length < 2) return false;
      return contactParts[0] === firstName && contactParts[contactParts.length - 1] === lastName;
    });
    if (firstLastMatch) return { contact: firstLastMatch, confidence: 0.75 };
  }

  return null;
}

/**
 * Multi-tier attendee matching:
 * 1. Exact email match (free, instant, 100% confidence)
 * 2. Name match from displayName (free, instant, 0.85-0.95 confidence)
 * 2.5. Email username heuristic (free, instant, 0.7-0.8 confidence)
 * 3. LLM match via Claude Haiku (smart, handles everything else)
 */
export async function matchEventAttendees(
  attendees: Attendee[],
  contacts: Contact[],
  eventSummary?: string | null
): Promise<Match[]> {
  if (attendees.length === 0 || contacts.length === 0) return [];

  const matches: Match[] = [];
  const matchedContactIds = new Set<string>();
  let unmatched: Attendee[] = [];

  // Tier 1: Exact email matching
  for (const attendee of attendees) {
    const emailMatch = contacts.find(
      (c) =>
        c.email &&
        c.email.toLowerCase() === attendee.email.toLowerCase()
    );
    if (emailMatch) {
      matches.push({
        contactId: emailMatch.id,
        attendeeEmail: attendee.email,
        confidence: 1.0,
        method: "email_exact",
      });
      matchedContactIds.add(emailMatch.id);
    } else {
      unmatched.push(attendee);
    }
  }

  // Tier 2: Name matching (displayName vs contact name)
  const stillUnmatched: Attendee[] = [];
  for (const attendee of unmatched) {
    if (!attendee.displayName) {
      stillUnmatched.push(attendee);
      continue;
    }

    const attendeeName = normalizeName(attendee.displayName);
    const availableContacts = contacts.filter((c) => !matchedContactIds.has(c.id));

    // Try exact full name match
    const fullMatch = availableContacts.find(
      (c) => normalizeName(c.name) === attendeeName
    );
    if (fullMatch) {
      matches.push({
        contactId: fullMatch.id,
        attendeeEmail: attendee.email,
        confidence: 0.95,
        method: "name_exact",
      });
      matchedContactIds.add(fullMatch.id);
      continue;
    }

    // Try first-name-only match (one-word contact vs attendee's first name, or vice versa)
    const attendeeParts = attendeeName.split(" ");
    const attendeeFirst = attendeeParts[0];
    const firstOnlyMatch = availableContacts.find((c) => {
      const contactNorm = normalizeName(c.name);
      if (!contactNorm.includes(" ") && contactNorm === attendeeFirst) return true;
      const contactFirst = contactNorm.split(" ")[0];
      if (attendeeParts.length === 1 && contactFirst === attendeeName) return true;
      return false;
    });
    if (firstOnlyMatch) {
      matches.push({
        contactId: firstOnlyMatch.id,
        attendeeEmail: attendee.email,
        confidence: 0.85,
        method: "name_exact",
      });
      matchedContactIds.add(firstOnlyMatch.id);
      continue;
    }

    // Try first+last name match (if attendee has first+last and contact has first+last)
    if (attendeeParts.length >= 2) {
      const attendeeLast = attendeeParts[attendeeParts.length - 1];
      const firstLastMatch = availableContacts.find((c) => {
        const contactParts = normalizeName(c.name).split(" ");
        if (contactParts.length < 2) return false;
        const contactFirst = contactParts[0];
        const contactLast = contactParts[contactParts.length - 1];
        return contactFirst === attendeeFirst && contactLast === attendeeLast;
      });
      if (firstLastMatch) {
        matches.push({
          contactId: firstLastMatch.id,
          attendeeEmail: attendee.email,
          confidence: 0.9,
          method: "name_exact",
        });
        matchedContactIds.add(firstLastMatch.id);
        continue;
      }
    }

    stillUnmatched.push(attendee);
  }
  unmatched = stillUnmatched;

  // Tier 2.5: Email username heuristic
  const emailUnmatched: Attendee[] = [];
  for (const attendee of unmatched) {
    const derivedName = extractNameFromEmail(attendee.email);
    if (!derivedName) {
      emailUnmatched.push(attendee);
      continue;
    }

    const result = matchNameAgainstContacts(derivedName, contacts, matchedContactIds);
    if (result) {
      matches.push({
        contactId: result.contact.id,
        attendeeEmail: attendee.email,
        confidence: result.confidence,
        method: "email_username",
      });
      matchedContactIds.add(result.contact.id);
    } else {
      emailUnmatched.push(attendee);
    }
  }
  unmatched = emailUnmatched;

  // Tier 3: LLM matching for remaining (smart-aggressive)
  if (unmatched.length > 0 && process.env.ANTHROPIC_API_KEY) {
    const llmMatches = await matchWithLLM(unmatched, contacts, eventSummary);
    matches.push(...llmMatches);
  }

  return matches;
}

/**
 * Use Claude to intelligently match attendees to contacts.
 * Given full context (event title, emails, display names, contact names + emails),
 * the LLM can infer matches from email patterns, nicknames, event context, etc.
 */
async function matchWithLLM(
  attendees: Attendee[],
  contacts: Contact[],
  eventSummary?: string | null
): Promise<Match[]> {
  try {
    const client = new Anthropic();

    const attendeeList = attendees
      .map(
        (a) =>
          `- "${a.displayName || "(no display name)"}" <${a.email}>`
      )
      .join("\n");

    const contactList = contacts
      .map((c) => `- id: "${c.id}", name: "${c.name}", email: "${c.email || "(none)"}"`)
      .join("\n");

    const eventContext = eventSummary
      ? `\nEvent title: "${eventSummary}"\n`
      : "";

    const response = await client.messages.create({
      model: "claude-haiku-4-20250414",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Match these calendar event attendees to my contacts. Be aggressive — it's better to suggest a possible match at low confidence than to miss a real one. I'll confirm uncertain matches.
${eventContext}
Attendees:
${attendeeList}

My contacts:
${contactList}

Return ONLY a JSON array (no markdown, no explanation). Each element should be:
{"attendeeEmail": "...", "contactId": "...", "confidence": 0.0-1.0}

Matching strategies:
- Exact name match = 0.95
- Clear nickname/variation (Bob/Robert, Mike/Michael) = 0.85
- Email username looks like contact name (e.g. "john.smith@x.com" → "John Smith") = 0.75
- Partial name overlap or name fragment match = 0.5
- Weak signal (event title mentions a name, email domain hints) = 0.3
- Include ALL matches with confidence >= 0.3
- If no reasonable match exists for an attendee, omit them
- Return an empty array [] if no matches found`,
        },
      ],
    });

    // Parse response
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as {
      attendeeEmail: string;
      contactId: string;
      confidence: number;
    }[];

    // Validate and convert to Match objects
    const validContactIds = new Set(contacts.map((c) => c.id));
    return parsed
      .filter(
        (m) =>
          m.confidence >= 0.3 &&
          validContactIds.has(m.contactId) &&
          attendees.some((a) => a.email === m.attendeeEmail)
      )
      .map((m) => ({
        contactId: m.contactId,
        attendeeEmail: m.attendeeEmail,
        confidence: m.confidence,
        method: "llm_name" as const,
      }));
  } catch (error) {
    console.error("LLM matching error:", error);
    return [];
  }
}

/**
 * Match a private calendar event (no attendees) to contacts by scanning the event title.
 * E.g. "Coffee with Nivitha" → matches contact "Nivitha"
 *      "Lunch - John & Sarah" → matches contacts "John Smith" and "Sarah Lee"
 *
 * Two tiers: heuristic name scan, then LLM fallback.
 */
export async function matchEventTitle(
  summary: string,
  contacts: Contact[]
): Promise<Match[]> {
  if (!summary.trim() || contacts.length === 0) return [];

  const matches: Match[] = [];
  const matchedContactIds = new Set<string>();
  const titleNorm = normalizeName(summary);

  // Tier A: Heuristic name scan — check if any contact name appears in the title
  for (const contact of contacts) {
    if (matchedContactIds.has(contact.id)) continue;

    const contactNorm = normalizeName(contact.name);
    const contactParts = contactNorm.split(" ");
    const contactFirst = contactParts[0];

    // Full name match (word boundary): "lunch with georg von manstein" contains "georg von manstein"
    if (contactParts.length >= 2) {
      const fullNameRegex = new RegExp(`\\b${escapeRegex(contactNorm)}\\b`);
      if (fullNameRegex.test(titleNorm)) {
        matches.push({
          contactId: contact.id,
          attendeeEmail: "",
          confidence: 0.85,
          method: "title_mention",
        });
        matchedContactIds.add(contact.id);
        continue;
      }
    }

    // First name match (word boundary, minimum 3 chars to avoid false positives)
    if (contactFirst.length >= 3) {
      const firstNameRegex = new RegExp(`\\b${escapeRegex(contactFirst)}\\b`);
      if (firstNameRegex.test(titleNorm)) {
        matches.push({
          contactId: contact.id,
          attendeeEmail: "",
          confidence: 0.7,
          method: "title_mention",
        });
        matchedContactIds.add(contact.id);
      }
    }
  }

  // Tier B: LLM fallback if no heuristic matches found
  if (matches.length === 0 && process.env.ANTHROPIC_API_KEY) {
    const llmMatches = await matchTitleWithLLM(summary, contacts);
    matches.push(...llmMatches);
  }

  return matches;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Use Claude to match a private event title to contacts.
 */
async function matchTitleWithLLM(
  summary: string,
  contacts: Contact[]
): Promise<Match[]> {
  try {
    const client = new Anthropic();

    const contactList = contacts
      .map((c) => `- id: "${c.id}", name: "${c.name}"`)
      .join("\n");

    const response = await client.messages.create({
      model: "claude-haiku-4-20250414",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `This private calendar event has NO attendees listed. Based ONLY on the event title, which of my contacts might be involved? Be aggressive — suggest possible matches even at low confidence.

Event title: "${summary}"

My contacts:
${contactList}

Return ONLY a JSON array (no markdown, no explanation). Each element should be:
{"contactId": "...", "confidence": 0.0-1.0}

Guidelines:
- Name directly mentioned in title = 0.85
- Nickname or abbreviation that likely refers to a contact = 0.6
- Weak signal (partial name, ambiguous reference) = 0.3
- Include ALL matches with confidence >= 0.3
- Return an empty array [] if no matches found`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as {
      contactId: string;
      confidence: number;
    }[];

    const validContactIds = new Set(contacts.map((c) => c.id));
    return parsed
      .filter((m) => m.confidence >= 0.3 && validContactIds.has(m.contactId))
      .map((m) => ({
        contactId: m.contactId,
        attendeeEmail: "",
        confidence: m.confidence,
        method: "title_mention" as const,
      }));
  } catch (error) {
    console.error("LLM title matching error:", error);
    return [];
  }
}
