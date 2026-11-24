(function () {
  'use strict';

  let workspace = null;
  const view = document.getElementById('view-upcoming');

  async function openHistoricalTeam({ canonicalName, leagueCode, kickoffAt, fixture, side }) {
    const country = Object.keys(tableCountries).find(name => tableCountries[name].includes(leagueCode));
    const kickoff = new Date(kickoffAt);
    if (!country || !canonicalName || !Number.isFinite(kickoff.getTime())) {
      throw new Error('Team history is unavailable.');
    }
    const londonDay = date => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(date).map(part => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    };
    const fixtureDay = londonDay(kickoff);
    const previousDay = new Date(fixtureDay + 'T00:00:00Z');
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const cutoff = [previousDay.toISOString().slice(0, 10), londonDay(new Date())].sort()[0];
    const year = Number(fixtureDay.slice(0, 4)) - (Number(fixtureDay.slice(5, 7)) < 7 ? 1 : 0);
    const season = fixture?.[side]?.stats?.season ||
      String(year % 100).padStart(2, '0') + String((year + 1) % 100).padStart(2, '0');

    document.querySelector('[data-view="tables"]').click();
    document.getElementById('tableCountry').value = country;
    tableOptions('tableLeague', tableCountries[country].map(code => [code, tableNames[code] || code]));
    document.getElementById('tableLeague').value = leagueCode;
    const seasonSelect = document.getElementById('tableSeason');
    if (![...seasonSelect.options].some(option => option.value === season)) {
      const option = document.createElement('option');
      option.value = season;
      option.textContent = `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
      seasonSelect.prepend(option);
    }
    seasonSelect.value = season;
    document.getElementById('tableDate').value = cutoff;
    document.getElementById('tableType').value = 'both';
    document.getElementById('tableForm').value = '5';

    let back = document.getElementById('teamUpcomingBack');
    if (!back) {
      back = document.createElement('button');
      back.id = 'teamUpcomingBack';
      back.type = 'button';
      back.className = 'secondary';
      back.textContent = '← Upcoming fixtures';
      back.addEventListener('click', () => {
        closeTeamProfile();
        document.querySelector('[data-view="upcoming"]').click();
      });
      document.getElementById('teamBack').parentElement.appendChild(back);
    }
    await Promise.all([renderLeagueTable(), openTeamProfile(canonicalName)]);
  }

  function start() {
    if (!workspace && view && window.GerballUpcoming) {
      workspace = window.GerballUpcoming.init({
        endpoint: CLOUD_URL + '/functions/v1/gerball-upcoming-fixtures',
        onTeamOpen: openHistoricalTeam,
      });
    }
  }

  window.addEventListener('gerball:viewchange', event => {
    if (event.detail?.view === 'upcoming') start();
  });
  if (view && !view.hidden) start();
})();
