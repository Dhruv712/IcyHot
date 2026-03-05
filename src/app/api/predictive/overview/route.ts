import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getPredictiveOverviewForUser,
  isPredictiveBenchmarkStorageMissing,
} from "@/lib/predictive/benchmark";
import { isPredictivePlaygroundEnabledForUser } from "@/lib/predictive/featureFlag";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPredictivePlaygroundEnabledForUser({ userId: session.user.id, email: session.user.email })) {
    return NextResponse.json({ error: "Predictive playground is disabled for this user." }, { status: 403 });
  }

  try {
    const overview = await getPredictiveOverviewForUser(session.user.id);
    return NextResponse.json({ overview });
  } catch (error) {
    console.error("[predictive/overview] failed:", error);
    return NextResponse.json(
      {
        error: isPredictiveBenchmarkStorageMissing(error)
          ? "Playground storage is not ready yet. Run migration 0009_predictive_benchmarks.sql."
          : error instanceof Error
            ? error.message
            : "Failed to load predictive overview",
      },
      { status: 500 }
    );
  }
}
