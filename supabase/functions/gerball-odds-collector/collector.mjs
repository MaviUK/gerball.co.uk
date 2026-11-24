// Server-only collector. API credentials never enter URLs, logs or stored rows.
export const DAILY_KEYS = Object.freeze({
  Mon: "ODDS_API_KEY_MON", Tue: "ODDS_API_KEY_TUE", Wed: "ODDS_API_KEY_WED",
  Thu: "ODDS_API_KEY_THU", Fri: "ODDS_API_KEY_FRI", Sat: "ODDS_API_KEY_SAT",
  Sun: "ODDS_API_KEY_SUN",
});
export const LEAGUE_CODES = Object.freeze({
  soccer_epl: "E0", soccer_efl_champ: "E1", soccer_england_league1: "E2",
  soccer_england_league2: "E3", soccer_spl: "SC0", soccer_germany_bundesliga: "D1",
  soccer_germany_bundesliga2: "D2", soccer_spain_la_liga: "SP1",
  soccer_spain_segunda_division: "SP2", soccer_italy_serie_a: "I1",
  soccer_italy_serie_b: "I2", soccer_france_ligue_one: "F1", soccer_france_ligue_two: "F2",
  soccer_netherlands_eredivisie: "N1", soccer_portugal_primeira_liga: "P1",
  soccer_belgium_first_div: "B1", soccer_turkey_super_league: "T1", soccer_greece_super_league: "G1",
});
const API_BASE = "https://api.the-odds-api.com/v4";
const PROVIDER_ERRORS = new Set([
  "INVALID_KEY", "DEACTIVATED_KEY", "OUT_OF_USAGE_CREDITS", "EXCEEDED_FREQ_LIMIT",
  "INVALID_MARKET", "INVALID_REGION", "INVALID_SPORT", "UNKNOWN_SPORT",
]);
const ukFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", weekday: "short", year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function ukTime(now = new Date()) {
  const parts = Object.fromEntries(ukFormatter.formatToParts(now).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday,
    hour: Number(parts.hour), minute: Number(parts.minute), credential: DAILY_KEYS[parts.weekday],
  };
}
export const withinCollectionWindow = time => time.hour === 12 && time.minute < 15;
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});
class Failure extends Error {
  constructor(code) { super(code); this.code = code; }
}
const safeCode = error => error instanceof Failure ? error.code : "request_failed";
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.trim().length > 0 && value.length <= 200;
const count = value => /^\d+$/.test(value ?? "") && Number.isSafeInteger(Number(value)) ? Number(value) : null;
export function quota(headers) {
  return {
    requests_remaining: count(headers.get("x-requests-remaining")),
    requests_used: count(headers.get("x-requests-used")),
    requests_last: count(headers.get("x-requests-last")),
  };
}
export async function sha256(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
function absoluteTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}
function configuredLeagues(value) {
  const leagues = value === undefined ? Object.keys(LEAGUE_CODES) : value.split(",").map(v => v.trim());
  if (!leagues.length || leagues.some(v => !Object.hasOwn(LEAGUE_CODES, v))) throw new Failure("invalid_league_configuration");
  return [...new Set(leagues)];
}

