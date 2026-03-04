export type ChatThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
};

export type ChatRetrievalStats = {
  memories: number;
  implications: number;
  connections: number;
};

export type ChatSourcesPayload = {
  memories: Array<{
    id: string;
    date: string;
    snippet: string;
    activationScore: number;
    hop: number;
  }>;
  implications: Array<{
    id: string;
    content: string;
    implicationType: string | null;
    sourceMemoryIds: string[];
  }>;
  connections: Array<{
    fromId: string;
    toId: string;
    connectionType: string | null;
    reason: string | null;
  }>;
};

export type ChatMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "error";
  model: string | null;
  retrievalStats: ChatRetrievalStats | null;
  sources: ChatSourcesPayload | null;
  errorMessage: string | null;
  createdAt: string;
};

export type ChatThreadSummary = ChatThread & {
  preview: string | null;
};

export type ChatStreamEvent =
  | { type: "message_saved"; userMessageId: string; assistantMessageId: string }
  | { type: "retrieval_started" }
  | { type: "retrieval_complete"; stats: ChatRetrievalStats; sources: ChatSourcesPayload }
  | { type: "generation_started"; model: string }
  | { type: "token"; text: string }
  | { type: "complete"; assistantMessageId: string; content: string; stats: ChatRetrievalStats }
  | { type: "error"; message: string; assistantMessageId?: string };
