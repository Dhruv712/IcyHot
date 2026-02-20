"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useDismissProvocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/provocations/${id}`, {
        method: "PATCH",
      });
      if (!res.ok) throw new Error("Failed to dismiss provocation");
      return res.json();
    },
    onSuccess: () => {
      // Invalidate the briefing query so provocations list updates
      queryClient.invalidateQueries({ queryKey: ["daily-briefing"] });
    },
  });
}
