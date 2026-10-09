# Claude review proposal 2: settlement candidate

Development branch only; no production deployment, workflow activation, historical repair or model change.

## Changes

- A shared settlement module rejects empty/duplicate/out-of-range combinations and non-positive/non-integer payouts in both updater and result recovery. Invalid input leaves the record unchanged.
- Removed EV stake reconstruction from updates and settlement. Existing pending purchases are no longer overwritten before close. Winning EV tickets with missing saved unit amounts stay pending instead of assuming 100 yen.
- Cancellation records distinguish official from inferred. Only a valid official result reopens an inferred cancellation; official and legacy cancellations stay unchanged. Prior skipped state, saved time, purchases and amounts survive compaction and recovery; review metadata remains.
- Result recovery validates all stores before fetching, stages writes using the history-preservation helper, and writes nothing when any date fetch fails.
- Explicit special/refund flags are held pending. This is not a complete special/refund classifier: authoritative per-race detection and a separate excluded-results display/ROI cohort remain to implement. Do not treat proposal 2 as complete or deploy this candidate yet.

## Validation

The migration safety workflow runs the expanded regression suite. Added tests cover invalid settlement, frozen stakes, idempotency, missing units, inferred/official/legacy cancellation, main updater before/after results, recovery failure with unchanged bytes, recovery persistence and explicit special flags. Existing browser and monetary checks remain enabled.

## Remaining work

- Official per-race special/refund classification and an excluded-results audit/display, compared with the prospective cohort.
- Read-only official reconciliation of any historical cancellations; no retrospective repairs authorized.
- Proposal 3 provenance and leakage safeguards.
- Multi-file crash recovery and concurrent-writer protection before activating production update candidates (proposal 1 caveats remain).

Candidate code is under `experiments/production-update/`; active production scripts and production repository were not changed.
