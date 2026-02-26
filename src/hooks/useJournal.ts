"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────

export interface JournalStatus {
  configured: boolean;
  lastSyncedAt: string | null;
  processedCount: number;
}

export interface JournalSyncResult {
  processed: number;
  interactions: number;
  insights: number;
  openLoops: number;
  newPeople: number;
}

export interface JournalInsight {
  id: string;
  entryDate: string;
  category: string;
  contactId: string | null;
  contactName: string | null;
  content: string;
  reinforcementCount: number;
  relevanceScore: number;
  createdAt: string;
}

export interface JournalOpenLoop {
  id: string;
  entryDate: string;
  content: string;
  contactId: string | null;
  contactName: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
}

export interface JournalNewPerson {
  id: string;
  entryDate: string;
  name: string;
  context: string;
  category: string;
  dismissed: boolean;
  contactId: string | null;
  createdAt: string;
}

// ── Hooks ──────────────────────────────────────────────────────────────

export function useJournalStatus() {
  return useQuery<JournalStatus>({
    queryKey: ["journal-status"],
    queryFn: async () => {
      const res = await fetch("/api/journal/status");
      if (!res.ok) throw new Error("Failed to fetch journal status");
      return res.json();
    },
  });
}

export function useJournalSync() {
  const queryClient = useQueryClient();

  return useMutation<JournalSyncResult>({
    mutationFn: async () => {
      const res = await fetch("/api/journal/sync", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Journal sync failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-status"] });
      queryClient.invalidateQueries({ queryKey: ["journal-insights"] });
      queryClient.invalidateQueries({ queryKey: ["journal-open-loops"] });
      queryClient.invalidateQueries({ queryKey: ["journal-new-people"] });
      queryClient.invalidateQueries({ queryKey: ["graph"] });
      queryClient.invalidateQueries({ queryKey: ["contact"] });
    },
  });
}

export function useJournalInsights(category?: string) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);

  return useQuery<JournalInsight[]>({
    queryKey: ["journal-insights", category ?? "all"],
    queryFn: async () => {
      const res = await fetch(`/api/journal/insights?${params}`);
      if (!res.ok) throw new Error("Failed to fetch insights");
      return res.json();
    },
  });
}

export function useJournalOpenLoops() {
  return useQuery<JournalOpenLoop[]>({
    queryKey: ["journal-open-loops"],
    queryFn: async () => {
      const res = await fetch("/api/journal/open-loops");
      if (!res.ok) throw new Error("Failed to fetch open loops");
      return res.json();
    },
  });
}

export function useResolveOpenLoop() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, resolved }: { id: string; resolved: boolean }) => {
      const res = await fetch("/api/journal/open-loops", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, resolved }),
      });
      if (!res.ok) throw new Error("Failed to update open loop");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-open-loops"] });
    },
  });
}

export function useSnoozeOpenLoop() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, snoozedUntil }: { id: string; snoozedUntil: string }) => {
      const res = await fetch("/api/journal/open-loops", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, snoozedUntil }),
      });
      if (!res.ok) throw new Error("Failed to snooze open loop");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-open-loops"] });
    },
  });
}

export function useJournalNewPeople() {
  return useQuery<JournalNewPerson[]>({
    queryKey: ["journal-new-people"],
    queryFn: async () => {
      const res = await fetch("/api/journal/new-people");
      if (!res.ok) throw new Error("Failed to fetch new people");
      return res.json();
    },
  });
}

export function useJournalNewPersonAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "add" | "dismiss" }) => {
      const res = await fetch("/api/journal/new-people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) throw new Error("Action failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-new-people"] });
      queryClient.invalidateQueries({ queryKey: ["graph"] });
    },
  });
}

// ── Journal Editor Hooks ────────────────────────────────────────────────

export interface JournalEntry {
  filename: string;
  content: string;
  entryDate: string;
  exists: boolean;
  source: "db" | "github" | "new";
}

export interface JournalSavePayload {
  content: string;
  entryDate: string;
}

export interface JournalSaveResult {
  saved: boolean;
  updatedAt: string;
}

export interface JournalEntryListItem {
  date: string;
  name: string;
}

export function useJournalEntries() {
  return useQuery<{ entries: JournalEntryListItem[] }>({
    queryKey: ["journal-entries"],
    queryFn: async () => {
      const res = await fetch("/api/journal/entries");
      if (!res.ok) throw new Error("Failed to list journal entries");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useJournalEntry(date?: string) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);

  return useQuery<JournalEntry>({
    queryKey: ["journal-entry", date ?? "today"],
    queryFn: async () => {
      const res = await fetch(`/api/journal/save?${params}`);
      if (!res.ok) throw new Error("Failed to load journal entry");
      return res.json();
    },
    staleTime: 60 * 1000,
  });
}

export function useSaveJournalEntry() {
  return useMutation<JournalSaveResult, Error, JournalSavePayload>({
    mutationFn: async (payload) => {
      const res = await fetch("/api/journal/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Save failed");
      }
      return res.json();
    },
  });
}
