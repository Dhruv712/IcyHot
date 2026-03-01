"use client";

import { useState, useCallback, useEffect } from "react";
import { useSession, signIn } from "next-auth/react";
import Sidebar from "@/components/Sidebar";
import AddContactDialog from "@/components/AddContactDialog";
import JournalSidebarProvider from "@/components/JournalSidebarContext";
import { useGraphData } from "@/hooks/useGraphData";
import { useCalendarStatus, useCalendarSync } from "@/hooks/useCalendar";
import { useJournalStatus, useJournalSync } from "@/hooks/useJournal";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const { data: graphData } = useGraphData();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const { data: calendarStatus } = useCalendarStatus();
  const calendarSync = useCalendarSync();
  const { data: journalStatus } = useJournalStatus();
  const journalSync = useJournalSync();

  useEffect(() => {
    if (!session?.user?.id) return;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) return;

    const cacheKey = `icyhot-timezone:${session.user.id}`;
    if (typeof window !== "undefined" && localStorage.getItem(cacheKey) === timeZone) {
      return;
    }

    fetch("/api/users/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeZone }),
    })
      .then((res) => {
        if (res.ok && typeof window !== "undefined") {
          localStorage.setItem(cacheKey, timeZone);
        }
      })
      .catch(() => {
        // Non-blocking best-effort sync
      });
  }, [session?.user?.id]);

  const handleSyncCalendar = useCallback(() => {
    setSyncMessage("Syncing calendar...");
    calendarSync.mutate(undefined, {
      onSuccess: (result) => {
        const parts = [];
        if (result.matched > 0) parts.push(`${result.matched} matched`);
        if (result.created > 0) parts.push(`${result.created} auto-logged`);
        if (result.unmatched > 0) parts.push(`${result.unmatched} unmatched`);
        if (parts.length > 0) {
          setSyncMessage(`Calendar synced: ${parts.join(", ")}`);
        } else {
          setSyncMessage("Calendar up to date");
        }
        setTimeout(() => setSyncMessage(null), 5000);
      },
      onError: () => {
        setSyncMessage("Calendar sync failed");
        setTimeout(() => setSyncMessage(null), 3000);
      },
    });
  }, [calendarSync]);

  const handleSyncJournal = useCallback(() => {
    setSyncMessage("Syncing journal...");
    journalSync.mutate(undefined, {
      onSuccess: (result) => {
        if (result.processed === 0) {
          setSyncMessage("Journal up to date");
        } else {
          const parts = [];
          if (result.interactions > 0) parts.push(`${result.interactions} interactions`);
          if (result.openLoops > 0) parts.push(`${result.openLoops} open loops`);
          if (result.newPeople > 0) parts.push(`${result.newPeople} new people`);
          if (result.insights > 0) parts.push(`${result.insights} insights`);
          setSyncMessage(
            `Journal: ${result.processed} entr${result.processed === 1 ? "y" : "ies"} — ${parts.join(", ")}`
          );
        }
        setTimeout(() => setSyncMessage(null), 6000);
      },
      onError: (error) => {
        setSyncMessage(`Journal sync failed: ${error.message}`);
        setTimeout(() => setSyncMessage(null), 4000);
      },
    });
  }, [journalSync]);

  // Loading state
  if (status === "loading") {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--bg-base)]">
        <div className="text-[var(--text-muted)]">Loading...</div>
      </div>
    );
  }

  // Not authenticated — show login
  if (!session) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--bg-base)]">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-2 text-[var(--amber)]">
            Flint & Steel
          </h1>
          <p className="text-[var(--text-secondary)] mb-6">
            Strike a spark. See what lights up.
          </p>
          <button
            onClick={() => signIn("google")}
            className="bg-[var(--text-primary)] text-[var(--bg-base)] font-medium px-6 py-2.5 rounded-xl hover:opacity-90 transition-opacity"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  const contactNodes = graphData?.nodes ?? [];

  // Count important contacts that are going cold (importance ≥ 7, temperature < 0.3)
  const driftingCount = contactNodes.filter(
    (n) => n.importance >= 7 && n.temperature < 0.3
  ).length;

  return (
    <JournalSidebarProvider>
      <div className="h-screen w-screen flex flex-col md:flex-row overflow-hidden">
        <Sidebar
          healthScore={graphData?.healthScore ?? 0}
          contactCount={contactNodes.length}
          driftingCount={driftingCount}
          onAddPerson={() => setShowAddDialog(true)}
          onSyncCalendar={handleSyncCalendar}
          onSyncJournal={handleSyncJournal}
          calendarConnected={!!calendarStatus?.connected}
          journalConfigured={!!journalStatus?.configured}
          calendarSyncing={calendarSync.isPending}
          journalSyncing={journalSync.isPending}
        />

        {/* Main content area */}
        <main className="flex-1 relative overflow-hidden pb-16 md:pb-0">
          {/* Sync toast */}
          {syncMessage && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
              <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-secondary)] shadow-lg backdrop-blur-sm">
                {syncMessage}
              </div>
            </div>
          )}

          {children}
        </main>

        {/* Global modals */}
        {showAddDialog && (
          <AddContactDialog onClose={() => setShowAddDialog(false)} />
        )}
      </div>
    </JournalSidebarProvider>
  );
}
