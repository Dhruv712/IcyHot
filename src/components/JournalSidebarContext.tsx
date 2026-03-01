"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface JournalSidebarContextValue {
  content: ReactNode | null;
  setContent: (content: ReactNode | null) => void;
}

const JournalSidebarContext = createContext<JournalSidebarContextValue>({
  content: null,
  setContent: () => {},
});

export function useJournalSidebar() {
  return useContext(JournalSidebarContext);
}

export default function JournalSidebarProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [content, setContentState] = useState<ReactNode | null>(null);

  const setContent = useCallback((nextContent: ReactNode | null) => {
    setContentState(nextContent);
  }, []);

  const value = useMemo(
    () => ({
      content,
      setContent,
    }),
    [content, setContent],
  );

  return (
    <JournalSidebarContext.Provider value={value}>
      {children}
    </JournalSidebarContext.Provider>
  );
}
