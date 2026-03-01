export interface JournalRichTextNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: JournalRichTextNode[];
}

export interface JournalMentionReference {
  contactId: string;
  label: string;
  occurrences: number;
}

export interface JournalMentionOccurrence {
  contactId: string;
  label: string;
}

function walkNodes(
  node: JournalRichTextNode | null | undefined,
  visit: (node: JournalRichTextNode) => void,
) {
  if (!node || typeof node !== "object") return;
  visit(node);
  if (!Array.isArray(node.content)) return;
  for (const child of node.content) {
    walkNodes(child, visit);
  }
}

function normalizeMentionNode(node: JournalRichTextNode): JournalMentionOccurrence | null {
  if (node.type !== "journalMention") return null;
  const contactId =
    typeof node.attrs?.id === "string" ? node.attrs.id.trim() : "";
  const label =
    typeof node.attrs?.label === "string" ? node.attrs.label.trim() : "";
  if (!contactId || !label) return null;
  return { contactId, label };
}

export function collectJournalMentions(
  contentJson: unknown,
): JournalMentionReference[] {
  if (!contentJson || typeof contentJson !== "object") return [];

  const counts = new Map<string, JournalMentionReference>();
  walkNodes(contentJson as JournalRichTextNode, (node) => {
    const mention = normalizeMentionNode(node);
    if (!mention) return;

    const existing = counts.get(mention.contactId);
    if (existing) {
      existing.occurrences += 1;
      return;
    }

    counts.set(mention.contactId, {
      contactId: mention.contactId,
      label: mention.label,
      occurrences: 1,
    });
  });

  return Array.from(counts.values());
}

export function collectBlockMentions(
  contentJson: unknown,
  blockIndex: number,
): JournalMentionReference[] {
  if (
    !contentJson ||
    typeof contentJson !== "object" ||
    !Array.isArray((contentJson as JournalRichTextNode).content)
  ) {
    return [];
  }

  const block = (contentJson as JournalRichTextNode).content?.[blockIndex];
  if (!block) return [];
  return collectJournalMentions(block);
}

export function firstMentionContactId(contentJson: unknown): string | null {
  const mentions = collectJournalMentions(contentJson);
  return mentions[0]?.contactId ?? null;
}

export function mentionsByLabel(
  mentions: JournalMentionReference[],
): Map<string, JournalMentionReference> {
  const map = new Map<string, JournalMentionReference>();
  for (const mention of mentions) {
    map.set(mention.label.toLowerCase(), mention);
  }
  return map;
}
