import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncCalendarEvents } from "@/lib/calendar";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncCalendarEvents(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Calendar sync error:", error);
    const message =
      error instanceof Error ? error.message : "Calendar sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
