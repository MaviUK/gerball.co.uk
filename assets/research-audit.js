(function (root) {
  'use strict';

  const BASIS = 'retrospective_cross_market_comparison';
  const WAGER_FIELDS = Object.freeze(['season', 'fixture_id', 'fixture_key', 'wager_key', 'date', 'league', 'home', 'away', 'market_code', 'market', 'home_ppg', 'away_ppg', 'home_prior_games', 'away_prior_games', 'opening_odds', 'effective_odds', 'home_goals', 'away_goals', 'result', 'net_units']);

  function copy(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(copy));
    if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])));
    if (typeof value === 'number' && !Number.isFinite(value)) throw Error('A research report contains an invalid number.');
    return value === undefined ? null : value;
  }

  function reconcile(selections) {
    let bets = 0, profit = 0, expectedBets = 0, expectedProfit = 0;
    let ok = Array.isArray(selections) && selections.length > 0;
    const rows = [];
    for (const selection of Array.isArray(selections) ? selections : []) {
      const wagers = Array.isArray(selection.wagers) ? selection.wagers : [];
      const valid = Number.isInteger(selection.reportedBets) && selection.reportedBets >= 0 && Number.isFinite(selection.reportedProfit) && wagers.every(wager => typeof wager.net === 'number' && Number.isFinite(wager.net));
      const actualProfit = valid ? wagers.reduce((sum, wager) => sum + wager.net, 0) : null;
      const matches = valid && wagers.length === selection.reportedBets && Math.abs(actualProfit - selection.reportedProfit) < 0.000001;
      ok = ok && matches;
      bets += wagers.length;
      profit += actualProfit ?? 0;
      expectedBets += selection.reportedBets;
      expectedProfit += selection.reportedProfit;
      rows.push({ season: selection.season, league: selection.league, market: selection.market, reportedBets: selection.reportedBets, actualBets: wagers.length, reportedProfit: selection.reportedProfit, actualProfit, matches });
    }
    return { ok: Boolean(ok && bets === expectedBets && Math.abs(profit - expectedProfit) < 0.000001), bets, profit, rows };
  }

  function snapshot(input) {
    if (!input || !input.settings || !input.derived || !Array.isArray(input.sections) || !Array.isArray(input.forwardSelections) || !Array.isArray(input.wagerDifferences) || !Array.isArray(input.validationSummaries)) throw Error('A completed historical comparison is required.');
    for (const section of input.sections) {
      if (!Array.isArray(section.headings) || !Array.isArray(section.rows) || section.rows.some(row => !Array.isArray(row) || row.length !== section.headings.length)) throw Error('A research report has inconsistent columns.');
    }
    return copy({ ...input, analysis_basis: BASIS, reconciled: reconcile(input.forwardSelections).ok });
  }

  function metadata(run) {
    if (!run || run.analysis_basis !== BASIS) throw Error('Run the historical comparison before exporting.');
    const settings = run.settings, derived = run.derived;
    return [
      ['analysis_basis', BASIS], ['completed_at_utc', run.completed_at],
      ['league_scope', settings.scope], ['country', settings.country], ['selected_league', settings.league], ['leagues', settings.leagues.join('|')],
      ['markets', 'H|D|A|O25|U25'], ['from', settings.from], ['to', settings.to],
      ['fixture_id_basis', 'Source-native ID when returned; blank when unavailable'],
      ['fixture_key_basis', 'JSON tuple [league,date,home,away] using exact stored values'],
      ['wager_key_basis', 'JSON tuple [league,date,home,away,market_code or market] using exact stored values'],
      ['form_threshold', settings.adv], ['odds_min', settings.min], ['odds_max', settings.max],
      ['commission_pct', Number((settings.commission * 100).toFixed(8))], ['odds_reduction_pct', Number((settings.slippage * 100).toFixed(8))],
      ['minimum_prior_matches_per_team', 5], ['minimum_training_seasons', 2],
      ['minimum_training_bets', derived.minimum_training_bets], ['minimum_profitable_training_season_fraction', derived.minimum_profitable_training_season_fraction],
      ['ranking_basis', derived.ranking_basis], ['ranking_minimum_test_bets', derived.ranking_minimum_test_bets], ['ranking_minimum_assessed_seasons', derived.ranking_minimum_assessed_seasons],
      ['ranking_positive_season_fraction', derived.ranking_positive_season_fraction], ['difference_consistency_fraction', derived.difference_consistency_fraction],
    ];
  }

  function wagerValues(wager, season) {
    const fixtureIdentity = [wager.league, wager.date, wager.home, wager.away];
    const fields = { ...wager, season: season ?? wager.season, fixture_key: JSON.stringify(fixtureIdentity), wager_key: JSON.stringify([...fixtureIdentity, wager.market_code ?? wager.market]), opening_odds: wager.odds, result: wager.won ? 'Won' : 'Lost', net_units: wager.net };
    return WAGER_FIELDS.map(field => fields[field] ?? null);
  }

  function forwardRows(run) {
    const check = reconcile(run?.forwardSelections);
    if (!run?.reconciled || !check.ok || !check.bets) throw Error('The selected settled wagers must reconcile before export.');
    const rows = metadata(run).map(row => ['metadata', 'setting', ...row]);
    for (const section of run.sections) {
      rows.push([section.key, 'header', ...section.headings]);
      for (const row of section.rows) rows.push([section.key, 'data', ...row]);
    }
    rows.push(['settled_wagers', 'header', ...WAGER_FIELDS]);
    for (const selection of run.forwardSelections) {
      for (const wager of selection.wagers) rows.push(['settled_wagers', 'data', ...wagerValues(wager, selection.season)]);
    }
    const width = Math.max(2, ...rows.map(row => row.length));
    const header = ['section', 'row_type', ...Array.from({ length: width - 2 }, (_, index) => 'field_' + (index + 1))];
    return [header, ...rows.map(row => [...row, ...Array(width - row.length).fill(null)])];
  }

  function differenceRows(run) {
    const meta = metadata(run), threshold = run.derived.difference_consistency_fraction;
    const items = run.wagerDifferences.filter(item => item.fraction === threshold).sort((a, b) => a.date.localeCompare(b.date) || a.league.localeCompare(b.league) || a.home.localeCompare(b.home) || a.away.localeCompare(b.away) || a.market.localeCompare(b.market) || String(a.fixture_id ?? '').localeCompare(String(b.fixture_id ?? '')));
    if (!items.length) return [];
    return [[...meta.map(([key]) => key), 'side', ...WAGER_FIELDS], ...items.map(wager => [...meta.map(([, value]) => value), wager.side, ...wagerValues(wager)])];
  }

  function validationRows(run) {
    const meta = metadata(run), data = run.validationSummaries;
    if (!data.some(item => item.bets > 0)) return [];
    const fields = ['training_min_bets', 'forward_bets', 'forward_roi_pct', 'max_drawdown_units', 'positive_test_seasons', 'active_test_seasons', 'bootstrap_low_roi_pct', 'bootstrap_high_roi_pct', 'bootstrap_positive_draw_pct', 'assessment'];
    const rows = [[...meta.map(([key]) => key), ...fields]];
    for (const item of data) {
      const sufficient = item.bets >= 100 && item.activeSeasons >= 3 && item.bootstrap.low !== null;
      const status = !sufficient ? 'Insufficient evidence' : item.bootstrap.low > 0 ? 'Positive historical interval - unconfirmed' : item.bootstrap.high < 0 ? 'Negative historical interval' : 'Uncertain - interval crosses zero';
      const rounded = (value, places = 6) => value === null ? null : Number(value.toFixed(places));
      rows.push([...meta.map(([, value]) => value), item.threshold, item.bets, rounded(item.roi), rounded(item.maxDD), item.positive, item.activeSeasons, rounded(item.bootstrap.low), rounded(item.bootstrap.high), item.bootstrap.positive === null ? null : rounded(100 * item.bootstrap.positive, 3), status]);
    }
    return rows;
  }

  root.GerballResearchAudit = Object.freeze({ snapshot, reconcile, forwardRows, differenceRows, validationRows });
})(typeof window === 'undefined' ? globalThis : window);
