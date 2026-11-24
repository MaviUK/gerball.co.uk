import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Run without arguments for the committed-data checks. To also validate every
// target against an export of this project's stored names, supply:
// node scripts/check-team-aliases.mjs --data /path/to/team-data.json
// No external team directory, API, or fuzzy matcher is used by this check.
// Some reviewed identity aliases include official source URLs as metadata.
const aliases = JSON.parse(readFileSync(new URL("../data/team-aliases.json", import.meta.url), "utf8"));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--data"),
  "Usage: node scripts/check-team-aliases.mjs [--data /path/to/team-data.json]");
const source = args.length ? JSON.parse(readFileSync(args[1], "utf8")) : null;
const key = (league, team) => JSON.stringify([league, team]);
const supportedLeagues = new Set(["B1", "D1", "D2", "E0", "E1", "E2", "E3", "F1", "F2", "G1", "I1", "I2", "N1", "P1", "SC0", "SP1", "SP2", "T1"]);

export function validateAliases(document, storedNames = null) {
  assert.equal(document.version, 1, "Unsupported alias data version");
  assert.equal(document.provider, "the_odds_api", "Unexpected odds provider");
  assert.ok(Array.isArray(document.aliases) && document.aliases.length > 0, "Aliases must be a nonempty array");
  const seen = new Set();
  const history = storedNames && new Set(storedNames.history_teams.map(t => key(t.league, t.team)));
  const provider = storedNames && new Set(storedNames.odds_teams.map(t => key(t.league, t.team)));
  const current = storedNames && new Set((storedNames.current_season_teams ?? []).map(t => key(t.league, t.team)));
  for (const row of document.aliases) {
    const fields = ["canonical_name", "league", "provider_name", "reason"];
    if (Object.hasOwn(row, "source_urls")) fields.push("source_urls");
    assert.deepEqual(Object.keys(row).sort(), fields.sort());
    assert.ok(supportedLeagues.has(row.league), `Unsupported league: ${row.league}`);
    for (const field of ["provider_name", "canonical_name", "reason"]) {
      assert.equal(typeof row[field], "string", `${field} must be a string`);
      assert.ok(row[field].length > 0 && row[field].length <= 200, `${field} must have a reasonable nonzero length`);
      assert.equal(row[field], row[field].trim(), `Whitespace in ${field}`);
      assert.ok(!/[\u0000-\u001f\u007f]/u.test(row[field]), `Control character in ${field}`);
    }
    if (row.source_urls !== undefined) {
      assert.ok(Array.isArray(row.source_urls) && row.source_urls.length > 0 && row.source_urls.length <= 3,
        "Identity sources must be a nonempty URL array");
      for (const sourceUrl of row.source_urls) {
        assert.equal(typeof sourceUrl, "string", "Source URL must be a string");
        const parsed = new URL(sourceUrl);
        assert.equal(parsed.protocol, "https:", "Source URL must use HTTPS");
        assert.equal(parsed.username + parsed.password, "", "Source URL must not contain credentials");
      }
    }
    const from = key(row.league, row.provider_name);
    assert.ok(!seen.has(from), `Duplicate provider/league alias: ${from}`);
    seen.add(from);
    assert.notEqual(row.provider_name, row.canonical_name, `Exact names do not need aliases: ${from}`);
    const reserveSuffix = row.provider_name.match(/\s(B|II|U\d{2})$/u)?.[1];
    if (reserveSuffix) {
      assert.ok(row.canonical_name.endsWith(` ${reserveSuffix}`),
        `Reserve or youth designation must be retained: ${from}`);
    }
    if (storedNames) {
      assert.ok(provider.has(from), `Provider name absent from supplied stored data: ${from}`);
      assert.ok(history.has(key(row.league, row.canonical_name)),
        `Canonical target absent from the same league's history: ${from} -> ${row.canonical_name}`);
      if (history.has(from)) {
        assert.ok(row.source_urls?.length > 0, `Historic exact-name override requires identity evidence: ${from}`);
        assert.ok(!current.has(from) && current.has(key(row.league, row.canonical_name)),
          `Historic spelling override must resolve to current records without merging current identities: ${from}`);
      }
    }
  }
}

const resolveAlias = (league, providerName) => aliases.aliases.find(a =>
  a.league === league && a.provider_name === providerName)?.canonical_name ?? null;

test("reviewed aliases have a valid shape and unique provider names within each league", () => {
  validateAliases(aliases);
});

test("common expansions retain the intended club identity", () => {
  const expected = [
    ["E0", "Manchester United", "Man United"],
    ["E0", "Manchester City", "Man City"],
    ["E0", "Nottingham Forest", "Nott'm Forest"],
    ["E1", "Queens Park Rangers", "QPR"],
    ["E2", "Sheffield Wednesday", "Sheffield Weds"],
    ["E3", "Bristol Rovers", "Bristol Rvs"],
    ["D1", "1. FC Köln", "FC Koln"],
    ["D2", "Greuther Fürth", "Greuther Furth"],
    ["F1", "Paris Saint Germain", "Paris SG"],
    ["B1", "RAAL La Louvière", "RAAL La Louviere"],
    ["N1", "Fortuna Sittard", "For Sittard"],
    ["P1", "Sporting Lisbon", "Sp Lisbon"],
    ["I2", "Südtirol", "Sudtirol"],
    ["T1", "Çorum FK", "Corum"],
  ];
  for (const [league, name, canonical] of expected) {
    assert.equal(resolveAlias(league, name), canonical, `${league}: ${name}`);
  }
});

