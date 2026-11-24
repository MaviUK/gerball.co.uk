(function () {
  'use strict';

  let workspace = null;
  const view = document.getElementById('view-screening');
  const codes = ['E0', 'E1', 'E2', 'E3', 'SC0', 'D1', 'D2', 'I1', 'I2',
    'SP1', 'SP2', 'F1', 'F2', 'N1', 'B1', 'P1', 'G1', 'T1'];

  function openCapturedPrices({ fixture, returnFocus, market }) {
    return window.GerballCapturedPrices.open({
      fixture, returnFocus, market,
      endpoint: CLOUD_URL + '/functions/v1/gerball-upcoming-fixtures',
    });
  }

  function start() {
    if (!workspace && view && window.GerballStrategyScreen) {
      workspace = window.GerballStrategyScreen.init({
        container: document.getElementById('strategyScreen'),
        endpoint: CLOUD_URL + '/functions/v1/gerball-strategy-screen',
        apiKey: CLOUD_KEY,
        leagues: codes.map(code => [code, tableNames[code] || code]),
        initialLeague: 'E0',
        onCapturedPrices: openCapturedPrices,
        onMatchAnalysis: ({ fixture, returnFocus, market }) => window.GerballFixtureAnalysis.open({
          fixture,
          returnFocus,
          endpoint: CLOUD_URL + '/functions/v1/gerball-fixture-analysis',
          onCapturedPrices: destination => openCapturedPrices({ ...destination, market }),
        }),
      });
    } else if (workspace) workspace.activate();
  }

  window.addEventListener('gerball:viewchange', event => {
    if (event.detail?.view === 'screening') start();
  });
  if (view && !view.hidden) start();
})();
