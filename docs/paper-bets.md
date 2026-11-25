# Gerball research paper bets and hypothetical unit tracking

Open [Paper bets & P&L](https://gerball.co.uk/#picks).

**Scope:** This first release generates *research-only paper recommendations*. It does not place actual bets, does not assert positive expected value, and does not create an authenticated real-wager ledger. The existing prospective betting strategy remains unapproved. No 1 December prospective record is backfilled.

## Data and model

- Uses only stored match results and the seven-account UK-noon odds collection; the source fixture identities and previously recorded form observations are reused unchanged.
- A fixture must have a frozen historical form observation captured before kickoff, with a same-day bookmaker quote collected at or before that observation.
- The recommendation model draws from up to 20 recent *home* matches for the home team and up to 20 recent *away* matches for the away team from the same league and preceding 730 days. Those results must have been imported by the original observation timestamp.
- The league baseline uses approximately the previous two years of league results imported before the observation. A 20-match pseudo-count shrinks team frequencies toward each league's result frequencies. The five candidate markets are Home win, Draw, Away win, Over 2.5 and Under 2.5.
- At least ten prior venue matches per team and 100 league games are required. Quotes must be in decimal odds 1.40–6.00, captured in the preceding 120 minutes and with an upstream update no older than 24 hours.
- Estimated model edge is `probability × decimal odds − 1`. Model candidates require a nominal edge of 8% or more. **This estimate has not been independently calibrated or shown to beat bookmakers.** A qualifying model candidate is not a verified profitable betting opportunity.
- Only the top-ranked market is displayed per fixture. A fixture without adequate data, sufficiently recent odds or modelled edge receives **No bet** and its reason.
- Illustrative paper stakes range from **1 to 5 units**: 1 unit at 8% nominal edge, and +1 unit per further 6 percentage points, capped at five. These levels do not represent a bankroll recommendation or monetary values.
- Same-game cards, corners, booking and combination bets are **not** suggested because the present captured provider feed contains no verified joint-market price or joint probability model. Multiplying independent prices would be misleading for correlated selections.

## Today's match assessments

The assessments list shows only fixtures whose kickoff is still ahead on the current **Europe/London** calendar day. The calendar-day helper remains separate from this display rule, so earlier fixtures and future fixtures can still be retained in the complete immutable ledger.

While Paper Bets is visible, a local clock check removes cards at kickoff and updates the UK date at midnight, including GMT/BST changes. The display also updates immediately when returning to the panel, restoring a hidden browser tab, focusing the window or restoring the page. Expired cards are removed before a network request completes, including when the saved report cannot be refreshed.

The page refreshes the existing read-only paper report after five minutes while visible and at a UK date change. These requests read already stored data; they do not trigger odds-provider calls, record a bet or change a settlement. Automatic refresh keeps the selected assessment filter, search text and ledger page. Leaving the panel or hiding the tab pauses refresh and cancels obsolete report/search requests. A late response from an obsolete request cannot replace newer results. Manual Refresh starts at page one; Clear restores the unfiltered first page.

Each card shows the age of its captured price separately from the frozen model assessment. The two-hour qualification rule is evaluated at the original observation time. A later clock check does not recalculate the decision, suggested units or hypothetical return. Prices older than two hours are explicitly labelled as saved assessments rather than being presented as newly captured prices. A failed refresh identifies the previously loaded report and keeps its timestamp visible.

## Immutable paper ledger

At 12:35 UK each day, with retry slots at 12:40 and 12:45, the database requires all 18 historical-screen league captures before recording selected paper bets. UK GMT/BST time guard prevents duplicate captures from the two UTC hours. It also rejects any change to the frozen model implementation hash.

Every paper bet stores the bookmaker key, price, selection, suggested units, model probability, estimated edge, quote and record timestamps, original input snapshot hash, league, fixture and kickoff. A uniqueness constraint prevents the same event being counted twice, and an append-only trigger rejects updates and deletes.

Result reconciliation reads the existing imported match-result revision history. It assigns each paper prediction the latest outcome revision from the corresponding saved fixture, without changing the original quoted price or recommended units. **Gross hypothetical paper P&L:** win = `units × (decimal odds − 1)`; loss = `−units`. No partial fills, withdrawals, commissions or account activity are assumed. Unsettled bets count neither profit nor loss. ROI is hypothetical net units divided by settled stake units; no ROI is shown before any bets settle. Maximum drawdown is calculated in kickoff order with a zero start balance.

The public read-only `gerball-paper-bets` endpoint accepts GET only, validates the web application's publishable key, and calls the service-role-only `public.gerball_paper_report` function. All private tables have RLS enabled with no public policies. No secret is exposed in the browser.

**Caveat:** The first bootstrap recording from 24 November was taken approximately four hours after its provider odds capture; its quotes do not pass the two-hour freshness test. The daily capture will begin collecting compliant paper selections when today's provider odds and historical records are available. No historical results are retroactively represented as recommendations.

## P&L records

The page displays lifetime paper net units, number of settled/winning/losing/pending bets, paper ROI when relevant, and maximum drawdown. It also includes a fixture-by-fixture log and multi-page CSV export. These are simulated recommendations, not confirmed real bets; a separately authenticated placement-confirmation workflow would be needed for actual-bet accounting.

## Verification

```sh
node scripts/check-site.cjs
node --check assets/paper-bets.js
node --test scripts/check-paper-bets-lifecycle.mjs
node scripts/check-live-paper-bets.mjs
```

## Finding fixtures and historical paper bets

The Paper bets & P&L page has one search input shared by upcoming match assessments and the recorded paper ledger. Searches are case-insensitive and include team, league, market, bookmaker, status, fixture date and fixture ID where present.

Upcoming assessments filter the current captured preview locally, keeping the existing All matches / Model candidates / No bet selector. Recorded paper bets use the server-side `public.gerball_paper_search` function, so results are searched across the **entire stored ledger**, rather than just the visible 250-row page. Results are paginated and show the total matches.

The search resets paging when the query changes, debounces user typing, cancels stale queries and safely handles no matches and errors. The Clear button restores the full list; the original lifetime P&L dashboard remains an unfiltered lifetime total, not the result of a search. CSV export downloads the matching records when a search is active and all stored records otherwise. No paper predictions, results, P&L totals or captured odds are modified.

The extended read-only Edge Function accepts `?q=...` in addition to the original unfiltered endpoint. User input is limited to 100 characters. No public SQL permissions or write operations were added.

## Performance breakdown

A new read-only group report displays every saved paper selection by market, league, home team, away team, bookmaker and season. Each dimension independently reconciles to the full paper ledger, and shows recommendations, settled, wins/losses, pending, review, settled stake, net hypothetical units and ROI when defined. No result is considered won or lost until the latest imported result revision is settled. This is the entire ledger, not the search filter or the first 250 records.

The `public.gerball_paper_breakdown()` function is a SECURITY INVOKER, executable only by service role. The read-only `gerball-paper-breakdown` Edge Function is GET-only, verifies the website publishable key and rejects inconsistent aggregates. The data feeds the new performance panel in Paper bets & P&L without changing any bets or profit accounting.

Importantly, early samples can have zero settlements: **do not rank a group by ROI or describe it as profitable** if it has no settled matches. Home and away groupings are separate dimensions and cannot be added together.

## Result settlement monitoring and correction safety

The new Settlement monitoring panel shows separate states for upcoming fixtures, recently started fixtures, awaiting hourly reconciliation, awaiting imported match results, manual review and settled wagers. A bet is not treated as lost merely because a result has not been imported. Result monitoring is read-only and uses the existing hourly reconciliation schedule; it does not trigger external sports-data requests.

The hourly reconcile routine previously used revision 1 for every newly appended result, including subsequent score corrections. This has been repaired to append `coalesce(v_revision,0)+1`, so the latest accepted result can supersede earlier outcomes without deleting or overwriting history. The original saved wager, odds and units are immutable. Result changes only affect hypothetical P&L projections.

The panel exposes its report via a service-role-only `public.gerball_paper_settlement_health()` function and a read-only, publishable-key-gated Edge Function. It includes the last successful reconciliation run, last football-data.co.uk import, counts of appended revisions, and up to 40 past-due fixtures with their review reason. A match becomes eligible for reconciliation three hours after kickoff; a pending record older than 48 hours is additionally flagged for investigation. Results still depend on the configured football-data.co.uk import cadence, so an elapsed match does not imply immediately available final scores.

The settlement-health report uses a filtered descending imported_at index on football-data.co.uk matches to avoid scanning the full historic results table when displaying the latest imported match. This fixes a roughly 13-second response that exceeded the Edge Function database timeout; the read-only function now completes in about 0.2 seconds on the current data.

## Today as the default betting record

The Paper Bets page defaults to today's UK kickoff fixtures in **both** the assessment cards and the visible betting record. A Today / Complete history selector lets users review older or future recorded paper positions without mixing them into Today's bets. Today searches and CSV exports are filtered on the database across the entire ledger, not the first 250 rows, using a new read-only `gerball_paper_today` RPC with the same status and settlement mapping as the existing search. The lifetime P&L and grouped performance reports remain **unfiltered** historical totals. UK calendar day is derived with `AT TIME ZONE 'Europe/London'`; GMT/BST boundaries are tested. No original paper bets, prices, stakes, or P&L were modified.

## Quote freshness on today's paper assessments

The Paper Bets screen now displays the source bookmaker update age and the actual capture age alongside each saved pre-kickoff model assessment, and offers an **All price ages / Recent quotes (15m) / Aging saved prices / Old or unverified** filter. "Recent" requires BOTH provider update and collection timestamps to fall within the past 15 minutes. The comparison rejects missing, inconsistent or future timestamps, observations collected after the fixture starts, and prices not in the original saved assessment.

Prices from 15 minutes to 2 hours old are "Aging"; older than 2 hours or delayed provider updates are "Old" (research only). Even a recent captured quote is **not** proof that a bookmaker will still accept the odds, stake or market. No live-executable bet is claimed; all recommendations are historical frozen paper suggestions, not a bet placement. The filter changes only the visible assessments, never saved units, the settlement ledger or lifetime P&L. Ages update using the site's existing active-tab clock, and filters operate on the UK's current kickoff day only.

## Today-first intraday bookmaker comparisons

The already-operational, credit-capped quarterly-hour refresh now prioritizes **today's still-upcoming saved paper bets**, then other fixtures kicking off today, and only then future fixtures. Eligibility begins 7 minutes before kickoff rather than requiring 60 minutes' lead time; its provider identity checks, one event per slot, UK 14:00–20:45 schedule, 28-request cap and 100-credit reserve remain unchanged. These are reads from the same seven established server-side API credentials; there are no new credentials or higher collection frequency.

An isolated, service-role-only SQL function `public.gerball_paper_refreshed_prices()` returns best recent-capture quotes for UK-today upcoming matches across full-time Home/Draw/Away, after excluding Betfair Exchange, Smarkets and Matchbook prices where unmodeled exchange commission could distort comparisons. It uses one **most recent completed run per fixture**, never mixes bookmaker odds from different observation times, validates the event/kickoff identity and source timestamps, and never changes any original model decision, stake, odds or ledger result. A GET-only publishable-key-gated Edge Function `gerball-paper-refreshed-prices` supplies this data to the page without exposing API secrets.

A separate **Intraday bookmaker price comparisons** panel lists captured 1X2 bookmaker quotes from sampled fixtures and marks their age. The assessment cards show the matching latest fixed-odds quote alongside their original frozen bookmaker price. "Recent saved" means both provider update and collection are within 15 minutes, **not proof of an executable bookmaker quote**. If no matching intraday quote exists, the UI says so; for O/U 2.5 it explains this refresh does not cover that market. The panel refreshes its **stored-price view** at most once every five minutes while visible and can be manually refreshed without spending provider API credits; the actual server-side provider collector keeps its existing schedule and quotas.

## Odds movement and original model-edge persistence

The Paper Bets & P&L page includes a read-only `Paper bet odds movement` report. It compares each immutable full-time H/D/A paper recommendation against subsequent **archived best UK fixed-odds bookmaker quotes** from the quota-limited 15-minute sampler. A follow-up only qualifies when its fixture ID, kickoff and outcome are identical, it was captured strictly after the original recommendation, it precedes kickoff, and its source bookmaker timestamp is within 15 minutes of collection. Bets without sampled follow-up odds are counted as **no follow-up**, not as failures or successes. The report includes first sampled price, latest sampled price, quote age, bookmaker identity, any observed original bookmaker price, and how frequently comparison coverage is missing.

The displayed proportional price movement is `(later quoted odds / original quoted odds - 1) × 100%`. The estimated edge at the later quote is `(original model probability × later quoted odds - 1) × 100%`. These are only algebraic projections using the **unchanged original model probability**; they are not a re-run of the predictive model, not settled ROI and not actual bookmaker acceptance. An originally saved Betfair/Smarkets/Matchbook quote may be compared with a *different* fixed-odds bookmaker because exchange commission is excluded from refreshed fixed-odds data. **Cross-bookmaker movement is not closing-line value**, and even a same-bookmaker quote is not a closing price unless captured at closing. The panel discloses limited and nonrandom sample coverage. No new API calls or credit costs arise from opening the report; the collector, immutable paper bet ledger, staking, and settlement remain unchanged.

Server source: `public.gerball_paper_odds_movement()`, SECURITY INVOKER and service-role-only, exposed through a GET-only application-key-validated `gerball-paper-odds-movement` Edge Function. Tests independently reconcile counts and computed edge/direction labels. The page's filter shows all sampled quotes, positive or nonpositive model-edge at later prices, or those with a follow-up from the original bookmaker.

## Quota-neutral follow-up coverage prioritization — 25 November 2026

The existing `gerball_arb_claim` selector now prioritizes saved **full-time 1X2 paper bets with zero valid follow-up quote observations**, before paper fixtures that have already been sampled. The sort order also favors fewer attempted refreshes on the same fixture today, preventing one failing fixture from consuming all the slots. The existing geographic region, provider credentials, single fixture per fifteen-minute slot, 28-request daily cap, daily credit reserve and 100-credit provider quota reserve remain unchanged. All bookmaker quote validation and match identity checking remain unchanged.

The selector considers only saved H/D/A paper bets captured before kickoff because over/under 2.5 and other exotic markets are not available on this 1X2-only sampler. To count a bet as covered, a **completed** run must contain a matching selection with a source timestamp within 15 minutes of collection, a later capture than the paper recommendation, and no unmodeled exchange commission. Repeated observations still remain available for genuine movement research, but are secondary to as-yet-unobserved matches.

The Paper Bet Odds Movement dashboard now shows how many eligible paper bets are still upcoming, how many upcoming have no follow-up, and how many of those are kicking off today. The live database initially showed 131 eligible paper bets, 5 later price comparisons, 129 upcoming and 125 upcoming without follow-up; these figures will change as fixtures advance. No additional provider credits are consumed by the report or new calculations, and no original paper selections, stakes, outcomes or P&L are modified.
