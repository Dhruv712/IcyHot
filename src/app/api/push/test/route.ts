import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sendPushToUser } from "@/lib/push";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendPushToUser(session.user.id, {
    title: "IcyHot test",
    body: "If you see this, push notifications are working!",
    url: "/dashboard",
    tag: "icyhot-test",
  });

  return NextResponse.json({ ok: true, ...result });
}
