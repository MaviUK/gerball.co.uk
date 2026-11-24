(function () {
  'use strict';

  let workspace = null;
  const dataView = document.getElementById('view-data');
  const overviewView = document.getElementById('view-overview');

  function start() {
    if (!workspace && window.GerballDataStatus) {
      const container = document.getElementById('dataStatus');
      const overviewContainer = document.getElementById('overviewDataStatus');
      if (!container || !overviewContainer) return;
      workspace = window.GerballDataStatus.init({
        container,
        overviewContainer,
        endpoint: CLOUD_URL + '/functions/v1/gerball-data-status',
        apiKey: CLOUD_KEY,
        onOpenData: () => document.querySelector('button.nav-item[data-view="data"]')?.click(),
      });
    } else if (workspace) workspace.activate();
  }

  window.addEventListener('gerball:viewchange', event => {
    if (event.detail?.view === 'overview' || event.detail?.view === 'data') start();
  });
  if ((dataView && !dataView.hidden) || (overviewView && !overviewView.hidden)) start();
})();
