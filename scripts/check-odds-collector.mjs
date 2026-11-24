import test from "node:test";
import assert from "node:assert/strict";
import { createHandler, DAILY_KEYS, ukTime, withinCollectionWindow, normaliseOdds, quota, sha256 } from "../supabase/functions/gerball-odds-collector/collector.mjs";

const TOKEN = "a".repeat(64);
const NOW = "2026-11-24T12:00:03.000Z";
const SPORT = "soccer_epl";
const event = (overrides = {}) => ({
  id: "fixture-1", sport_key: SPORT, sport_title: "Premier League",
  commence_time: "2026-11-24T20:00:00Z", home_team: "Home", away_team: "Away",
  bookmakers: [{ key: "bookmaker", title: "Bookmaker", last_update: "2026-11-24T11:59:00Z", markets: [
    { key: "h2h", outcomes: [{ name: "Home", price: 2.1 }, { name: "Draw", price: 3.4 }, { name: "Away", price: 3.7 }] },
    { key: "totals", last_update: "2026-11-24T12:00:00Z", outcomes: [
      { name: "Over", point: 2.5, price: 1.95 }, { name: "Under", point: 2.5, price: 1.95 },
      { name: "Over", point: 3.5, price: 3.0 },
    ] },
    { key: "h2h_lay", outcomes: [{ name: "Home", price: 2.2 }] },
  ] }], ...overrides,
});
const respond = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const request = (body, token = TOKEN) => new Request("https://collector.example", {
  method: "POST", headers: { "content-type": "application/json", "x-gerball-token": token }, body: JSON.stringify(body),
});

function fixture(options = {}) {
  const values = {
    SUPABASE_URL: "https://database.example", SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key",
    GERBALL_ODDS_LEAGUES: SPORT,
    ...Object.fromEntries(Object.values(DAILY_KEYS).map((name, i) => [name, `private-provider-key-${i}`])),
    ...options.env,
  };
  const calls = [], stored = [];
  const handler = createHandler({
    env: name => values[name], envNames: () => Object.keys(values), now: () => new Date(options.time ?? NOW),
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      if (url.startsWith(values.SUPABASE_URL)) {
        const name = url.split("/").at(-1), body = JSON.parse(init.body);
        if (name === "gerball_odds_authorized") return respond(options.authorized ?? true);
        if (name === "gerball_odds_claim_run") return respond(options.claim ?? { claimed: true, completed_leagues: [], attempt: 1 });
        if (name === "gerball_odds_store_league") {
          stored.push(body);
          return respond({ inserted: body.p_rows.length, total: body.p_rows.length });
        }
        if (name === "gerball_odds_finish_run") return respond({
          status: stored.every(s => s.p_status !== "failed") && !body.p_error ? "completed" : "failed",
          records_collected: stored.reduce((total, s) => total + s.p_rows.length, 0), error: body.p_error,
        });
        throw new Error("unexpected RPC");
      }
      if (options.provider) return options.provider(url, init);
      if (url.includes("/sports/?all=true")) return respond([{ key: SPORT, active: true }], 200, { "x-requests-remaining": "500", "x-requests-last": "0" });
      return respond([event()], 200, { "x-requests-remaining": "498", "x-requests-used": "2", "x-requests-last": "2" });
    },
  });
  return { handler, calls, stored, values };
}

