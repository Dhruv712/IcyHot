import type { ReactNode } from "react";

export default function ChatLayout({
  threadRail,
  conversation,
}: {
  threadRail: ReactNode;
  conversation: ReactNode;
}) {
  return (
    <div className="flex h-full overflow-hidden bg-[var(--bg-base)]">
      <div className="hidden w-[300px] flex-shrink-0 lg:block">{threadRail}</div>
      <div className="flex min-w-0 flex-1 flex-col">{conversation}</div>
    </div>
  );
}
