function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isPredictivePlaygroundEnabledForUser(params: {
  userId: string;
  email?: string | null;
}): boolean {
  if (process.env.PREDICTIVE_PLAYGROUND_V1 === "0") {
    return false;
  }

  const allowlist = parseAllowlist(process.env.PREDICTIVE_PLAYGROUND_V1_ALLOWLIST);
  if (allowlist.size === 0) return true;

  const email = params.email?.toLowerCase().trim();
  return allowlist.has(params.userId.toLowerCase()) || (email ? allowlist.has(email) : false);
}
