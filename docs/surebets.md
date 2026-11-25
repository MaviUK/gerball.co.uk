# Surebet scanner

Open [Surebets](https://gerball.co.uk/#surebets).

This view compares the best *captured* bookmaker odds for the same event, kickoff and precisely matching market/outcome set. It calculates reciprocal implied probability, allocates a user-selected total stake by inverse decimal odds, rounds stakes to pence, and calculates the **minimum** possible payout across outcomes after rounding. It only displays a mathematically profitable combination when this minimum payout exceeds the total allocated stake. This is not a proof of executable profit.

Markets: 1X2 full-time H/D/A, 1st-half 3-way H/D/A, halftime/fulltime all nine H/H..A/A, both-teams-to-score Yes/No, Over/Under 2.5 goals, and half-integer total corners or total cards where the same line is available for both sides. The market scanner excludes player/team card markets, mismatched descriptions and lines, and markets with missing outcomes. Market event IDs and kickoff must agree. At least two distinct bookmakers must appear across the selected outcomes. Fees and void/settlement differences are not assumed away.

Main daily odds and the isolated extended-market collector remain unchanged. An isolated `public.gerball_surebet_feed()` read-only security-invoker RPC merges their recent stored snapshots, excludes exchange prices (Betfair Exchange, Smarkets and Matchbook) because their commissions are not represented, and picks the best bookmaker quote for each outcome. It accepts only quotes with plausible timestamps and recent provider updates. The Edge Function `gerball-surebets` exposes this data read-only after a publishable application-key check; the SQL routine is executable only by service role.

The browser requires prices used together to have capture timestamps within 2 minutes of one another. **Fresh** means captured within 15 minutes and provider-updated within 15 minutes. Older *theoretical* opportunities from the previous 24 hours, if any, appear in a separate section clearly labelled not actionable. Expired/kicked-off fixtures never qualify. The margin is unadjusted for bookmaker stake limits or bookmaker-specific void rules; quotes are neither guaranteed nor executable until manually reconfirmed with each bookmaker.

The minimum returns are calculated after stake rounding, and the form recalculates for a custom total stake. No bet is placed, and the P&L record does not automatically treat a projected arb as a placed wager.

## Live finding

As of 25 November 2026, the archived league-wide 1X2 odds covered 240 complete future fixtures. Excluding exchanges, **none** produced a theoretical margin below 100% at the snapshot. This is not a claim that no live arbitrage will ever occur. Our current noon collection cadence means a late-day visit usually shows no **fresh** surebet because the captured odds have aged.

The next improvement should increase provider collection frequency, after reviewing quota and supplier terms, and require bookmaker-side confirmation before presenting a candidate as executable.

## Verification

`node scripts/check-live-surebets.cjs` covers 3-way and 9-way completeness, 2-way totals, distinct bookmakers, line matching, stale and mixed snapshots, penny-stake allocation, positive worst-case return, authenticated endpoint, and exchange exclusion.
