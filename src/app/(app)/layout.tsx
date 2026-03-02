"use client";

import { useEffect } from "react";
import { useSession, signIn } from "next-auth/react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import JournalSidebarProvider from "@/components/JournalSidebarContext";
import { useGraphData } from "@/hooks/useGraphData";
import NotificationToggle from "@/components/NotificationToggle";
import { useTheme } from "@/components/ThemeProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const { data: graphData } = useGraphData();
  const { resolved, setTheme } = useTheme();
  const showShellUtilities = pathname !== "/journal";

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
            Lumos
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
          driftingCount={driftingCount}
        />

        {/* Main content area */}
        <main className="flex-1 relative overflow-hidden pb-16 md:pb-0">
          {showShellUtilities && (
            <div className="pointer-events-none absolute right-4 top-4 z-40 flex items-center gap-2">
              <div className="pointer-events-auto">
                <NotificationToggle compact />
              </div>
              <button
                type="button"
                onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
                className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-secondary)]"
                title={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
                aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
              >
                <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  {resolved === "dark" ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                  )}
                </svg>
              </button>
            </div>
          )}

          {children}
        </main>
      </div>
    </JournalSidebarProvider>
  );
}
