(function (root) {
  'use strict';

  const MARKETS = Object.freeze({ H: 'Home win', D: 'Draw', A: 'Away win', O25: 'Over 2.5 goals', U25: 'Under 2.5 goals' });
  const CSV_FIELDS = Object.freeze(['league', 'market', 'market_name', 'from', 'to', 'form_threshold', 'odds_min', 'odds_max', 'commission_pct', 'odds_reduction_pct', 'split_date', 'analysis_basis', 'fixture_id', 'date', 'season', 'home', 'away', 'home_ppg', 'away_ppg', 'opening_odds', 'effective_odds', 'result', 'net_profit', 'sample']);

  function number(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function validateSettings(value) {
    if (!value || typeof value.league !== 'string' || !value.league || !Object.hasOwn(MARKETS, value.market)) throw Error('Choose a league and a supported market.');
    if (!validDate(value.from) || !validDate(value.to) || value.from >= value.to) throw Error('Choose a valid start date before the end date.');
    const settings = { league: value.league, market: value.market, from: value.from, to: value.to };
    for (const field of ['adv', 'min', 'max', 'commission', 'slippage']) settings[field] = number(value[field]);
    if (Object.values(settings).some(item => item === null) || settings.adv < 0 || settings.min < 1.01 || settings.max < settings.min || settings.commission < 0 || settings.commission > 0.25 || settings.slippage < 0 || settings.slippage > 0.25) throw Error('Check the form threshold, odds range and cost assumptions.');
    return Object.freeze(settings);
  }

  function textOrder(a, b) { const left = String(a ?? ''), right = String(b ?? ''); return left < right ? -1 : left > right ? 1 : 0; }
  function identityOrder(a, b) {
    const left = String(a ?? ''), right = String(b ?? '');
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) { const x = BigInt(left), y = BigInt(right); return x < y ? -1 : x > y ? 1 : 0; }
    return textOrder(left, right);
  }
  function fixtureOrder(a, b) {
    return textOrder(a.match_date, b.match_date) || textOrder(a.home_team, b.home_team) || textOrder(a.away_team, b.away_team) || identityOrder(a.id ?? a.fixture_id, b.id ?? b.fixture_id);
  }

  function summarize(records) {
    let profit = 0, peak = 0, maxDrawdown = 0, wins = 0;
    for (const row of records) {
      const net = number(row.net_profit);
      if (net === null || !['Won', 'Lost'].includes(row.result)) throw Error('A settled research row is invalid.');
      profit += net;
      if (row.result === 'Won') wins++;
      peak = Math.max(peak, profit);
      maxDrawdown = Math.max(maxDrawdown, peak - profit);
    }
    return Object.freeze({ bets: records.length, wins, profit, roi: records.length ? 100 * profit / records.length : null, maxDrawdown, strikeRate: records.length ? wins / records.length : null });
  }

  function evaluate(matches, suppliedSettings) {
    const settings = validateSettings(suppliedSettings);
    if (!Array.isArray(matches)) throw Error('Historical fixtures are unavailable.');
    if (matches.length < 30) throw Error('Not enough historical fixtures for a meaningful split.');
    if (matches.length >= 10000) throw Error('Dataset reached the 10,000-fixture safety limit. Shorten the date range.');
    if (matches.some(row => !row || !validDate(row.match_date))) throw Error('Historical fixtures contain an invalid match date.');
    const ordered = [...matches].sort(fixtureOrder);
    const dates = [...new Set(ordered.map(row => row.match_date))].sort();
    if (dates.length < 10) throw Error('Not enough distinct match dates.');
    const split = dates[Math.max(1, Math.floor(dates.length * 0.7))];
    const detail = [];
    let excludedResults = 0;
    for (const row of ordered) {
      const h = number(row.home_prior_ppg), a = number(row.away_prior_ppg);
      const homeGames = number(row.home_prior_games), awayGames = number(row.away_prior_games), odds = number(row.opening_home);
      if (h === null || a === null || !Number.isInteger(homeGames) || !Number.isInteger(awayGames) || homeGames < 5 || awayGames < 5 || odds === null || odds < settings.min || odds > settings.max) continue;
      // Keep the existing historical frontend operators and selected-market RPC
      // price alias. Do not add rounding or an epsilon to PPG qualification here.
      const matched = settings.market === 'H' ? h - a >= settings.adv : settings.market === 'A' ? a - h >= settings.adv : settings.market === 'D' ? Math.abs(h - a) <= settings.adv : Math.abs(h - a) >= settings.adv;
      if (!matched) continue;
      const hg = number(row.home_goals), ag = number(row.away_goals);
      if (!Number.isInteger(hg) || !Number.isInteger(ag) || hg < 0 || ag < 0) { excludedResults++; continue; }
      const won = settings.market === 'H' ? hg > ag : settings.market === 'D' ? hg === ag : settings.market === 'A' ? hg < ag : settings.market === 'O25' ? hg + ag > 2 : hg + ag < 3;
      const effectiveOdds = Math.max(1.01, odds * (1 - settings.slippage));
      const net = won ? (effectiveOdds - 1) * (1 - settings.commission) : -1;
      detail.push(Object.freeze({ fixture_id: row.id ?? row.fixture_id ?? null, date: row.match_date, season: row.season == null ? 'Unknown' : String(row.season), home: row.home_team, away: row.away_team, home_ppg: h, away_ppg: a, opening_odds: odds, effective_odds: effectiveOdds, result: won ? 'Won' : 'Lost', net_profit: net, sample: row.match_date < split ? 'Training' : 'Out of sample' }));
    }
    const samples = ['Training', 'Out of sample'].map(label => Object.freeze({ label, fixtures: ordered.filter(row => (row.match_date < split ? 'Training' : 'Out of sample') === label).length, ...summarize(detail.filter(row => row.sample === label)) }));
    const seasonFixtures = new Map();
    for (const row of ordered) { const season = row.season == null ? 'Unknown' : String(row.season); seasonFixtures.set(season, (seasonFixtures.get(season) || 0) + 1); }
    const seasons = [];
    let priorFixtures = 0;
    for (const [season, fixtures] of seasonFixtures) {
      if (priorFixtures) { const stats = summarize(detail.filter(row => row.season === season)); seasons.push(Object.freeze({ season, training: priorFixtures, fixtures, bets: stats.bets, wins: stats.wins, profit: stats.profit, roi: stats.roi, dd: stats.maxDrawdown })); }
      priorFixtures += fixtures;
    }
    return Object.freeze({ ...settings, marketLabel: MARKETS[settings.market], split, fixtureCount: ordered.length, dateCount: dates.length, excludedResults, detail: Object.freeze(detail), samples: Object.freeze(samples), seasons: Object.freeze(seasons) });
  }

  function csvCell(value) {
    let raw = value == null ? '' : String(value);
    if (typeof value === 'string' && (/^[\t\r\n]/.test(raw) || /^\s*[=+@-]/.test(raw))) raw = "'" + raw;
    return '"' + raw.replace(/"/g, '""') + '"';
  }

  function csvForRun(run) {
    const settings = validateSettings(run);
    if (!Array.isArray(run.detail) || !validDate(run.split)) throw Error('Run a historical validation before exporting.');
    const metadata = { league: settings.league, market: settings.market, market_name: MARKETS[settings.market], from: settings.from, to: settings.to, form_threshold: settings.adv, odds_min: settings.min, odds_max: settings.max, commission_pct: Number((settings.commission * 100).toFixed(8)), odds_reduction_pct: Number((settings.slippage * 100).toFixed(8)), split_date: run.split, analysis_basis: 'retrospective_chronological_split' };
    const lines = [CSV_FIELDS.map(csvCell).join(','), ...run.detail.map(row => { const record = { ...metadata, ...row }; return CSV_FIELDS.map(field => csvCell(record[field])).join(','); })];
    return '\uFEFF' + lines.join('\r\n');
  }

  root.GerballWalkforward = Object.freeze({ evaluate, csvForRun, helpers: Object.freeze({ summarize, validateSettings }) });
})(typeof window === 'undefined' ? globalThis : window);
