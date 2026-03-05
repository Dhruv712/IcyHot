import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getPredictiveBenchmarkRunForUser,
  isPredictiveBenchmarkStorageMissing,
} from "@/lib/predictive/benchmark";
import { isPredictivePlaygroundEnabledForUser } from "@/lib/predictive/featureFlag";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPredictivePlaygroundEnabledForUser({ userId: session.user.id, email: session.user.email })) {
    return NextResponse.json({ error: "Predictive playground is disabled for this user." }, { status: 403 });
  }

  const { id } = await context.params;
  try {
    const run = await getPredictiveBenchmarkRunForUser({
      userId: session.user.id,
      runId: id,
    });

    if (!run) {
      return NextResponse.json({ error: "Benchmark run not found" }, { status: 404 });
    }

    return NextResponse.json({ run });
  } catch (error) {
    console.error(`[predictive/benchmark/runs/${id}] load failed:`, error);
    return NextResponse.json(
      {
        error: isPredictiveBenchmarkStorageMissing(error)
          ? "Playground storage is not ready yet. Run migration 0009_predictive_benchmarks.sql."
          : error instanceof Error
            ? error.message
            : "Failed to load benchmark run",
      },
      { status: 500 }
    );
  }
}
