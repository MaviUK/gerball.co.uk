# Gerball extended football odds collection

## Live pilot evidence — 25 November 2026

An authenticated one-fixture probe queried The Odds API event-market discovery and then event-specific odds for Nottingham Forest v Chelsea (27 November 2026). Provider response and stored evidence:
- 20 bookmaker-market availability rows.
- 72 pre-kickoff bookmaker quotes in four markets: 27 half-time/full-time, 9 half-time 3-way, 10 alternate corners and 26 BTTS.
- Total provider credits used: 5. The response reported 495 credits remaining on that day's API key.
- No cards markets returned for the sampled fixture; this is missing market availability, **not zero card odds**.

## Production controls

The original UK-noon league-wide H/D/A and O/U 2.5 collector is unchanged. An isolated `gerball-extra-odds` Edge Function and `gerball_extra_private` database schema capture only event-specific available markets, without changing historical imports, current stored football results, recorded screens or frozen bet strategy versions.

The market discovery request uses `GET /v4/sports/{sport}/events/{eventId}/markets?regions=uk` (1 provider credit) to discover markets by bookmaker. The quote request uses `GET /v4/sports/{sport}/events/{eventId}/odds?regions=uk&markets=...`. The list is intersected with: `halftime_fulltime`, `alternate_totals_cards`, `alternate_totals_corners`, `btts`, `h2h_3_way_h1`, `alternate_team_totals_corners` and `player_to_receive_card` (only when actually supplied by the provider). A maximum of five distinct quoted markets is requested for a single fixture. No artificial combination prices are constructed.

Safety limits: UK region only; up to two existing captured upcoming fixtures a day; a strict ten-credit request budget, including discovery; stop if provider remaining quota drops near reserve; one daily run per UK date; no provider credentials in URLs, logs or public data; private scheduler token and day-specific API key; no public collector write actions. Repeated quotes on a different run (for example, probe versus daily) are preserved with their own capture timestamps rather than silently replacing or ignoring refreshed prices. The run records exact provider-reported credit usage and quota remaining. The Daily cron job runs at **12:50 Europe/London** with both UTC hours covered and a UK-clock gate to handle GMT/BST. A one-time **probe** mode separately records an authenticated availability sample.

Database tables `runs`, `availability` and `quotes` use RLS and lack public policies. The read-only `gerball-extra-market-status` function/Edge Function exposes aggregates and up to 50 recently captured prices through a publishable application key. The website Data & imports page renders market availability and selected prices with timestamps.

**Scope:** This is a credit-limited pilot, not full coverage of 18 leagues or every football fixture. Cards prices are stored only where actually offered by bookmakers. The current paper-bet recommendation model remains unchanged and does not issue cards, half-time/full-time or combination bets until market-specific historical probability and settlement evidence exist.

## Verification

`node scripts/check-live-extra-markets.mjs` checks live evidence, API authentication, pre-kickoff quote timestamps, provider credits and independently verifies the public endpoint. The main GitHub workflow also checks the original collector, recorded screens, and historical backtests.

Provider documentation: https://the-odds-api.com/liveapi/guides/v4/ and https://the-odds-api.com/sports-odds-data/betting-markets.html