test("UK noon tracks GMT, BST and both clock-change days", () => {
  for (const iso of ["2026-01-15T12:00:00Z", "2026-07-15T11:00:00Z", "2026-03-29T11:00:00Z", "2026-10-25T12:00:00Z"]) {
    assert.equal(withinCollectionWindow(ukTime(new Date(iso))), true, iso);
  }
  for (const iso of ["2026-01-15T11:00:00Z", "2026-07-15T12:00:00Z", "2026-03-29T12:00:00Z", "2026-10-25T11:00:00Z", "2026-11-24T12:15:00Z"]) {
    assert.equal(withinCollectionWindow(ukTime(new Date(iso))), false, iso);
  }
});
test("all seven credential slots and London's midnight date are correct", () => {
  const days = Object.keys(DAILY_KEYS);
  for (let i = 0; i < 7; i++) {
    const t = ukTime(new Date(Date.UTC(2026, 10, 23 + i, 12)));
    assert.equal(t.weekday, days[i]); assert.equal(t.credential, DAILY_KEYS[days[i]]);
  }
  const late = ukTime(new Date("2026-07-19T23:30:00Z"));
  assert.equal(late.date, "2026-07-20"); assert.equal(late.credential, "ODDS_API_KEY_MON");
});
test("stores only requested markets, deduplicates, and retains actual timestamps/provenance", () => {
  const normalized = normaliseOdds([event(), event()], SPORT, NOW, "2026-11-24", "b".repeat(64));
  assert.equal(normalized.rows.length, 5);
  assert.deepEqual(normalized.rows.map(r => r.selection), ["H", "D", "A", "O25", "U25"]);
  assert.equal(normalized.rows[0].source_updated_at, "2026-11-24T11:59:00.000Z");
  assert.equal(normalized.rows[3].source_updated_at, "2026-11-24T12:00:00.000Z");
  assert.ok(normalized.rows.every(r => r.collected_at === NOW && r.response_sha256 === "b".repeat(64) && r.football_data_league === "E0"));
});
test("rejects started fixtures, unknown sports, fabricated timestamps and invalid prices", () => {
  const invalid = event();
  invalid.bookmakers[0].last_update = "2026-11-24T12:01:00Z";
  invalid.bookmakers[0].markets[1].last_update = null;
  const normalized = normaliseOdds([
    event({ commence_time: "2026-11-24T12:00:00Z" }), event({ sport_key: "other" }), invalid,
    event({ bookmakers: [{ key: "x", title: "X", markets: [{ key: "h2h", outcomes: [{ name: "Home", price: 2 }] }] }] }),
  ], SPORT, NOW, "2026-11-24", "b".repeat(64));
  assert.equal(normalized.rows.length, 0);
  const badPrice = event();
  badPrice.bookmakers[0].markets = [{ key: "h2h", outcomes: [{ name: "Home", price: "2.0" }, { name: "Draw", price: 1 }, { name: "Away", price: NaN }] }];
  assert.equal(normaliseOdds([badPrice], SPORT, NOW, "2026-11-24", "b".repeat(64)).rows.length, 0);
});
test("missing or incorrect collector auth produces zero provider calls", async () => {
  const missing = fixture();
  assert.equal((await missing.handler(request({ action: "collect" }, ""))).status, 401);
  assert.equal(missing.calls.length, 0);
  const wrong = fixture({ authorized: false });
  assert.equal((await wrong.handler(request({ action: "verify" }))).status, 401);
  assert.equal(wrong.calls.length, 1);
  assert.ok(wrong.calls[0].url.endsWith("gerball_odds_authorized"));
  assert.equal(JSON.parse(wrong.calls[0].init.body).p_digest, await sha256(TOKEN));
});
test("verifies seven credentials without URLs or output leaking any secret", async () => {
  const f = fixture();
  const response = await f.handler(request({ action: "verify" }));
  const report = await response.json();
  assert.equal(report.verified_count, 7);
  const providerCalls = f.calls.filter(c => c.url.startsWith("https://api.the-odds-api.com"));
  assert.equal(providerCalls.length, 7);
  assert.ok(providerCalls.every(c => c.url.endsWith("/sports/?all=true")));
  assert.deepEqual(new Set(providerCalls.map(c => c.init.headers["x-api-key"])), new Set(Object.values(DAILY_KEYS).map(k => f.values[k])));
  const output = JSON.stringify(report);
  assert.ok(!output.includes("private-provider-key") && !output.includes(TOKEN));
});
test("missing slots and provider errors are reported without raw message leakage", async () => {
  const f = fixture({ env: { ODDS_API_KEY_MON: undefined }, provider: (_url, init) => respond({
    error_code: "INVALID_KEY", message: `bad key ${init.headers["x-api-key"]}`,
  }, 401) });
  const report = await (await f.handler(request({ action: "verify" }))).json();
  assert.equal(report.credentials[0].status, "missing");
  assert.equal(report.credentials[1].error_code, "INVALID_KEY");
  assert.ok(!JSON.stringify(report).includes("private-provider-key"));
});
test("completed run is a no-op with no odds or sports requests", async () => {
  const f = fixture({ claim: { claimed: false, reason: "daily_run_completed" } });
  assert.equal((await (await f.handler(request({ action: "collect" }))).json()).reason, "daily_run_completed");
  assert.equal(f.calls.filter(c => c.url.includes("the-odds-api")).length, 0);
});
test("a live collection chooses Tuesday's key and stores five normalized rows", async () => {
  const f = fixture();
  const result = await f.handler(request({ action: "collect" }));
  assert.equal(result.status, 200);
  assert.equal(f.stored[0].p_rows.length, 5);
  const call = f.calls.find(c => c.url.includes("/odds/?"));
  assert.equal(call.init.headers["x-api-key"], f.values.ODDS_API_KEY_TUE);
  const url = new URL(call.url);
  assert.equal(url.searchParams.get("regions"), "uk");
  assert.equal(url.searchParams.get("markets"), "h2h,totals");
  assert.equal(url.searchParams.get("commenceTimeFrom"), "2026-11-24T12:00:03Z");
  assert.equal(url.searchParams.has("apiKey"), false);
});
test("recovery skips completed leagues and records provider failure on incomplete league", async () => {
  const f = fixture({ env: { GERBALL_ODDS_LEAGUES: "soccer_epl,soccer_efl_champ" },
    claim: { claimed: true, completed_leagues: ["soccer_epl"], attempt: 2 },
    provider: url => url.includes("/sports/?") ? respond([
      { key: "soccer_epl", active: true }, { key: "soccer_efl_champ", active: true },
    ]) : respond({ error_code: "OUT_OF_USAGE_CREDITS", message: "secret provider details" }, 401, { "x-requests-remaining": "0" }),
  });
  const result = await f.handler(request({ action: "collect" }));
  assert.equal(result.status, 502);
  assert.equal(f.calls.filter(c => c.url.includes("/odds/?")).length, 1);
  assert.equal(f.stored[0].p_sport, "soccer_efl_champ");
  assert.equal(f.stored[0].p_status, "failed");
  assert.equal(f.stored[0].p_meta.error_message, "OUT_OF_USAGE_CREDITS");
  assert.equal(f.stored[0].p_meta.requests_remaining, 0);
});
test("manual commissioning uses its actual collection time while scheduled call skips after noon", async () => {
  const f = fixture({ time: "2026-11-24T16:00:00.000Z" });
  assert.equal((await (await f.handler(request({ action: "collect" }))).json()).reason, "outside_collection_window");
  assert.equal((await f.handler(request({ action: "collect", manual: true }))).status, 200);
  assert.equal(f.stored[0].p_rows[0].collected_at, "2026-11-24T16:00:00.000Z");
});
test("invalid configuration fails without marking a zero-league run complete", async () => {
  const f = fixture({ env: { GERBALL_ODDS_LEAGUES: "" } });
  assert.equal((await f.handler(request({ action: "collect" }))).status, 503);
  assert.equal(f.calls.length, 1);
});
test("quota handles absent and malformed values without converting to zero", () => {
  assert.equal(quota(new Headers()).requests_remaining, null);
  assert.equal(quota(new Headers({ "x-requests-remaining": "" })).requests_remaining, null);
  assert.equal(quota(new Headers({ "x-requests-remaining": "490" })).requests_remaining, 490);
});
