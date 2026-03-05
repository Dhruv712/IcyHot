import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  isPredictiveBenchmarkStorageMissing,
  listPredictiveBenchmarkRunsForUser,
} from "@/lib/predictive/benchmark";
import { isPredictivePlaygroundEnabledForUser } from "@/lib/predictive/featureFlag";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function toPositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPredictivePlaygroundEnabledForUser({ userId: session.user.id, email: session.user.email })) {
    return NextResponse.json({ error: "Predictive playground is disabled for this user." }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = toPositiveInt(url.searchParams.get("limit"), 20);
  const offset = toPositiveInt(url.searchParams.get("offset"), 0);

  try {
    const runs = await listPredictiveBenchmarkRunsForUser({
      userId: session.user.id,
      limit: limit || 20,
      offset,
    });

    return NextResponse.json({ runs });
  } catch (error) {
    console.error("[predictive/benchmark/runs] list failed:", error);
    return NextResponse.json(
      {
        error: isPredictiveBenchmarkStorageMissing(error)
          ? "Playground storage is not ready yet. Run migration 0009_predictive_benchmarks.sql."
          : error instanceof Error
            ? error.message
            : "Failed to load benchmark runs",
      },
      { status: 500 }
    );
  }
}
