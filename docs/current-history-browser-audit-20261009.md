# Additional history and public-browser verification — 2026-10-09

Development only: migration/stage-live-cutover-20261009 in konyan3150-lgtm/kyotei-ai-v8-dev.
No production repository writes, merges, deployments, or updater dispatches were performed.

## Change
1515a15993faefc16c332b00ceb916043e778f38 resolves production main once to a validated 40-character SHA before fetching current history. All index, hot records and archives now use that immutable revision, avoiding mixed snapshots if production updates during CI.
The current stored totals, display eligibility totals and exact source SHA are retained together in current-live-history-audit.
a8efe00b414d48716d3cb9f9108017753a78c4be adds a regression guard for this invariant.

## Checks
- Local runtime/guard suite: 31 tests passed, zero failures.
- Six integrity/refresh checks passed.
- Current snapshot index audit plus three history audit tests passed.
- Safety Actions: https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/37940116136 — success on a8efe00.
- Full and lightweight staging browser checks: https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/37940114330 — build-staging job 113852038931 completed successfully, including real feeds.
- Current audit artifact ID 11620931894; digest sha256:9f0e36da87bc8f854595d21d7e465e2a31a67dc0071f21a9baa766f310a00cb4.

## Public browser against current read-only data
https://silent-island-1135.hosted.pageshare.ai/results.html
Published application code remains 1fdc0d0; the new changes concern CI and tests.
Observed server timestamp: 2026-10-09 22:37:45 JST.
Independent local source snapshot: production main 2bacd6eefe65a1c217fd4899596b3aeba951a6b8.
2,782 unique/indexed records, two archives, 288 hot records.
Filters: all periods / all venues / all saved predictions.
All six views matched independently computed eligible stakes and payouts. The public audit showed saved-record differences 0, device-only 0, display missing 0 for each mode; server/display monetary totals agreed.

| View | Mode | Settled eligible races | Investment JPY | Return JPY | Display ROI |
|---|---|---:|---:|---:|---:|
| V8 | Hit | 2781 | 1668600 | 1316740 | 78.9% |
| V8 | Balance | 2781 | 1668600 | 1263030 | 75.7% |
| V8 | Return | 2781 | 1668600 | 1297400 | 77.8% |
| Value | Hit | 2690 | 1994200 | 1635450 | 82.0% |
| Value | Balance | 2730 | 2461600 | 2061700 | 83.8% |
| Value | Return | 2727 | 2486200 | 1662880 | 66.9% |

Each mode had one pending record: kyotei_v8_dev_result_20261009_20_12 (Wakamatsu 12R).
It is excluded from settled monetary totals. No manual settlement was performed.
Value skips: hit 91, balance 51, return 54. No invalid monetary fields or conflicting archive duplicate records were found.

These figures describe the inspected timestamp; public data can update.
Actual iPhone Safari/home-screen testing and comparison with that device's existing saved records remain outstanding.
No production authorization has been granted.
