# Production workflow and data inventory (2026-10-09)

**Inventory only. No production changes authorized.** Live `main` tree was inspected read-only; 112 tracked blobs, tree not truncated.

## Production workflows (must retain or explicitly replace)
- `.github/workflows/pages.yml` — public Pages publication
- `.github/workflows/deploy-v153-from-zip.yml` — historical deployment path
- `.github/workflows/settle-pending-results.yml` — result settlement
- `.github/workflows/update-live-odds.yml` — odds refresh
- `.github/workflows/update-course-stats.yml` — course statistics
- `.github/workflows/update-tomorrow.yml` — tomorrow data
- `.github/workflows/update-racer-aptitude-daily.yml` — daily racer aptitude
- `.github/workflows/backfill-racer-aptitude.yml` — aptitude backfill
- `.github/workflows/aptitude-ab-validation.yml` — A/B checks
- `.github/workflows/aptitude-walkforward-validation.yml` — walk-forward checks
- `.github/workflows/confidence-concentration-validation.yml` — confidence validation
- `.github/workflows/purchase-threshold-validation.yml` — purchase threshold validation

## Protected live datasets
- `dev/server-predictions.json`
- `dev/server-predictions-index.json`
- `dev/server-predictions-archive/202609.json`
- `dev/server-predictions-archive/202610.json`
- `dev/official-results.json`
- `dev/odds.json`, `dev/tomorrow.json`
- `dev/course-stats.json`, `dev/course-stats-runtime.json`
- `dev/racer-aptitude.json`, `dev/racer-aptitude-runtime.json.gz`
- Root equivalents: `odds.json`, `tomorrow.json`, `course-stats.json`, `racer-aptitude.json`.

## Migration gate
Do not replace live main with dev tree. Preserve all 12 workflows unless a separately validated replacement exists. Compare all protected datasets and the historical checksum before and after a proposed cutover. Browser localStorage, secrets, and Pages settings need separate backup/verification and cannot be restored by a Git branch alone. Build and inspect a staging Pages deployment and test live endpoint availability before any production switch.
