import Anthropic from "@anthropic-ai/sdk";
import type { RetrievalResult } from "@/lib/memory/retrieve";
import { buildChatPromptContext } from "./retrieval";

const CHAT_MODEL = "claude-sonnet-4-20250514";
const MAX_HISTORY_MESSAGES = 6;

export function getChatModel(): string {
  return CHAT_MODEL;
}

export function buildThreadTitle(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "New chat";
  if (normalized.length <= 60) return normalized;
  return `${normalized.slice(0, 57).trimEnd()}...`;
}

function buildHistory(history: Array<{ role: "user" | "assistant"; content: string }>): string {
  const sliced = history.slice(-MAX_HISTORY_MESSAGES);
  if (sliced.length === 0) return "(no prior conversation)";
  return sliced
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n");
}

function buildPrompt(params: {
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  retrieval: RetrievalResult;
}): string {
  const promptContext = buildChatPromptContext(params.retrieval);

  return `You answer questions using retrieved personal memory evidence. Be direct and grounded.

Rules:
- Answer the user's question first.
- Use retrieved evidence before general advice.
- Distinguish recollection from inference.
- If the evidence is incomplete or weak, say so plainly.
- For advice questions, synthesize from the retrieved memories, implications, and connections. Do not slip into generic coach language.
- Mention specific people and dates when available.
- Do not invent details that are not supported by the retrieved context.
- Do not write like a therapist.

Conversation so far:
${buildHistory(params.history)}

User question:
${params.question}

Retrieved memories:
${promptContext.memories}

Retrieved implications:
${promptContext.implications}

Retrieved connections:
${promptContext.connections}

If the memory evidence is weak, explicitly say you can't answer confidently from the recorded memories. Otherwise answer in a compact, natural way.`;
}

export function streamChatAnswer(params: {
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  retrieval: RetrievalResult;
}) {
  const client = new Anthropic({ timeout: 30_000 });

  return client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: 1400,
    messages: [
      {
        role: "user",
        content: buildPrompt(params),
      },
    ],
  });
}
