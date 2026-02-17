"use client";

import { useQuery } from "@tanstack/react-query";

export interface Suggestion {
  id: string;
  name: string;
  temperature: number;
  color: string;
  relationshipType: string;
  lastInteraction: string | null;
  blurb: string;
}

export function useDailySuggestions() {
  return useQuery<{ suggestions: Suggestion[] }>({
    queryKey: ["daily-suggestions"],
    queryFn: async () => {
      const res = await fetch("/api/suggestions");
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      return res.json();
    },
    staleTime: Infinity, // suggestions are fixed for the day — no refetch needed
  });
}
