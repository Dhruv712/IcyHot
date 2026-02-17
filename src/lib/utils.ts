export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function formatDate(date: Date): string {
  const now = new Date();

  // Compare by calendar date in local timezone, not raw milliseconds
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round((nowDay.getTime() - dateDay.getTime()) / (1000 * 60 * 60 * 24));

  const timeStr = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (dayDiff === 0) return `Today ${timeStr}`;
  if (dayDiff === 1) return `Yesterday ${timeStr}`;
  if (dayDiff < 7) return `${dayDiff} days ago`;
  if (dayDiff < 30) return `${Math.floor(dayDiff / 7)} weeks ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function daysAgo(date: Date): number {
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}
