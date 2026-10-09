# V8 development handoff verification — 2026-10-09

Scope: `konyan3150-lgtm/kyotei-ai-v8-dev`, branch `migration/stage-live-cutover-20261009`.
**Development only. User explicitly prohibits live reflection or merge until separately authorized.**
No live repository writes, merges, deployments or updater dispatches were performed in this session.

## Fixes and evidence

- Starting commit: `67b0361da541f665606da40e9947a9398b258c41`.
- Failed run: https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/37934488928
  - `tests/cutover-readiness.test.mjs:27` failed with `SyntaxError: Invalid regular expression flags`.
  - Double escaping also made the permissions matcher incorrect.
- `27ab1bbf61d23201ee0211b4283891227a17e7fb`: corrected regex escaping, keeping nondeployment/pinned-source assertions.
- `b3749aba4f0a8c7524a905d547d7b89ec157ea75`: syntax-check every guard test and execute six existing integrity/refresh checks in migration CI.
- `2685116896466c83b53bea224c4989a84f708062`: verify actual history ROI expression, mode separation, combined-mode investment, profit, and zero-investment boundary.

## Verified on commit 2685116

Migration safety: https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/37935372356 — **success**.
Push run: https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/37935364403 — **success**.

- JavaScript syntax checks and all 30 guard/runtime tests passed, zero failures.
- Prediction integrity, money integrity, value-record state, history venues, record audit and data-refresh checks passed.
- Three frozen-history audit tests passed.
- Frozen snapshot `c97667ed28ba764abf50542c521d507eea166f03`: 2,782 indexed/unique records, all six monetary totals and checksum match the baseline.
- SHA256: `b99196159f93b03303e65e750277fd82dedce9db6737f331266b55f3c9aed00f`.
- Current live index audit, read-only at 2026-10-09 22:14 JST: 2,782 indexed/unique records, two archives, 288 hot records; data timestamp 22:04:12 JST.

The following totals are for the **frozen snapshot**, all-period/all-record scope, with no recommended-only filter.
Stored totals include pending planned stakes; eligible display totals exclude unsettled/skipped/cancelled/zero-stake modes and apply the existing EV version gate. They are different scopes, not data loss.

| Mode | Stored stake | Stored payout | Eligible races | Display investment | Display payout | Display ROI |
|---|---:|---:|---:|---:|---:|---:|
| V8 hit | 1,669,200 | 1,314,890 | 2,777 | 1,666,200 | 1,314,890 | 78.92% |
| V8 balance | 1,669,200 | 1,261,180 | 2,777 | 1,666,200 | 1,261,180 | 75.69% |
| V8 return | 1,669,200 | 1,295,770 | 2,777 | 1,666,200 | 1,295,770 | 77.77% |
| EV hit | 1,996,000 | 1,635,450 | 2,686 | 1,992,000 | 1,635,450 | 82.10% |
| EV balance | 2,462,700 | 2,061,700 | 2,726 | 2,456,900 | 2,061,700 | 83.91% |
| EV return | 2,487,400 | 1,662,880 | 2,723 | 2,481,400 | 1,662,880 | 67.01% |

Amounts are JPY. ROI = payout / eligible investment * 100; rounded here to two decimals, UI uses one decimal.
Each mode has five unsettled records; EV skipped counts are hit 91, balance 51, return 54. Version-excluded/cancelled/zero-stake counts are zero in this snapshot.
This verifies preservation and calculation, not improved predictive performance.

## Refresh and data update checks

- Date validation rejects stale/wrong-day/mixed-day programs.
- Switching days clears stale UI; late responses cannot overwrite the new day.
- Temporary same-day network failure retains previous data.
- Server sync retries are bounded, rejects older responses, retains saved records after failure, and reconnects on foreground/online events.
- Browser server sync interval is 180,000 ms (three minutes). This does not guarantee server-side scheduled jobs run every three minutes.
- Existing live jobs inspected read-only, not invoked:
  - Odds/preview/results fetch and prediction settlement: https://github.com/konyan3150-lgtm/kyotei-ai-v8-live/actions/runs/37934139810 — success.
  - Pending-result reconciliation: https://github.com/konyan3150-lgtm/kyotei-ai-v8-live/actions/runs/37931573181 — success.
- These are sampled job successes; all 12 live workflows and every real-time race were not revalidated.

## Browser verification

https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/37935364522 — **success**, same tested commit.
Pinned upstream UI source: `6c7f1841cb8fc9611a6c6f2dabe2d0135b0a671b`.

- Staging build and static/runtime integrity checks passed.
- Headless Chromium, mobile 390x844 and desktop 1280x900:
  - `validation-browser.cjs`: mode switching, diagnostics, failure preservation/recovery, no JS errors, no horizontal overflow.
  - `results-browser.cjs`: saved ticket display, V8/EV monetary parity, date/mode/status filters, pending/cancellation exclusion, history, failure preservation/recovery.
- Browser tests use intercepted JSON fixtures; read-only production archive audit is separate.
- Artifact ID `11618171375`: `staging-ui-review-2685116896466c83b53bea224c4989a84f708062`, contains staging files and screenshots, expires 2026-10-16.
- Artifact digest: `sha256:8693ed9c052fb206bbd07ab6b3da1342d8bb99f83617e9e680d3ae26b905e4d6`.
- No public preview deployment occurred.

## Inputs inspected, not installed

Attached V8 ZIP: 36 entries, ZIP integrity check clean; Python training/prediction code and serialized models, not a replacement browser deployment tree.
Attached training CSV: 55,301 rows, 2024-04-01 through 2025-03-31, 365 dates; train 41,441, validate 6,862, test 6,998.
The requested GitHub branch remains the authoritative restart point. No retraining or live model replacement was performed.

## Outstanding before a proposed production reflection

- Actual iPhone Safari and home-screen app interaction.
- Existing-device localStorage/history migration and monetary parity with that device's saved records.
- Homepage end-to-end behavior against real live race/model feeds; current browser smoke tests cover results and validation pages.
- Exact current monetary parity immediately before any future switch, and disposition of the five frozen pending records.
- Complete live writer/data-path mapping and verification of all retained update workflows.

Continue in development. Production reflection/merge remains prohibited until the user's explicit permission.
