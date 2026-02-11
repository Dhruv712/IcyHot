"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface LogInteractionInput {
  contactId: string;
  note?: string;
  occurredAt?: string;
}

export function useLogInteraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LogInteractionInput) => {
      const res = await fetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed to log interaction");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["graph"] });
      queryClient.invalidateQueries({ queryKey: ["contact"] });
    },
  });
}

export function useContactInteractions(contactId: string | null) {
  return useQuery({
    queryKey: ["contact", contactId, "interactions"],
    queryFn: async () => {
      const res = await fetch(`/api/interactions?contactId=${contactId}`);
      if (!res.ok) throw new Error("Failed to fetch interactions");
      return res.json();
    },
    enabled: !!contactId,
  });
}
