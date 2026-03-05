import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  isPredictiveBenchmarkStorageMissing,
  runPredictiveBenchmarkForUser,
  type PredictiveBenchmarkMode,
  type PredictiveBenchmarkProgressEvent,
} from "@/lib/predictive/benchmark";
import { isPredictivePlaygroundEnabledForUser } from "@/lib/predictive/featureFlag";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function emit(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: PredictiveBenchmarkProgressEvent
) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPredictivePlaygroundEnabledForUser({ userId: session.user.id, email: session.user.email })) {
    return NextResponse.json({ error: "Predictive playground is disabled for this user." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body?.mode;
  if (mode !== "quick" && mode !== "full") {
    return NextResponse.json({ error: "mode must be \"quick\" or \"full\"." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const outcome = await runPredictiveBenchmarkForUser({
          userId: session.user.id,
          trigger: "manual",
          mode: mode as PredictiveBenchmarkMode,
          onProgress: (event) => emit(controller, encoder, event),
        });

        if (!outcome.ok) {
          emit(controller, encoder, {
            type: "error",
            runId: outcome.runId,
            message: outcome.message,
          });
        }
      } catch (error) {
        emit(controller, encoder, {
          type: "error",
          message:
            isPredictiveBenchmarkStorageMissing(error)
              ? "Playground storage is not ready yet. Run migration 0009_predictive_benchmarks.sql."
              : error instanceof Error
                ? error.message
                : "Benchmark run failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
