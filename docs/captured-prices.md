# Captured prices

Open `https://gerball.co.uk/#screening` and choose **Captured prices** on a fixture. The same action is available inside **Match analysis**, whether that analysis was opened from the Strategy screen or Fixtures & odds.

The dialog follows the exact event ID and league. Closing it restores the originating action and retains the research screen's filters or the analysis dialog's sample and venue. When opened from a strategy card, the selected historical market is carried as context; it never changes the price request or the rule result.

## Prices and timestamps

The dialog shows the highest captured price and its bookmaker for Home, Draw, Away, Over 2.5 and Under 2.5, plus the full captured bookmaker comparison. Missing prices remain unavailable. Highest means the highest stored decimal price within the returned collection; it does not establish availability now.

Each displayed quote retains its provider update time and Gerball capture time, shown in UK time. The fixture's latest capture is derived from its quotes. The endpoint's top-level `collected_at` is the last activity across the complete collection, so it must not be presented as this fixture's capture time. Collection date, partial status and older snapshots remain visible.

All best-price cards and bookmaker rows come from the same response. Historical classification, historical return assumptions, recorded screens and their 1 December 2026 evaluation boundary remain independent of this view.

## Requests and refresh

The client reuses the existing bounded, read-only endpoint:

```text
GET /functions/v1/gerball-upcoming-fixtures?event_id=EVENT_ID&league=LEAGUE&days=31
```

The 31-day horizon supports every fixture horizon offered by the Strategy screen, including fixtures beyond the endpoint's default 14 days. This reads stored prices and does not contact the odds provider or consume a new provider collection.

The response must match the requested event and league, include bookmaker details, and still identify an upcoming fixture. An empty response means that the event is absent from the latest available collection. The interface does not infer that it was cancelled. A fixture whose known kickoff has passed is explicitly identified as started.

The dialog uses a short cache with a five-minute limit. Cached responses expire at kickoff, a change of UK date or a crossing of the daily noon collection time. **Refresh prices** clears the previous comparison while fetching a replacement. Closing the dialog or opening another event cancels the earlier request; a delayed response cannot populate a different event. Failed requests show a recoverable message without exposing server diagnostics.

## Fixtures page freshness

Returning to Fixtures & odds calls the existing workspace's activation method. It keeps valid filters and refreshes after five minutes, on a new UK date, or after crossing UK noon. Concurrent activations reuse the request already in progress. Started fixtures are removed even if a refresh fails.

Expanded bookmaker requests are tied to both collection date and collection activity time. Reloading the list cancels the previous detail requests and clears their cache. A same-day replacement collection cannot mix newer bookmaker rows with older best-price cards; the interface requests a fixture refresh when the versions differ.

## Implementation and verification

- `assets/captured-prices.js` and `.css`: the reusable modal and price presentation.
- `assets/strategy-screen.js` and its bridge: exact-event actions and market context.
- `assets/fixture-analysis.js` and both originating bridges: nested price inspection with retained historical state.
- `assets/upcoming.js` and its bridge: activation freshness and consistent collection versions.

```bash
node scripts/check-site.cjs
node --test scripts/check-captured-prices-ui.mjs scripts/check-upcoming-lifecycle.mjs
node --test scripts/check-upcoming-ui.mjs scripts/check-upcoming-bridge.mjs
node --test scripts/check-strategy-screen-ui.mjs scripts/check-strategy-screen-bridge.mjs scripts/check-fixture-analysis-ui.mjs
node scripts/check-live-strategy-screen.mjs
```

The live check follows an actual screened fixture to its stored comparison and independently reconciles every best price, selected bookmaker and quote timestamp against that response's bookmaker rows. Unit checks exercise missing markets, unsafe text, fixture identity, refresh races, cache boundaries and focus restoration. No database migration, new secret, importer change, collector change or research approval is required for this frontend release.
