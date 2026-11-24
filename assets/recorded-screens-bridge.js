(function () {
  'use strict';

  let workspace = null;
  const view = document.getElementById('view-tracking');
  const codes = ['E0', 'E1', 'E2', 'E3', 'SC0', 'D1', 'D2', 'I1', 'I2',
    'SP1', 'SP2', 'F1', 'F2', 'N1', 'B1', 'P1', 'G1', 'T1'];

  function start() {
    if (!workspace && view && window.GerballRecordedScreens) {
      workspace = window.GerballRecordedScreens.init({
        container: document.getElementById('recordedScreens'),
        endpoint: CLOUD_URL + '/functions/v1/gerball-recorded-screens',
        apiKey: CLOUD_KEY,
        leagues: codes.map(code => [code, tableNames[code] || code]),
        initialLeague: 'E0',
      });
    } else if (workspace) workspace.activate();
  }

  window.addEventListener('gerball:viewchange', event => {
    if (event.detail?.view === 'tracking') start();
  });
  if (view && !view.hidden) start();
})();
