export const DEFAULT_TIME_ZONE = "UTC";

export function normalizeTimeZone(timeZone?: string | null): string {
  if (!timeZone) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function getParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const tz = normalizeTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  const partMap = new Map(parts.map((part) => [part.type, part.value]));
  const weekdayLabel = partMap.get("weekday") || "Sun";

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(partMap.get("year")),
    month: Number(partMap.get("month")),
    day: Number(partMap.get("day")),
    hour: Number(partMap.get("hour")),
    minute: Number(partMap.get("minute")),
    second: Number(partMap.get("second")),
    weekday: weekdayMap[weekdayLabel] ?? 0,
  };
}

function getOffsetMs(date: Date, timeZone: string): number {
  const parts = getParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone: string
): Date {
  let utcTs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);

  // Iterate twice to handle DST boundary edge-cases.
  for (let i = 0; i < 2; i++) {
    const offset = getOffsetMs(new Date(utcTs), timeZone);
    utcTs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offset;
  }

  return new Date(utcTs);
}

export function getDateStringInTimeZone(date: Date, timeZone: string): string {
  const parts = getParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getWeekdayInTimeZone(date: Date, timeZone: string): number {
  return getParts(date, timeZone).weekday;
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map((v) => Number(v));
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function getMondayDateStringInTimeZone(date: Date, timeZone: string): string {
  const today = getDateStringInTimeZone(date, timeZone);
  const weekday = getWeekdayInTimeZone(date, timeZone);
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return addDaysToDateString(today, offset);
}

export function getUtcDayRangeForDateInTimeZone(
  dateStr: string,
  timeZone: string
): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split("-").map((v) => Number(v));

  return {
    start: zonedDateTimeToUtc(y, m, d, 0, 0, 0, 0, timeZone),
    end: zonedDateTimeToUtc(y, m, d, 23, 59, 59, 999, timeZone),
  };
}
