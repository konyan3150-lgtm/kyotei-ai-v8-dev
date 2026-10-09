# Public development review — 2026-10-09

## Scope
Development repository: konyan3150-lgtm/kyotei-ai-v8-dev
Branch: migration/stage-live-cutover-20261009
Production kyotei-ai-v8-live was read only. No production merge, write, or deployment was performed.

## Public review
URL: https://silent-island-1135.hosted.pageshare.ai/
Results: https://silent-island-1135.hosted.pageshare.ai/results.html
Access: public, no login/password.
Expiry: 2026-10-16 13:39 UTC / 22:39 JST.
Published code revision: 1fdc0d00ee15e4f5410a6af34d7a22f66c2108fb.
This is a separate lightweight development preview. Datasets/model are fetched read only from public upstream resources; device storage is isolated from the production origin.

## Fix verified
Public browser testing exposed a pending server prediction being replaced by a newer unsourced/device prediction.
Commit 813d40406f5a930bf7af1ea1b32fcc18567c6f48 gives authoritative server records priority while retaining local-only races.
Commit 1fdc0d00ee15e4f5410a6af34d7a22f66c2108fb adds a regression for the newer-device/pending-server case.

After publishing the fix, the actual public homepage showed Wakamatsu 12R with four saved value tickets, matching the saved audit:
1-3-5 JPY300; 1-3-4 JPY100; 1-2-5 JPY300; 1-4-5 JPY300.
The model loaded successfully, and server sync reported 2,782 races.
The results page opened without authentication. At inspection, the selected 2026-10-09 / V8 / all venues view showed 53 hits / 143 races, JPY85,800 invested, JPY73,770 returned, and 86.0% recovery.
These are observations of changing live data, not fixed expected totals.

## Evidence
Local checks: 30 automated tests passed, plus prediction-integrity and data-refresh checks.
GitHub Actions at revision 1fdc0d0:
- https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/37938912415 — migration safety, success.
- https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/37938908704 — Build staging UI artifact (no deploy), success; fixture browser and real-data homepage checks for full and lightweight staging.

## Review before any production approval
On iPhone Safari, open the public review and production with the same date range, mode and venue filters; compare saved tickets, investment, return and recovery.
The earlier root UI proposal's server-sync.js digest predates this fix and must be regenerated against the final revision before any production cutover.
Production authorization remains outstanding.
