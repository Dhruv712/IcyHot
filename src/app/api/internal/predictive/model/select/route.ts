import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { userPredictiveStatus } from "@/db/schema";
import {
  ensurePredictiveModelExists,
  upsertPredictiveGlobalSelection,
  upsertPredictiveUserSelection,
  validateModelConfig,
} from "@/lib/predictive/config";

type SelectionScope = "global" | "user";

function parseAdminEmailAllowlist(): Set<string> {
  const values = [
    process.env.PREDICTIVE_ADMIN_EMAILS,
    process.env.ALLOWED_EMAIL,
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return new Set(values);
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const expectedSecret = process.env.PREDICTIVE_ADMIN_SECRET || process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (expectedSecret && authHeader === `Bearer ${expectedSecret}`) {
    return true;
  }

  const session = await auth();
  const email = session?.user?.email?.toLowerCase() ?? "";
  if (!email) return false;

  const allowlist = parseAdminEmailAllowlist();
  return allowlist.has(email);
}

function normalizeConfig(config: unknown): Record<string, unknown> {
  if (!config) return {};
  if (typeof config === "object" && !Array.isArray(config)) {
    return config as Record<string, unknown>;
  }
  return {};
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    scope?: SelectionScope;
    userId?: string;
    modelKey?: string;
    config?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const scope = body.scope;
  const modelKey = body.modelKey?.trim();
  const config = normalizeConfig(body.config);

  if (scope !== "global" && scope !== "user") {
    return NextResponse.json({ error: "scope must be \"global\" or \"user\"." }, { status: 400 });
  }

  if (!modelKey) {
    return NextResponse.json({ error: "modelKey is required." }, { status: 400 });
  }

  try {
    ensurePredictiveModelExists(modelKey);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown model key." },
      { status: 400 }
    );
  }

  const validation = validateModelConfig(modelKey, config);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Invalid model config.", details: validation.errors },
      { status: 400 }
    );
  }

  if (scope === "global") {
    await upsertPredictiveGlobalSelection({ modelKey, config });

    await db
      .update(userPredictiveStatus)
      .set({
        activeModelKey: modelKey,
        activeModelVersion: null,
        updatedAt: new Date(),
      });

    return NextResponse.json({
      ok: true,
      scope,
      modelKey,
      config,
      staleMarked: "all_users",
    });
  }

  const userId = body.userId?.trim();
  if (!userId) {
    return NextResponse.json(
      { error: "userId is required when scope is \"user\"." },
      { status: 400 }
    );
  }

  await upsertPredictiveUserSelection({ userId, modelKey, config });

  await db
    .insert(userPredictiveStatus)
    .values({
      userId,
      activeModelKey: modelKey,
      activeModelVersion: null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userPredictiveStatus.userId,
      set: {
        activeModelKey: modelKey,
        activeModelVersion: null,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({
    ok: true,
    scope,
    userId,
    modelKey,
    config,
    staleMarked: "user",
  });
}
