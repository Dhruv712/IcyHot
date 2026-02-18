/**
 * Shared streak computation — used by weekly retro and daily habits.
 */

export interface ContactStreak {
  contactId: string;
  name: string;
  weeks: number;
}

/**
 * Compute consecutive-week interaction streaks per contact.
 *
 * Walks backwards from `referenceDate` (snapped to its Monday) checking
 * each week for ≥1 interaction.  Returns contacts with `minWeeks`+
 * consecutive weeks, sorted descending by streak length.
 */
export function computeStreaks(
  contacts: { id: string; name: string }[],
  interactions: { contactId: string; occurredAt: Date }[],
  referenceDate: Date,
  options?: { minWeeks?: number; maxResults?: number }
): ContactStreak[] {
  const minWeeks = options?.minWeeks ?? 3;
  const maxResults = options?.maxResults ?? 5;

  // Snap referenceDate to Monday 00:00
  const refDay = new Date(referenceDate);
  const dow = refDay.getUTCDay(); // 0=Sun … 6=Sat
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  const weekStart = new Date(
    Date.UTC(refDay.getUTCFullYear(), refDay.getUTCMonth(), refDay.getUTCDate() - mondayOffset)
  );

  // Group interactions by contact
  const byContact = new Map<string, Date[]>();
  for (const i of interactions) {
    const arr = byContact.get(i.contactId) || [];
    arr.push(i.occurredAt);
    byContact.set(i.contactId, arr);
  }

  const streaks: ContactStreak[] = [];

  for (const c of contacts) {
    const dates = byContact.get(c.id);
    if (!dates) continue;

    let consecutiveWeeks = 0;
    for (let w = 0; w < 8; w++) {
      const wStart = new Date(weekStart.getTime() - w * 7 * 24 * 60 * 60 * 1000);
      const wEnd = new Date(wStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const hasInteraction = dates.some((d) => d >= wStart && d < wEnd);
      if (hasInteraction) {
        consecutiveWeeks++;
      } else {
        break;
      }
    }
    if (consecutiveWeeks >= minWeeks) {
      streaks.push({ contactId: c.id, name: c.name, weeks: consecutiveWeeks });
    }
  }

  streaks.sort((a, b) => b.weeks - a.weeks);
  return streaks.slice(0, maxResults);
}
