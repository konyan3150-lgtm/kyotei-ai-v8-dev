# Claude odds-cap patch review — 2026-10-10 JST

Original supplied patch SHA256: 66e82fceacc29dffb4ebe4eb79fed0dac6088669ce0947bfc03d3467c9ac202c. Reviewed and adapted on migration/stage-live-cutover-20261009 starting from 3636ddc0fd0815e87c5c2caf89492c11c2679399.

## Fixed prospective design

Start: 2026-10-11 00:00 JST (2026-10-10T15:00:00Z). Reference is the unchanged, uncalibrated shadow EV rule: probability x 0.75 x saved odds >= 1.08, up to four tickets, 100 yen each. Alternatives restrict the eligible ticket pool to saved preclose odds strictly below 100 / 50 / 30; eligible replacement tickets may enter. Compare on the same race cohort with actual confirmed normal-result payouts. All skipped races remain visible. Minimum 5 dates and 150 normally settled eligible races unlock descriptive review only, never production adoption.

## Review corrections

The supplied tests passed but accepted malformed probability mass, duplicate combinations, wrong cohort/date and malformed settled results. Added existing auditRecord guards (both distributions and picks), verified JST saved/race/close dates, valid distinct 1-6 winning combination and positive safe-integer payout. Frozen the nested cap array. Added exact start/cap boundaries, skips, invalid evidence and readiness boundaries. Updated collector workflow push paths and migration safety gates.

## Validation

- Supplied tests passed before changes; extended odds-cap tests and nine related JS gate scripts passed after changes.
- Migration history/purchase/money regression suite: 88 passed, 0 failed.
- Read-only replay of current development archives: old records generate no captures and no comparison rows, with unchanged serialized records. Existing saved tickets and money are not rewritten.
- No model retraining, no production files, no historical-data writes.
- A comparison of ROI alone is not a profitability claim. Different caps can spend different amounts; report investment, payout, profit, bought/skipped count and drawdown together. Multiple alternatives and repeated inspection remain exploratory; adoption would need separate future confirmation and user authorization.

## Files

experiments/odds_cap.mjs; experiments/test_odds_cap.mjs; collector wiring; validation page display; development workflow test gates.
