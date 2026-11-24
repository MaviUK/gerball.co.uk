// Gerball prospective ingestion v4: authenticated, strict request validation, fail-closed.
// No database write path is enabled until verified odds provenance and immutable
// strategy approval are implemented and tested.
const json = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ error, ...extra }), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const allowed = new Set(["event_key", "kickoff_at", "league", "home_team", "away_team",
  "market", "strategy_version", "observed_odds", "odds_source", "odds_observed_at",
  "stake_units", "input_sha256", "selection_snapshot"]);

const textField = (v: unknown, max = 200): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const positiveNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

export function validatePrediction(p: unknown, now = Date.now()): string | null {
  if (!p || typeof p !== "object" || Array.isArray(p)) return "invalid_body";
  const v = p as Record<string, unknown>;
  if (Object.keys(v).some(k => !allowed.has(k))) return "unexpected_field";
  if (Object.keys(v).length !== allowed.size) return "missing_field";
  for (const k of ["event_key", "league", "home_team", "away_team",
    "strategy_version", "odds_source"]) {
    if (!textField(v[k])) return "invalid_" + k;
  }
  if (!["H", "D", "A", "O25", "U25"].includes(String(v.market))) return "invalid_market";
  if (!positiveNumber(v.observed_odds) || v.observed_odds <= 1 || v.observed_odds > 10000) return "invalid_odds";
  if (!positiveNumber(v.stake_units) || v.stake_units > 1000) return "invalid_stake";
  if (typeof v.input_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.input_sha256)) return "invalid_hash";
  if (!v.selection_snapshot || typeof v.selection_snapshot !== "object" || Array.isArray(v.selection_snapshot)) return "invalid_snapshot";
  if (!textField(v.kickoff_at) || !textField(v.odds_observed_at) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(v.kickoff_at) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(v.odds_observed_at)) return "invalid_timestamp";
  const kickoff = Date.parse(v.kickoff_at), observed = Date.parse(v.odds_observed_at);
  if (!Number.isFinite(kickoff) || !Number.isFinite(observed) || kickoff <= now) return "invalid_kickoff";
  if (observed >= kickoff || observed > now || now - observed > 5 * 60_000) return "stale_or_future_odds";
  return null;
}

// SHA-256 fixed-length comparison avoids timing differences on token characters.
async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
async function constantTimeTokenMatch(actual: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(actual), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, "method_not_allowed");
  if (Deno.env.get("PROSPECTIVE_INGESTION_ENABLED") !== "true")
    return json(503, "prospective_ingestion_inactive");
  const expected = Deno.env.get("GERBALL_INGEST_TOKEN");
  const operatorList = Deno.env.get("GERBALL_INGEST_OPERATORS");
  if (!expected || expected.length < 32 || !operatorList)
    return json(503, "ingestion_auth_not_configured");
  const operator = request.headers.get("x-gerball-operator") ?? "";
  const allowedOperators = operatorList.split(",").map(v => v.trim()).filter(Boolean);
  const supplied = request.headers.get("x-gerball-ingest-token") ?? "";
  if (!allowedOperators.includes(operator) || !supplied ||
      !(await constantTimeTokenMatch(supplied, expected))) return json(401, "unauthorized");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) return json(415, "unsupported_media_type");
  const raw = await request.text();
  if (raw.length > 16_384) return json(413, "payload_too_large");
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json(400, "invalid_json"); }
  const validationError = validatePrediction(payload);
  if (validationError) return json(422, validationError);
  // Even authenticated, validated requests must not be written until an
  // independently verified odds adapter and approved strategy are in place.
  return json(503, "verified_odds_provenance_not_configured");
});