export function normaliseOdds(events, sport, collectedAt, collectionDate, responseHash) {
  if (!Array.isArray(events)) throw new Failure("invalid_odds_response");
  const collected = Date.parse(collectedAt);
  const rows = new Map(), fixtures = new Set(), bookmakers = new Set();
  let rejected = 0;
  for (const event of events) {
    if (!object(event) || !text(event.id) || event.sport_key !== sport ||
        !text(event.home_team) || !text(event.away_team) || event.home_team === event.away_team ||
        !Array.isArray(event.bookmakers)) { rejected++; continue; }
    const kickoff = absoluteTime(event.commence_time);
    if (!Number.isFinite(kickoff)) { rejected++; continue; }
    if (kickoff <= collected) continue;
    for (const bookmaker of event.bookmakers) {
      if (!object(bookmaker) || !text(bookmaker.key) || !text(bookmaker.title) || !Array.isArray(bookmaker.markets)) { rejected++; continue; }
      for (const market of bookmaker.markets) {
        if (!object(market) || !["h2h", "totals"].includes(market.key)) continue;
        if (!Array.isArray(market.outcomes)) { rejected++; continue; }
        const sourceTime = market.last_update ?? bookmaker.last_update;
        const source = absoluteTime(sourceTime);
        if (!Number.isFinite(source) || source > collected || source >= kickoff) { rejected++; continue; }
        for (const outcome of market.outcomes) {
          if (!object(outcome) || typeof outcome.price !== "number" || !Number.isFinite(outcome.price) || outcome.price <= 1 || outcome.price > 10000) { rejected++; continue; }
          let selection;
          if (market.key === "h2h") {
            if (outcome.name === event.home_team) selection = "H";
            else if (outcome.name === event.away_team) selection = "A";
            else if (outcome.name === "Draw") selection = "D";
            else { rejected++; continue; }
          } else {
            if (outcome.point !== 2.5) continue;
            if (outcome.name === "Over") selection = "O25";
            else if (outcome.name === "Under") selection = "U25";
            else { rejected++; continue; }
          }
          const line = market.key === "totals" ? 2.5 : 0;
          const identity = JSON.stringify([event.id, bookmaker.key, market.key, selection, line]);
          if (!rows.has(identity)) rows.set(identity, {
            provider: "the_odds_api", event_id: event.id, sport_key: sport,
            football_data_league: LEAGUE_CODES[sport], league: text(event.sport_title) ? event.sport_title : sport,
            home_team: event.home_team, away_team: event.away_team,
            kickoff_at: new Date(kickoff).toISOString(), bookmaker_key: bookmaker.key,
            bookmaker_name: bookmaker.title, market: market.key, selection, line,
            decimal_odds: outcome.price, source_updated_at: new Date(source).toISOString(),
            collected_at: collectedAt, collection_date: collectionDate, response_sha256: responseHash,
          });
          fixtures.add(event.id); bookmakers.add(bookmaker.key);
        }
      }
    }
  }
  const values = [...rows.values()];
  return {
    rows: values,
    meta: {
      event_count: fixtures.size, bookmaker_count: bookmakers.size,
      h2h_records: values.filter(r => r.market === "h2h").length,
      totals_records: values.filter(r => r.market === "totals").length,
      rejected_items: rejected,
    },
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}

export function createHandler({
  env = name => Deno.env.get(name),
  envNames = () => Object.keys(Deno.env.toObject()),
  fetchFn = fetch,
  now = () => new Date(),
} = {}) {
  async function rpc(name, payload, signal) {
    const base = env("SUPABASE_URL"), key = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!base || !key) throw new Failure("database_configuration_missing");
    let result;
    try {
      result = await fetchFn(`${base.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
        method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(payload), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      });
      if (!result.ok) throw new Failure(`database_http_${result.status}`);
      return await result.json();
    } catch (error) {
      if (error instanceof Failure) throw error;
      throw new Failure("database_request_failed");
    }
  }
  async function provider(path, key, signal) {
    try {
      const result = await fetchFn(`${API_BASE}${path}`, {
        headers: { "x-api-key": key, accept: "application/json" },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      });
      const raw = await result.text();
      if (raw.length > 10_000_000) throw new Failure("provider_response_too_large");
      let data;
      try { data = JSON.parse(raw); } catch { data = null; }
      return {
        ok: result.ok, http_status: result.status, data, raw, ...quota(result.headers),
        error_code: object(data) && PROVIDER_ERRORS.has(data.error_code) ? data.error_code : `provider_http_${result.status}`,
      };
    } catch (error) {
      if (error instanceof Failure) throw error;
      throw new Failure("provider_connection_error");
    }
  }
  const validSports = data => Array.isArray(data) && data.every(s => object(s) && text(s.key) && typeof s.active === "boolean");

  async function verify() {
    const checkedAt = now().toISOString();
    const credentials = await mapLimit(Object.entries(DAILY_KEYS), 3, async ([day, secret]) => {
      const key = env(secret)?.trim();
      const base = { day, secret, present: Boolean(key), checked_at: checkedAt };
      if (!key) return { ...base, status: "missing" };
      try {
        const result = await provider("/sports/?all=true", key);
        return {
          ...base, status: result.ok && validSports(result.data) ? "verified" :
            result.error_code === "OUT_OF_USAGE_CREDITS" ? "quota_exhausted" : "failed",
          http_status: result.http_status,
          requests_remaining: result.requests_remaining, requests_used: result.requests_used,
          requests_last: result.requests_last,
          ...(result.ok && validSports(result.data) ? {} : { error_code: result.ok ? "invalid_sports_response" : result.error_code }),
        };
      } catch (error) { return { ...base, status: "connection_error", error_code: safeCode(error) }; }
    });
    return json(200, {
      checked_at: checkedAt, verified_count: credentials.filter(c => c.status === "verified").length,
      credentials,
      ...(credentials.some(c => !c.present) ? { configured_odds_secret_names: envNames().filter(n => /ODDS.*KEY/i.test(n)).sort() } : {}),
    });
  }

  async function collect(manual) {
    const time = ukTime(now());
    if (!manual && !withinCollectionWindow(time)) return json(200, {
      status: "skipped", reason: "outside_collection_window", collection_date: time.date,
    });
    const leagues = configuredLeagues(env("GERBALL_ODDS_LEAGUES"));
    const owner = crypto.randomUUID();
    const claim = await rpc("gerball_odds_claim_run", {
      p_date: time.date, p_slot: time.credential, p_owner: owner, p_manual: manual, p_leagues: leagues,
    });
    if (!claim.claimed) return json(200, { status: "skipped", reason: claim.reason, collection_date: time.date });
    let runError = null;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), 95_000);
    try {
      const apiKey = env(time.credential)?.trim();
      if (!apiKey) throw new Failure("daily_credential_missing");
      const catalog = await provider("/sports/?all=true", apiKey, deadline.signal);
      if (!catalog.ok) throw new Failure(catalog.error_code);
      if (!validSports(catalog.data)) throw new Failure("invalid_sports_response");
      const sports = new Map(catalog.data.map(s => [s.key, s]));
      const completed = new Set(claim.completed_leagues ?? []);
      let remaining = catalog.requests_remaining;
      let stopReason = null;
      await mapLimit(leagues.filter(l => !completed.has(l)), 3, async sport => {
        if (deadline.signal.aborted) { runError = "run_time_budget_exceeded"; return; }
        let rows = [], status = "failed", meta = {};
        try {
          if (stopReason) throw new Failure(stopReason);
          if (remaining !== null && remaining < 2) throw new Failure("quota_limit_reached");
          const item = sports.get(sport);
          if (!item) throw new Failure("league_not_in_provider_catalog");
          if (!item.active) {
            status = "inactive";
            meta = { event_count: 0, bookmaker_count: 0, h2h_records: 0, totals_records: 0 };
          } else {
            const params = new URLSearchParams({
              regions: "uk", markets: "h2h,totals", oddsFormat: "decimal", dateFormat: "iso",
              commenceTimeFrom: now().toISOString().replace(/\.\d{3}Z$/, "Z"),
            });
            const result = await provider(`/sports/${sport}/odds/?${params}`, apiKey, deadline.signal);
            meta = { requests_remaining: result.requests_remaining, requests_used: result.requests_used, requests_last: result.requests_last };
            if (result.requests_remaining !== null) remaining = remaining === null ? result.requests_remaining : Math.min(remaining, result.requests_remaining);
            if (!result.ok) {
              if ([401, 403, 429].includes(result.http_status)) stopReason = result.error_code;
              throw new Failure(result.error_code);
            }
            const normalised = normaliseOdds(result.data, sport, now().toISOString(), time.date, await sha256(result.raw));
            rows = normalised.rows; meta = { ...meta, ...normalised.meta };
            if (normalised.meta.rejected_items > 0 && !rows.length && result.data.length > 0) throw new Failure("all_odds_records_invalid");
            status = "completed";
          }
        } catch (error) { meta.error_message = safeCode(error); }
        if (deadline.signal.aborted) { runError = "run_time_budget_exceeded"; return; }
        try {
          await rpc("gerball_odds_store_league", {
            p_date: time.date, p_owner: owner, p_sport: sport, p_status: status, p_rows: rows, p_meta: meta,
          }, deadline.signal);
        } catch (error) { runError = safeCode(error); }
      });
    } catch (error) { runError = safeCode(error); }
    finally { clearTimeout(timer); }
    const report = await rpc("gerball_odds_finish_run", { p_date: time.date, p_owner: owner, p_error: runError });
    return json(report.status === "completed" ? 200 : 502, report);
  }

  return async function handle(request) {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    const token = request.headers.get("x-gerball-token") ?? "";
    if (!/^[a-f0-9]{64}$/.test(token)) return json(401, { error: "unauthorized" });
    try {
      if (!(await rpc("gerball_odds_authorized", { p_digest: await sha256(token) }))) return json(401, { error: "unauthorized" });
      if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json(415, { error: "unsupported_media_type" });
      if (Number(request.headers.get("content-length")) > 2048) return json(413, { error: "payload_too_large" });
      const raw = await request.text();
      if (raw.length > 2048) return json(413, { error: "payload_too_large" });
      let body;
      try { body = JSON.parse(raw); } catch { return json(400, { error: "invalid_json" }); }
      if (!object(body) || Object.keys(body).some(k => !["action", "manual"].includes(k)) ||
          !["verify", "collect"].includes(body.action) || (body.manual !== undefined && typeof body.manual !== "boolean")) {
        return json(400, { error: "invalid_request" });
      }
      return body.action === "verify" ? await verify() : await collect(body.manual === true);
    } catch (error) { return json(503, { error: safeCode(error) }); }
  };
}
