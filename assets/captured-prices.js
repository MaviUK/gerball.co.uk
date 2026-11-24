(function (root) {
  'use strict';

  const MARKETS = Object.freeze({ H: 'Home win', D: 'Draw', A: 'Away win', O25: 'Over 2.5 goals', U25: 'Under 2.5 goals' });
  const MARKET_KEYS = Object.freeze(Object.keys(MARKETS));
  const LEAGUES = new Set(['E0', 'E1', 'E2', 'E3', 'SC0', 'D1', 'D2', 'I1', 'I2', 'SP1', 'SP2', 'F1', 'F2', 'N1', 'B1', 'P1', 'G1', 'T1']);
  const CACHE_MS = 5 * 60 * 1000, MAX_CACHE_ENTRIES = 30;
  const cache = new Map();
  const dayFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const stampFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' });
  const state = { request: 0, controller: null, timer: null, fixture: null, endpoint: '', market: null, returnFocus: null, fallbackView: 'upcoming', data: null };
  let ui = null;

  function timestamp(value) { const parsed = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : null; }
  function object(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = timestamp(value + 'T00:00:00Z');
    return parsed !== null && new Date(parsed).toISOString().slice(0, 10) === value;
  }
  function londonParts(value) {
    const parsed = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : timestamp(value);
    return parsed !== null && Number.isFinite(parsed) ? Object.fromEntries(dayFormatter.formatToParts(new Date(parsed)).map(part => [part.type, part.value])) : null;
  }
  function londonDay(value) { const parts = londonParts(value); return parts ? `${parts.year}-${parts.month}-${parts.day}` : ''; }
  function cachePeriod(value) { const parts = londonParts(value); return parts ? `${parts.year}-${parts.month}-${parts.day}:${Number(parts.hour) < 12 ? 'am' : 'pm'}` : ''; }
  function formatStamp(value) { const parsed = timestamp(value); return parsed === null ? 'Time unavailable' : `${stampFormatter.format(new Date(parsed))} UK`; }
  function formatDate(value) { return validDate(value) ? dateFormatter.format(new Date(value + 'T12:00:00Z')) : 'Date unavailable'; }
  function quotePrice(quote) { return object(quote) && typeof quote.price === 'number' && Number.isFinite(quote.price) && quote.price > 1 && quote.price <= 10000 ? quote.price : null; }
  function optionalStamp(value) { return value === null || timestamp(value) !== null; }
  function validQuote(quote, best = false) {
    if (quote === null) return true;
    return object(quote) && quotePrice(quote) !== null && optionalStamp(quote.source_updated_at) && optionalStamp(quote.collected_at) &&
      (!best || (typeof quote.bookmaker_key === 'string' && quote.bookmaker_key.length > 0 && (quote.bookmaker_name === null || typeof quote.bookmaker_name === 'string')));
  }
  function validMarkets(markets, best = false) { return object(markets) && MARKET_KEYS.every(key => Object.hasOwn(markets, key) && validQuote(markets[key], best)); }
  function validEnvelope(data, now) {
    const generated = timestamp(data?.generated_at);
    return object(data) && data.timezone === 'Europe/London' && ['completed', 'partial', 'no_data'].includes(data.collection_status) &&
      generated !== null && generated <= now + 60000 && (data.collection_date === null || validDate(data.collection_date)) &&
      optionalStamp(data.collected_at) && Array.isArray(data.fixtures) && data.fixtures.length <= 1;
  }
  function validFixture(fixture, eventId, league) {
    if (!object(fixture) || fixture.event_id !== eventId || !LEAGUES.has(fixture.league_code) || (league && fixture.league_code !== league) || timestamp(fixture.kickoff_at) === null ||
        !object(fixture.home) || typeof fixture.home.provider_name !== 'string' || !fixture.home.provider_name || !object(fixture.away) || typeof fixture.away.provider_name !== 'string' || !fixture.away.provider_name ||
        !validMarkets(fixture.markets, true) || fixture.bookmakers_loaded !== true || !Array.isArray(fixture.bookmakers) || fixture.bookmakers.length > 1000 ||
        !Number.isInteger(fixture.bookmaker_count) || fixture.bookmaker_count < 0 || fixture.bookmaker_count !== fixture.bookmakers.length) return false;
    const keys = new Set();
    for (const bookmaker of fixture.bookmakers) {
      if (!object(bookmaker) || typeof bookmaker.key !== 'string' || !bookmaker.key || keys.has(bookmaker.key) ||
          (bookmaker.name !== null && typeof bookmaker.name !== 'string') || !validMarkets(bookmaker.markets)) return false;
      keys.add(bookmaker.key);
    }
    for (const key of MARKET_KEYS) {
      const best = fixture.markets[key];
      const quotes = fixture.bookmakers.map(bookmaker => bookmaker.markets[key]).filter(quote => quote !== null);
      if (best === null) { if (quotes.length) return false; continue; }
      const selected = fixture.bookmakers.find(bookmaker => bookmaker.key === best.bookmaker_key)?.markets[key];
      if (!selected || selected.price !== best.price || timestamp(selected.source_updated_at) !== timestamp(best.source_updated_at) ||
          timestamp(selected.collected_at) !== timestamp(best.collected_at) || quotes.some(quote => quote.price > best.price)) return false;
    }
    return true;
  }
  function validPayload(data, eventId, league = null, now = Date.now()) {
    if (!validEnvelope(data, now)) return false;
    if (!data.fixtures.length) return true;
    return data.collection_status !== 'no_data' && validDate(data.collection_date) && validFixture(data.fixtures[0], eventId, league) && timestamp(data.fixtures[0].kickoff_at) > now;
  }
  function cacheIsFresh(entry, now = Date.now()) {
    if (!entry || !Number.isFinite(entry.savedAt) || now < entry.savedAt || now - entry.savedAt >= CACHE_MS) return false;
    const fixture = entry.data?.fixtures?.[0], generated = timestamp(entry.data?.generated_at);
    return Boolean(fixture && validPayload(entry.data, fixture.event_id, fixture.league_code, now) && generated !== null && now - generated < CACHE_MS &&
      cachePeriod(entry.savedAt) === cachePeriod(now) && cachePeriod(generated) === cachePeriod(now));
  }
  function fixtureCapturedAt(fixture) {
    const quotes = [...Object.values(fixture.markets || {}), ...(fixture.bookmakers || []).flatMap(bookmaker => Object.values(bookmaker.markets || {}))];
    const times = quotes.map(quote => timestamp(quote?.collected_at)).filter(value => value !== null);
    return times.length ? new Date(Math.max(...times)).toISOString() : null;
  }
  function name(fixture, side) { return fixture?.[side]?.provider_name || fixture?.[side]?.canonical_name || (side === 'home' ? 'Home team' : 'Away team'); }
  function make(tag, className, value) {
    const element = root.document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = String(value);
    return element;
  }
  function button(label, className, action) { const element = make('button', className, label); element.type = 'button'; element.addEventListener('click', action); return element; }

  function clearTimer() { if (state.timer !== null) root.clearTimeout(state.timer); state.timer = null; }
  function cancelRequest() {
    state.request++;
    state.controller?.abort(); state.controller = null;
    clearTimer();
    if (ui) { ui.refresh.disabled = false; ui.refresh.textContent = 'Refresh prices'; ui.content.removeAttribute('aria-busy'); }
  }
  function close() { if (ui?.dialog.open) ui.dialog.close(); }
  function restoreFocus() {
    const initiating = state.returnFocus; state.returnFocus = null;
    if (initiating?.isConnected && typeof initiating.focus === 'function') { initiating.focus({ preventScroll: true }); return; }
    const analysis = root.document.getElementById('fixtureAnalysis');
    const target = analysis?.open ? analysis.querySelector?.('.fa-close') : root.document.querySelector(`[data-view="${state.fallbackView}"]`);
    target?.focus?.({ preventScroll: true });
  }
  function ensureDialog() {
    if (ui) return ui;
    const dialog = make('dialog', 'captured-prices'); dialog.id = 'capturedPrices';
    dialog.setAttribute('aria-labelledby', 'capturedPricesTitle'); dialog.setAttribute('aria-describedby', 'capturedPricesDescription');
    const header = make('div', 'cp-header'), titleArea = make('div', 'cp-title-area');
    const title = make('h2'); title.id = 'capturedPricesTitle';
    const meta = make('p', 'cp-fixture-meta');
    titleArea.append(make('p', 'cp-eyebrow', 'CAPTURED BOOKMAKER PRICES'), title, meta);
    const closeButton = button('Close', 'cp-close', close); closeButton.setAttribute('aria-label', 'Close captured prices'); closeButton.autofocus = true;
    header.append(titleArea, closeButton);
    const toolbar = make('div', 'cp-toolbar');
    const refresh = button('Refresh prices', 'cp-refresh', () => load(true));
    const status = make('p', 'cp-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    toolbar.append(refresh, status);
    const body = make('div', 'cp-body');
    const description = make('p', 'cp-description', 'Daily price snapshots for this fixture. Bookmaker prices may have changed since capture.'); description.id = 'capturedPricesDescription';
    const content = make('div', 'cp-content'); body.append(description, content);
    dialog.append(header, toolbar, body); root.document.body.appendChild(dialog);
    ui = { dialog, title, meta, closeButton, refresh, status, body, content, snapshotNotes: null };
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    });
    dialog.addEventListener('close', () => {
      cancelRequest(); state.data = null;
      root.document.documentElement.classList.remove('captured-prices-open');
      restoreFocus();
    });
    root.document.addEventListener?.('visibilitychange', () => { if (!root.document.hidden && ui.dialog.open) checkVisibleState(); });
    return ui;
  }
  function setFixtureHeader(fixture) {
    ui.title.textContent = `${name(fixture, 'home')} v ${name(fixture, 'away')}`;
    ui.meta.textContent = `${fixture.league_name || fixture.league_code || 'League'} · ${formatStamp(fixture.kickoff_at)}`;
  }
  function snapshotNotes(data) {
    const fragments = [];
    if (data.collection_status === 'partial') fragments.push('This stored collection is partial; some bookmaker prices may be absent.');
    if (validDate(data.collection_date) && data.collection_date < londonDay(Date.now())) fragments.push(`Earlier collection: ${formatDate(data.collection_date)}. Daily collection starts at 12:00 UK time.`);
    return fragments;
  }
  function updateSnapshotNotes() {
    if (!state.data || !ui.snapshotNotes) return;
    const notes = snapshotNotes(state.data); ui.snapshotNotes.hidden = !notes.length;
    ui.snapshotNotes.replaceChildren(...notes.map(note => make('p', '', note)));
  }
  function provenance(data, fixture = null) {
    const section = make('section', 'cp-provenance'); section.setAttribute('aria-label', 'Stored price provenance');
    const facts = make('dl', 'cp-facts');
    const status = data.collection_status === 'completed' ? 'Complete' : data.collection_status === 'partial' ? 'Partial' : 'No stored collection';
    const rows = [['Collection date', formatDate(data.collection_date)], ['Collection status', status]];
    if (fixture) rows.push(['Fixture last captured', formatStamp(fixtureCapturedAt(fixture))]);
    if (data.collected_at !== null) rows.push(['Collection latest activity', formatStamp(data.collected_at)]);
    rows.push(['View refreshed', formatStamp(data.generated_at)]);
    for (const [label, value] of rows) { const fact = make('div'); fact.append(make('dt', '', label), make('dd', '', value)); facts.appendChild(fact); }
    const notes = make('div', 'cp-snapshot-notes'); ui.snapshotNotes = notes;
    section.append(facts, notes); return section;
  }
  function quoteCard(key, quote) {
    const card = make('article', `cp-quote${state.market === key ? ' cp-quote-context' : ''}`); card.dataset.market = key;
    card.appendChild(make('h4', 'cp-market-label', MARKETS[key]));
    if (state.market === key) card.appendChild(make('span', 'cp-selected-market', 'Screen market'));
    const price = quotePrice(quote);
    card.appendChild(make('strong', `cp-price${price === null ? ' cp-price-missing' : ''}`, price === null ? '—' : price.toFixed(2)));
    card.appendChild(make('p', 'cp-bookmaker', price === null ? 'Not captured' : quote.bookmaker_name || quote.bookmaker_key));
    if (price !== null) {
      card.append(make('p', 'cp-quote-time', `Provider updated ${formatStamp(quote.source_updated_at)}`), make('p', 'cp-quote-time', `Captured ${formatStamp(quote.collected_at)}`));
    }
    return card;
  }
  function comparison(fixture) {
    const section = make('section', 'cp-comparison-section');
    section.append(make('h3', '', 'All captured bookmakers'), make('p', 'cp-section-note', 'Each price shows its provider update and capture time. A dash means that market was not captured.'));
    const scroller = make('div', 'cp-table-scroll'); scroller.tabIndex = 0; scroller.setAttribute('role', 'region'); scroller.setAttribute('aria-label', 'Bookmaker price comparison; scroll horizontally to see all markets');
    const table = make('table', 'cp-comparison');
    table.appendChild(make('caption', 'cp-table-caption', `Captured decimal odds · ${name(fixture, 'home')} v ${name(fixture, 'away')}`));
    const head = make('thead'), header = make('tr');
    for (const label of ['Bookmaker', ...MARKET_KEYS.map(key => MARKETS[key])]) { const cell = make('th', '', label); cell.scope = 'col'; header.appendChild(cell); }
    head.appendChild(header); table.appendChild(head);
    const body = make('tbody');
    const bookmakers = [...fixture.bookmakers].sort((a, b) => String(a.name || a.key).localeCompare(String(b.name || b.key)) || a.key.localeCompare(b.key));
    for (const bookmaker of bookmakers) {
      const row = make('tr'), heading = make('th', '', bookmaker.name || bookmaker.key); heading.scope = 'row'; row.appendChild(heading);
      for (const key of MARKET_KEYS) {
        const quote = bookmaker.markets[key], price = quotePrice(quote), cell = make('td');
        cell.appendChild(make('strong', 'cp-table-price', price === null ? '—' : price.toFixed(2)));
        if (price !== null) cell.append(make('span', 'cp-table-time', `Provider updated ${formatStamp(quote.source_updated_at)}`), make('span', 'cp-table-time', `Captured ${formatStamp(quote.collected_at)}`));
        else cell.appendChild(make('span', 'cp-table-time', 'Not captured'));
        row.appendChild(cell);
      }
      body.appendChild(row);
    }
    if (!bookmakers.length) { const row = make('tr'), cell = make('td', '', 'No bookmaker comparison is stored for this fixture.'); cell.colSpan = 6; row.appendChild(cell); body.appendChild(row); }
    table.appendChild(body); scroller.appendChild(table);
    section.append(scroller, make('p', 'cp-scroll-hint', 'Scroll sideways within the table to compare every market.'));
    return section;
  }
  function showEmpty(data, expired = false) {
    clearTimer(); state.data = data || null; ui.snapshotNotes = null;
    ui.content.replaceChildren();
    if (data) ui.content.appendChild(provenance(data));
    ui.status.textContent = expired ? 'The recorded kickoff time has passed.' : 'No captured prices are available for this fixture.';
    const empty = make('div', 'cp-empty');
    empty.append(make('h3', '', expired ? 'Upcoming prices are no longer shown' : 'No fixture prices in this collection'),
      make('p', '', expired ? 'This fixture’s recorded kickoff time has passed. Refresh prices to check whether its stored schedule has changed.' : 'This fixture is absent from the latest available collection. Refresh prices to check for a newer stored snapshot.'));
    ui.content.appendChild(empty); updateSnapshotNotes();
  }
  function checkVisibleState() {
    clearTimer();
    if (!ui?.dialog.open || !state.data?.fixtures?.length) return;
    const kickoff = timestamp(state.data.fixtures[0].kickoff_at);
    if (kickoff <= Date.now()) { showEmpty(state.data, true); return; }
    updateSnapshotNotes();
    state.timer = root.setTimeout(checkVisibleState, Math.max(1, Math.min(60000, kickoff - Date.now())));
  }
  function render(data) {
    state.data = data; const fixture = data.fixtures[0]; setFixtureHeader(fixture);
    const available = MARKET_KEYS.filter(key => quotePrice(fixture.markets[key]) !== null).length;
    ui.status.textContent = `${available} of 5 markets captured · ${fixture.bookmaker_count} ${fixture.bookmaker_count === 1 ? 'bookmaker' : 'bookmakers'}.`;
    const best = make('section', 'cp-best');
    best.append(make('h3', '', 'Highest captured prices'), make('p', 'cp-section-note', 'The highest stored price for each market in this collection.'));
    if (state.market) best.appendChild(make('p', 'cp-context-note', `Screen market: ${MARKETS[state.market]}. Historical form determines the screen result; these prices are shown for comparison.`));
    const cards = make('div', 'cp-quotes'); for (const key of MARKET_KEYS) cards.appendChild(quoteCard(key, fixture.markets[key])); best.appendChild(cards);
    const collection = provenance(data, fixture);
    ui.content.replaceChildren(ui.snapshotNotes, best, collection, comparison(fixture));
    updateSnapshotNotes(); checkVisibleState();
  }
  async function load(force = false) {
    if (!ui?.dialog.open || !state.fixture) return;
    cancelRequest();
    const request = state.request, eventId = state.fixture.event_id, league = LEAGUES.has(state.fixture.league_code) ? state.fixture.league_code : null;
    const endpoint = state.endpoint, key = JSON.stringify([endpoint, eventId, league]);
    state.data = null; ui.snapshotNotes = null;
    ui.content.replaceChildren(make('p', 'cp-loading', 'Loading the stored bookmaker comparison…'));
    ui.status.textContent = 'Loading captured prices…';
    const cached = cache.get(key);
    if (!force && cacheIsFresh(cached) && validPayload(cached.data, eventId, league)) { render(cached.data); return; }
    cache.delete(key);
    const controller = new AbortController(); state.controller = controller;
    const timeout = root.setTimeout(() => controller.abort(), 20000);
    ui.refresh.disabled = true; ui.refresh.textContent = 'Refreshing…'; ui.content.setAttribute('aria-busy', 'true');
    try {
      const url = new URL(endpoint, root.location?.href); url.searchParams.set('event_id', eventId); url.searchParams.set('days', '31');
      if (league) url.searchParams.set('league', league);
      const response = await root.fetch(url.href, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw Error('prices_unavailable');
      const data = await response.json();
      if (request !== state.request || !ui.dialog.open) return;
      if (!validEnvelope(data, Date.now())) throw Error('invalid_prices');
      if (!data.fixtures.length) { showEmpty(data, timestamp(state.fixture.kickoff_at) !== null && timestamp(state.fixture.kickoff_at) <= Date.now()); return; }
      if (!validFixture(data.fixtures[0], eventId, league)) throw Error('invalid_prices');
      if (timestamp(data.fixtures[0].kickoff_at) <= Date.now()) { setFixtureHeader(data.fixtures[0]); showEmpty(data, true); return; }
      if (!validPayload(data, eventId, league)) throw Error('invalid_prices');
      cache.set(key, { savedAt: Date.now(), data });
      while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
      render(data);
    } catch {
      if (request !== state.request || !ui.dialog.open) return;
      state.data = null; ui.status.textContent = 'Captured prices could not be loaded.';
      const failure = make('div', 'cp-error');
      failure.append(make('p', '', 'Please try again. Your previous screen remains available when you close this panel.'), button('Try again', 'cp-retry', () => load(true)));
      ui.content.replaceChildren(failure);
    } finally {
      root.clearTimeout(timeout);
      if (request === state.request) { state.controller = null; ui.refresh.disabled = false; ui.refresh.textContent = 'Refresh prices'; ui.content.removeAttribute('aria-busy'); }
    }
  }
  async function open(options) {
    if (!options?.fixture || typeof options.fixture.event_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(options.fixture.event_id) || typeof options.endpoint !== 'string' || !options.endpoint) throw Error('A fixture and captured-prices endpoint are required.');
    const dialogUI = ensureDialog(); cancelRequest();
    state.fixture = options.fixture; state.endpoint = options.endpoint; state.market = Object.hasOwn(MARKETS, options.market) ? options.market : null;
    state.returnFocus = options.returnFocus || root.document.activeElement; state.data = null;
    state.fallbackView = root.document.getElementById('view-screening')?.hidden === false ? 'screening' : 'upcoming';
    setFixtureHeader(options.fixture);
    if (!dialogUI.dialog.open) dialogUI.dialog.showModal();
    root.document.documentElement.classList.add('captured-prices-open');
    dialogUI.body.scrollTop = 0; dialogUI.closeButton.focus({ preventScroll: true });
    await load(false);
  }

  root.GerballCapturedPrices = Object.freeze({ open, close, helpers: Object.freeze({ validPayload, cacheIsFresh, londonDay, formatStamp, quotePrice, fixtureCapturedAt }) });
})(typeof window === 'undefined' ? globalThis : window);