test("city names do not collapse distinct clubs or first and reserve teams", () => {
  assert.equal(resolveAlias("SC0", "Dundee FC"), "Dundee");
  assert.notEqual(resolveAlias("SC0", "Dundee FC"), "Dundee United");
  assert.equal(resolveAlias("I1", "AC Milan"), "Milan");
  assert.equal(resolveAlias("I1", "Inter Milan"), "Inter");
  assert.equal(resolveAlias("SP1", "Real Sociedad"), "Sociedad");
  assert.equal(resolveAlias("SP2", "Real Sociedad B"), "Sociedad B");
  assert.equal(resolveAlias("G1", "Volos FC"), "Volos NFC");
  assert.notEqual(resolveAlias("G1", "Volos FC"), "Niki Volos");
  assert.equal(resolveAlias("T1", "Gazişehir Gaziantep"), "Gaziantep");
  assert.notEqual(resolveAlias("T1", "Gazişehir Gaziantep"), "Gaziantepspor");
  assert.equal(resolveAlias("E1", "Manchester United"), null, "Aliases are league-scoped");
});

test("reviewed identities carry primary sources and keep different clubs separate", () => {
  for (const [league, name, canonical] of [
    ["E2", "Wimbledon", "AFC Wimbledon"],
    ["P1", "Vitória SC", "Guimaraes"],
    ["SP2", "Celta Fortuna", "Celta B"],
    ["T1", "Basaksehir", "Buyuksehyr"],
    ["T1", "Erzurum BB", "Erzurumspor"],
    ["G1", "Levadiakos", "Levadeiakos"],
  ]) {
    assert.equal(resolveAlias(league, name), canonical, `${league}: ${name}`);
    const row = aliases.aliases.find(a => a.league === league && a.provider_name === name);
    assert.ok(row.source_urls?.length > 0, `Missing identity source: ${league} ${name}`);
  }
  assert.equal(resolveAlias("E0", "Wimbledon"), null, "Do not remap legacy Wimbledon");
  assert.equal(resolveAlias("E1", "Wimbledon"), null, "Do not remap legacy Wimbledon");
  assert.notEqual(resolveAlias("T1", "Erzurum BB"), "Erzurum", "Keep historic Erzurum separate");
  assert.notEqual(resolveAlias("P1", "Vitória SC"), "Setubal", "Keep Vitoria Setubal separate");
  assert.notEqual(resolveAlias("SP2", "Celta Fortuna"), "Celta", "Keep Celta's first team separate");
});

test("validator rejects duplicate aliases and loss of reserve-team designation", () => {
  assert.throws(() => validateAliases({ ...aliases, aliases: [aliases.aliases[0], aliases.aliases[0]] }), /Duplicate provider\/league/);
  assert.throws(() => validateAliases({ ...aliases, aliases: [{
    league: "SP2", provider_name: "Real Sociedad B", canonical_name: "Sociedad", reason: "Invalid test fixture.",
  }] }), /Reserve or youth designation/);
});

test("validator requires canonical history in the same league", () => {
  const sample = { ...aliases, aliases: [{
    league: "E0", provider_name: "Manchester United", canonical_name: "Man United", reason: "Manchester abbreviation.",
  }] };
  const names = {
    odds_teams: [{ league: "E0", team: "Manchester United" }],
    history_teams: [{ league: "E1", team: "Man United" }],
  };
  assert.throws(() => validateAliases(sample, names), /Canonical target absent/);
  names.history_teams.push({ league: "E0", team: "Man United" });
  validateAliases(sample, names);
});

test("an override of an exact old name requires evidence and a unique current spelling", () => {
  const row = aliases.aliases.find(a => a.league === "G1" && a.provider_name === "Levadiakos");
  const sample = { ...aliases, aliases: [row] };
  const names = {
    odds_teams: [{ league: "G1", team: "Levadiakos" }],
    history_teams: [{ league: "G1", team: "Levadiakos" }, { league: "G1", team: "Levadeiakos" }],
    current_season_teams: [{ league: "G1", team: "Levadeiakos" }],
  };
  validateAliases(sample, names);
  const { source_urls, ...withoutEvidence } = row;
  assert.throws(() => validateAliases({ ...sample, aliases: [withoutEvidence] }, names), /requires identity evidence/);
  names.current_season_teams.push({ league: "G1", team: "Levadiakos" });
  assert.throws(() => validateAliases(sample, names), /without merging current identities/);
});

test("every alias is backed by the supplied stored provider names and league history", { skip: !source }, () => {
  for (const field of ["odds_teams", "history_teams", "current_season_teams"]) {
    assert.ok(Array.isArray(source[field]), `Missing stored-name array: ${field}`);
  }
  validateAliases(aliases, source);
  const history = new Map(source.history_teams.map(t => [key(t.league, t.team), t]));
  const current = new Set(source.current_season_teams.map(t => key(t.league, t.team)));
  const byProvider = new Map(aliases.aliases.map(a => [key(a.league, a.provider_name), a.canonical_name]));
  const report = { provider_names: source.odds_teams.length, exact_matches: 0, alias_matches: 0,
    matched_current_season: 0, history_only: [], unresolved: [] };
  for (const item of source.odds_teams) {
    const from = key(item.league, item.team);
    let canonical = null;
    if (byProvider.has(from)) {
      canonical = byProvider.get(from);
      report.alias_matches++;
    } else if (history.has(from)) {
      canonical = item.team;
      report.exact_matches++;
    }
    if (canonical === null) report.unresolved.push(item);
    else if (current.has(key(item.league, canonical))) report.matched_current_season++;
    else report.history_only.push({ ...item, canonical_name: canonical, last_match: history.get(key(item.league, canonical)).last_match });
  }
  console.log(JSON.stringify(report, null, 2));
});
