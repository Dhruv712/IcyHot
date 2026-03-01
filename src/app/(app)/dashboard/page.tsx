"use client";

import OvernightView from "@/components/dashboard/OvernightView";
import ReminderSections from "@/components/dashboard/ReminderSections";

export default function DashboardPage() {
  return (
    <div className="h-full overflow-y-auto py-4 md:py-6">
      <OvernightView />

      <div className="max-w-[720px] mx-auto px-6 py-4">
        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border-medium)] to-transparent" />
      </div>

      <ReminderSections />
    </div>
  );
}
