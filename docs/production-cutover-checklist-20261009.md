# V8 production cutover safety checklist (2026-10-09)

Status: **STAGING ONLY — NO LIVE CUTOVER AUTHORIZED BY THIS FILE**

## Frozen rollback anchor
- Live repository: `konyan3150-lgtm/kyotei-ai-v8-live`
- Rollback branch: `backup/pre-dev-migration-20261009`
- This is a Git snapshot, **not** a backup of browser localStorage, Actions secrets, Pages settings, or external services.

## Critical integration constraint
- Development `overrides/server-sync.js` explicitly fetches `https://raw.githubusercontent.com/konyan3150-lgtm/kyotei-ai-v8-live/main/dev/server-predictions.json`.
- **Do not remove or rename this endpoint** while migrating. Replacing live `main` wholesale with development files would break the saved-record source and could make results appear missing.
- Dev and live repositories have different directory layouts. A byte-for-byte overwrite is not a safe deployment plan.

## Live data that must survive, with byte-level checks
- `dev/server-predictions.json`
- `dev/server-predictions-index.json`
- `dev/server-predictions-archive/202609.json`
- `dev/server-predictions-archive/202610.json`
- `dev/official-results.json`
- `dev/racer-aptitude.json` and `dev/racer-aptitude-runtime.json.gz`
- `dev/course-stats.json`, `dev/odds.json`, `dev/tomorrow.json`
- Root-level equivalents and experimental evaluation artifacts where applicable.
- Preserve existing settlement/update workflows until replacements are proven to run.

## Required pre-cutover checks
1. Record the live `main` commit and compare to the rollback branch.
2. Inventory every live-only data file and scheduled updater; map each to its new path/owner.
3. Build a **staging** Pages artifact using development UI and the unchanged live prediction endpoint.
4. Verify live prediction JSON schema, history archive/index resolution, V8/EV mode isolation, investments and payouts against existing history; fail closed on missing records.
5. Verify refresh cadence and settlement jobs in the replacement deployment, without writing to the production dataset during staging.
6. Ensure the dev-only `kyotei_v8_dev_result_` localStorage prefix has an explicit migration strategy; do not silently overwrite user browser history.
7. Confirm GitHub Pages routing, entrypoint and permissions before switching the public URL.
8. Perform cutover only after passing checks, retain rollback branch, and compare post-cutover totals against pre-cutover totals.

## Stop conditions
- Any missing historical record, altered investment/payout total, unexpected destructive diff, failed checks, or unknown data writer.
- On failure, leave production unchanged; restore from the pinned rollback branch only after assessing any newer production records.
