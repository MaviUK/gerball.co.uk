-- Run after the same-day uniqueness migration. This copies the deployed table's
-- indexes and checks, then exercises them only on a temporary table. LIKE does
-- not copy foreign keys or triggers; no production inserts or sequence calls
-- are made. Every synthetic row and temporary object is rolled back.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';
SET LOCAL plpgsql.check_asserts = on;

CREATE TEMP TABLE gerball_paper_insert_verification
  (LIKE gerball_advice_private.paper_bets INCLUDING ALL)
  ON COMMIT DROP;

INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
SELECT * FROM gerball_advice_private.paper_bets;

DO $verify$
DECLARE
  sample pg_temp.gerball_paper_insert_verification%ROWTYPE;
  candidate pg_temp.gerball_paper_insert_verification%ROWTYPE;
  rejected boolean;
BEGIN
  SELECT * INTO STRICT sample
  FROM pg_temp.gerball_paper_insert_verification ORDER BY id LIMIT 1;

  ASSERT (
    SELECT count(*) = 2 FROM pg_index
    WHERE indrelid = 'pg_temp.gerball_paper_insert_verification'::regclass
      AND indisunique AND indpred IS NOT NULL
  ), 'Expected the two deployed same-day partial unique indexes';

  -- A preserved advance recommendation and a fresh match-day recommendation
  -- can coexist for exactly the same provider and canonical fixture identities.
  sample.id := -9001;
  sample.observation_id := -9001;
  sample.event_id := 'verification-preserved-advance';
  sample.league_code := 'E0';
  sample.season := '2627';
  sample.home_team := 'Verification Home';
  sample.away_team := 'Verification Away';
  sample.fixture_date := DATE '2026-11-27';
  sample.kickoff_at := TIMESTAMPTZ '2026-11-27 19:00:00+00';
  sample.recorded_at := TIMESTAMPTZ '2026-11-25 12:35:00+00';
  INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
  SELECT (sample).*;

  candidate := sample;
  candidate.id := -9002;
  candidate.observation_id := -9002;
  candidate.recorded_at := TIMESTAMPTZ '2026-11-27 12:35:00+00';
  INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
  SELECT (candidate).*;
  ASSERT (
    SELECT count(*) = 2 FROM pg_temp.gerball_paper_insert_verification
    WHERE event_id = sample.event_id
  ), 'An excluded advance row blocked a new match-day recommendation';

  -- Alter the canonical identity so only the event identity can reject this.
  candidate.id := -9003;
  candidate.observation_id := -9003;
  candidate.home_team := 'Changed Verification Home';
  candidate.away_team := 'Changed Verification Away';
  rejected := false;
  BEGIN
    INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
    SELECT (candidate).*;
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  ASSERT rejected, 'A second match-day recommendation for one event was accepted';

  -- Alter the provider ID so only the canonical-fixture identity rejects this.
  candidate := sample;
  candidate.id := -9004;
  candidate.observation_id := -9004;
  candidate.event_id := 'verification-renamed-provider-event';
  candidate.recorded_at := TIMESTAMPTZ '2026-11-27 12:40:00+00';
  rejected := false;
  BEGIN
    INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
    SELECT (candidate).*;
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  ASSERT rejected, 'One canonical match acquired two match-day recommendations';

  -- Distinct event and canonical identities must still respect observation ID.
  candidate.id := -9005;
  candidate.observation_id := -9002;
  candidate.event_id := 'verification-observation-reuse';
  candidate.home_team := 'Observation Verification Home';
  candidate.away_team := 'Observation Verification Away';
  rejected := false;
  BEGIN
    INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
    SELECT (candidate).*;
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  ASSERT rejected, 'The observation uniqueness guard was lost';

  -- BST: the recording and kickoff are on different UTC days but the same
  -- Europe/London day. The first recording must participate in uniqueness.
  candidate := sample;
  candidate.id := -9010;
  candidate.observation_id := -9010;
  candidate.event_id := 'verification-bst-same-uk-day';
  candidate.home_team := 'BST Same Day Home';
  candidate.away_team := 'BST Same Day Away';
  candidate.fixture_date := DATE '2026-07-01';
  candidate.recorded_at := TIMESTAMPTZ '2026-06-30 23:35:00+00';
  candidate.kickoff_at := TIMESTAMPTZ '2026-07-01 00:20:00+00';
  INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
  SELECT (candidate).*;
  candidate.id := -9011;
  candidate.observation_id := -9011;
  candidate.recorded_at := TIMESTAMPTZ '2026-07-01 00:00:00+00';
  rejected := false;
  BEGIN
    INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
    SELECT (candidate).*;
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  ASSERT rejected, 'BST uniqueness incorrectly follows UTC dates';

  -- BST: both timestamps are on the same UTC day but different UK days. The
  -- advance row must not block a valid recommendation after UK midnight.
  candidate := sample;
  candidate.id := -9020;
  candidate.observation_id := -9020;
  candidate.event_id := 'verification-bst-different-uk-days';
  candidate.home_team := 'BST Midnight Home';
  candidate.away_team := 'BST Midnight Away';
  candidate.fixture_date := DATE '2026-07-02';
  candidate.recorded_at := TIMESTAMPTZ '2026-07-01 12:35:00+00';
  candidate.kickoff_at := TIMESTAMPTZ '2026-07-01 23:30:00+00';
  INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
  SELECT (candidate).*;
  candidate.id := -9021;
  candidate.observation_id := -9021;
  candidate.recorded_at := TIMESTAMPTZ '2026-07-01 23:10:00+00';
  INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
  SELECT (candidate).*;
  ASSERT (
    SELECT count(*) = 2 FROM pg_temp.gerball_paper_insert_verification
    WHERE event_id = candidate.event_id
  ), 'BST advance row incorrectly blocked the next UK day';

  -- GMT: UTC and UK midnight coincide. Preserve the previous-day record while
  -- permitting one (and only one) record after midnight on the kickoff date.
  candidate := sample;
  candidate.id := -9030;
  candidate.observation_id := -9030;
  candidate.event_id := 'verification-gmt-midnight';
  candidate.home_team := 'GMT Midnight Home';
  candidate.away_team := 'GMT Midnight Away';
  candidate.fixture_date := DATE '2026-12-02';
  candidate.recorded_at := TIMESTAMPTZ '2026-12-01 23:35:00+00';
  candidate.kickoff_at := TIMESTAMPTZ '2026-12-02 00:30:00+00';
  INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
  SELECT (candidate).*;
  candidate.id := -9031;
  candidate.observation_id := -9031;
  candidate.recorded_at := TIMESTAMPTZ '2026-12-02 00:10:00+00';
  INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
  SELECT (candidate).*;
  candidate.id := -9032;
  candidate.observation_id := -9032;
  candidate.recorded_at := TIMESTAMPTZ '2026-12-02 00:11:00+00';
  rejected := false;
  BEGIN
    INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
    SELECT (candidate).*;
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  ASSERT rejected, 'A duplicate GMT match-day recommendation was accepted';

  -- The autumn clock repeat still falls on one UK calendar day.
  candidate := sample;
  candidate.id := -9040;
  candidate.observation_id := -9040;
  candidate.event_id := 'verification-bst-gmt-clock-change';
  candidate.home_team := 'Clock Change Home';
  candidate.away_team := 'Clock Change Away';
  candidate.fixture_date := DATE '2026-10-25';
  candidate.recorded_at := TIMESTAMPTZ '2026-10-25 00:35:00+00';
  candidate.kickoff_at := TIMESTAMPTZ '2026-10-25 19:00:00+00';
  INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
  SELECT (candidate).*;
  candidate.id := -9041;
  candidate.observation_id := -9041;
  candidate.recorded_at := TIMESTAMPTZ '2026-10-25 01:35:00+00';
  rejected := false;
  BEGIN
    INSERT INTO pg_temp.gerball_paper_insert_verification OVERRIDING SYSTEM VALUE
    SELECT (candidate).*;
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  ASSERT rejected, 'The repeated autumn hour allowed a duplicate recommendation';
END
$verify$;

SELECT 'Verified advance-row coexistence, event/canonical/observation uniqueness, BST/GMT midnight and autumn clock change using a temporary copy only.' AS verification;
ROLLBACK;
