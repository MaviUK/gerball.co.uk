# Captured quote readiness audit
Shows how many frozen recorded rule qualifications have matching bookmaker quotes captured no later than the original observation. The matching key includes provider event ID, league, market, exact kickoff and UK collection date. Captured and provider update timestamps must both predate the saved record.
It does not create predictions, place bets, claim available executable prices, or approve the draft prospective strategy. The SQL RPC is SECURITY INVOKER and callable only by service_role; its server-side Edge Function validates the public application key and exposes GET only.
Access via Gerball → Recorded screens → Captured price readiness.
Current baseline: 24 November 2026, 221 fixture records and 221 qualifying market observations, all 221 with same-day preceding snapshots, none missing. The historical universe and existing jobs are unchanged.
