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
node scripts/check-live-paper-bets.mjs
```
