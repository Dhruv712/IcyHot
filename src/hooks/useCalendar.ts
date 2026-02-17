"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface CalendarStatus {
  connected: boolean;
  lastSyncedAt: string | null;
  enabled: boolean;
}

interface SyncResult {
  fetched: number;
  matched: number;
  created: number;
  unmatched: number;
}

interface PendingMatch {
  id: string;
  eventSummary: string | null;
  eventDate: string;
  contactId: string;
  contactName: string;
  matchMethod: string | null;
  matchConfidence: number | null;
}

export interface ContactCalendarEvent {
  id: string;
  eventSummary: string | null;
  eventStart: string;
  eventEnd: string;
  matchMethod: string | null;
  matchConfidence: number | null;
  confirmed: boolean;
  interactionCreated: boolean;
}

export interface UnmatchedCalendarEvent {
  id: string;
  summary: string | null;
  startTime: string;
  endTime: string;
  attendeeEmails: string; // JSON array
  attendeeNames: string; // JSON array
}

export function useCalendarStatus() {
  return useQuery<CalendarStatus>({
    queryKey: ["calendar-status"],
    queryFn: async () => {
      const res = await fetch("/api/calendar/status");
      if (!res.ok) throw new Error("Failed to fetch calendar status");
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useCalendarSync() {
  const queryClient = useQueryClient();

  return useMutation<SyncResult>({
    mutationFn: async () => {
      const res = await fetch("/api/calendar/sync", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Calendar sync failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["graph"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-status"] });
      queryClient.invalidateQueries({ queryKey: ["pending-matches"] });
      queryClient.invalidateQueries({ queryKey: ["contact-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["unmatched-events"] });
    },
  });
}

export function usePendingMatches(enabled: boolean = true) {
  return useQuery<PendingMatch[]>({
    queryKey: ["pending-matches"],
    queryFn: async () => {
      const res = await fetch("/api/calendar/events?status=pending");
      if (!res.ok) throw new Error("Failed to fetch pending matches");
      return res.json();
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useContactCalendarEvents(contactId: string | null) {
  return useQuery<ContactCalendarEvent[]>({
    queryKey: ["contact-calendar", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/calendar/events?contactId=${contactId}`);
      if (!res.ok) throw new Error("Failed to fetch contact calendar events");
      return res.json();
    },
    enabled: !!contactId,
    staleTime: 30_000,
  });
}

export function useUnmatchedEvents(enabled: boolean = true) {
  return useQuery<UnmatchedCalendarEvent[]>({
    queryKey: ["unmatched-events"],
    queryFn: async () => {
      const res = await fetch("/api/calendar/events?status=unmatched");
      if (!res.ok) throw new Error("Failed to fetch unmatched events");
      return res.json();
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useConfirmMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      confirmed,
    }: {
      id: string;
      confirmed: boolean;
    }) => {
      const res = await fetch(`/api/calendar/events/${id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed }),
      });
      if (!res.ok) throw new Error("Failed to confirm match");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["graph"] });
      queryClient.invalidateQueries({ queryKey: ["pending-matches"] });
      queryClient.invalidateQueries({ queryKey: ["contact"] });
      queryClient.invalidateQueries({ queryKey: ["contact-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["unmatched-events"] });
    },
  });
}

export function useManualMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      eventId,
      contactId,
    }: {
      eventId: string;
      contactId: string;
    }) => {
      const res = await fetch(`/api/calendar/events/${eventId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      if (!res.ok) throw new Error("Failed to manually match");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["graph"] });
      queryClient.invalidateQueries({ queryKey: ["unmatched-events"] });
      queryClient.invalidateQueries({ queryKey: ["contact-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["pending-matches"] });
      queryClient.invalidateQueries({ queryKey: ["interactions"] });
    },
  });
}

export function useSkipEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (eventId: string) => {
      const res = await fetch(`/api/calendar/events/${eventId}/skip`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to skip event");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unmatched-events"] });
    },
  });
}
