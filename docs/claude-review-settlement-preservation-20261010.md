# Claude review proposal 2: settlement candidate

Development branch only; no production deployment, workflow activation, historical repair or model change.

## Changes

- A shared settlement module rejects empty/duplicate/out-of-range combinations and non-positive/non-integer payouts in both updater and result recovery. Invalid input leaves the record unchanged.
- Removed EV stake reconstruction from updates and settlement. Existing pending purchases are no longer overwritten before close. Winning EV tickets with missing saved unit amounts stay pending instead of assuming 100 yen.
- Cancellation records distinguish official from inferred. Only a valid official result reopens an inferred cancellation; official and legacy cancellations stay unchanged. Prior skipped state, saved time, purchases and amounts survive compaction and recovery; review metadata remains.
- Result recovery validates all stores before fetching, stages writes using the history-preservation helper, and writes nothing when any date fetch fails.
- Bare special/refund flags stay pending. Candidate updater and recovery now verify the official individual result page before ordinary settlement. Confirmed refunds, special payouts and nonstandard results are retained as excluded records with page SHA256, request identity and verification time. The independent outcome report separates ordinary ROI from excluded saved purchases. Do not activate this candidate yet; user-facing exclusion status and wider captured-page coverage remain to implement.

## Validation

The migration safety workflow runs the expanded regression suite. Added tests cover invalid settlement, frozen stakes, idempotency, missing units, inferred/official/legacy cancellation, main updater before/after results, recovery failure with unchanged bytes, recovery persistence and explicit special flags. Existing browser and monetary checks remain enabled.

## Remaining work

- User-facing excluded-results status across all history/results pages and expanded captured-page tests (the special-payout markup test is synthetic). A confirmed exclusion follows the same conservative normal-result cohort as prospective_input; excluded saved investment is not a calculated refund or actual cash balance.
- Read-only official reconciliation of any historical cancellations; no retrospective repairs authorized.
- Proposal 3 provenance and leakage safeguards.
- Multi-file crash recovery and concurrent-writer protection before activating production update candidates (proposal 1 caveats remain).

Candidate code is under `experiments/production-update/`; active production scripts and production repository were not changed.

## Special-result follow-up

- The strict individual-page parser requires matching date/venue/race, complete finisher/refund/payout tables, and consistent ordinary finish order/payout. Unknown structures stay pending with a visible warning. Network failures fail the update before history writes.
- Daily payout-only results are insufficient to identify refunds; both candidate paths now consult the individual page. Daily special-payout markers request this check without fabricating a combination.
- New read-only report: `node experiments/production-update/outcome_summary.mjs DATA_DIR`. Six modes retain separate ordinary investment/payout/ROI and excluded saved-investment evidence.
- Existing settled/cancelled legacy records are not reclassified. Browser files are unchanged; candidates are not deployed or wired to active update workflows.
