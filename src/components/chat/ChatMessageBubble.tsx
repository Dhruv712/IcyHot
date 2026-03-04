import type { ChatMessage } from "@/lib/chat/types";
import ChatRetrievalStatus from "./ChatRetrievalStatus";
import ChatSources from "./ChatSources";

export default function ChatMessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isStreaming = message.role === "assistant" && message.status === "streaming";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[min(46rem,100%)] rounded-3xl px-5 py-4 ${
          isUser
            ? "bg-[var(--amber)] text-[var(--bg-base)]"
            : "border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)]"
        }`}
      >
        {!isUser && (
          <ChatRetrievalStatus stats={message.retrievalStats} searching={isStreaming && !message.retrievalStats} />
        )}

        <div className={`whitespace-pre-wrap text-[15px] leading-7 ${isUser ? "text-[var(--bg-base)]" : "text-[var(--text-primary)]"}`}>
          {message.content || (isStreaming ? "Thinking..." : "")}
        </div>

        {message.status === "error" && (
          <p className="mt-3 text-sm text-[var(--danger)]">{message.errorMessage || "Response failed."}</p>
        )}

        {!isUser && message.status !== "streaming" && <ChatSources sources={message.sources} />}
      </div>
    </div>
  );
}
