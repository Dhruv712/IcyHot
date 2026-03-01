"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useJournalSidebar } from "./JournalSidebarContext";

interface SidebarProps {
  driftingCount: number;
  onAddPerson: () => void;
}

const NAV_ITEMS = [
  {
    href: "/",
    label: "Graph",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="8" strokeDasharray="2 3" />
        <circle cx="5" cy="8" r="2" />
        <circle cx="19" cy="8" r="2" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="17" cy="18" r="2" />
      </svg>
    ),
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/journal",
    label: "Journal",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
      </svg>
    ),
  },
  {
    href: "/contacts",
    label: "People",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    href: "/memory",
    label: "Memory",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18c-4 0-7-2.5-7-6s3-6 7-6 7 2.5 7 6" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18c2 0 3.5-2.5 3.5-6S14 6 12 6s-3.5 2.5-3.5 6 1.5 6 3.5 6z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
        <circle cx="19" cy="12" r="2" />
        <path strokeLinecap="round" d="M19 14v2.5" />
      </svg>
    ),
  },
  {
    href: "/memory/graph",
    label: "Mem Graph",
    mobileHidden: true,
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="12" cy="18" r="2.5" />
        <circle cx="6" cy="14" r="1.5" />
        <circle cx="18" cy="14" r="1.5" />
        <path strokeLinecap="round" d="M8 7l2.5 9.5M16 7l-2.5 9.5M8.5 6h7M6 8.5v4M18 8.5v4" />
      </svg>
    ),
  },
];

export default function Sidebar({
  driftingCount,
  onAddPerson,
}: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { content: journalSidebarContent } = useJournalSidebar();
  const showJournalRail = pathname === "/journal" && !collapsed && journalSidebarContent;

  return (
    <>
      {/* ── Desktop Sidebar ─────────────────────────────────────── */}
      <aside
        className={`hidden md:flex h-screen flex-col bg-[var(--bg-card)] border-r border-[var(--border-subtle)] transition-all duration-200 flex-shrink-0 ${
          collapsed ? "w-[56px]" : "w-[220px]"
        }`}
      >
        {/* Logo + collapse */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--border-subtle)]">
          {!collapsed && (
            <h1 className="text-lg font-bold tracking-tight text-[var(--amber)]">
              Flint & Steel
            </h1>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors p-1"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {collapsed ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              )}
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="py-3 px-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors relative ${
                  isActive
                    ? "bg-[var(--amber-ghost-bg)] text-[var(--amber)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                }`}
                title={collapsed ? item.label : undefined}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[var(--amber)] rounded-r-full" />
                )}
                <span className="flex-shrink-0 relative">
                  {item.icon}
                  {item.href === "/" && driftingCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 flex items-center justify-center bg-[var(--amber)] text-[var(--bg-base)] text-[10px] font-bold rounded-full px-1"
                      title={`${driftingCount} important contact${driftingCount === 1 ? "" : "s"} going cold`}
                    >
                      {driftingCount}
                    </span>
                  )}
                </span>
                {!collapsed && (
                  <span className="text-sm font-medium flex items-center gap-2">
                    {item.label}
                    {item.href === "/" && driftingCount > 0 && (
                      <span className="text-[10px] font-normal text-[var(--amber)] opacity-80">
                        {driftingCount} drifting
                      </span>
                    )}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1 min-h-0">
          {showJournalRail && (
            <div className="h-full min-h-0 border-t border-[var(--border-subtle)]">
              {journalSidebarContent}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-2 py-3 border-t border-[var(--border-subtle)]">
          {/* Add Person */}
          <button
            onClick={onAddPerson}
            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[var(--amber)] hover:bg-[var(--amber-ghost-bg)] transition-colors w-full ${
              collapsed ? "justify-center" : ""
            }`}
            title={collapsed ? "Add Person" : undefined}
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {!collapsed && <span className="text-sm font-medium">Add Person</span>}
          </button>
        </div>
      </aside>

      {/* ── Mobile Bottom Nav ───────────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex md:hidden items-center justify-around bg-[var(--bg-card)] border-t border-[var(--border-subtle)] h-16 px-2 safe-area-pb">
        {NAV_ITEMS.filter((item) => !item.mobileHidden).map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl transition-colors ${
                isActive
                  ? "text-[var(--amber)]"
                  : "text-[var(--text-muted)]"
              }`}
            >
              <span className="relative">
                {item.icon}
                {item.href === "/" && driftingCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 flex items-center justify-center bg-[var(--amber)] text-[var(--bg-base)] text-[9px] font-bold rounded-full px-0.5">
                    {driftingCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
        <button
          onClick={onAddPerson}
          className="flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl text-[var(--amber)] transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span className="text-[10px] font-medium">Add</span>
        </button>
      </nav>
    </>
  );
}
