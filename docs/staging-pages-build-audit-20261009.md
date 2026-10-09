# Staging Pages build source audit (2026-10-09)

**Not approved for production deployment.**

The development repository does not track a root `index.html`. Its `.github/workflows/main.yml` builds a `site/` directory by downloading the `dev-prob-calibration` branch ZIP from the **live** repository, then overlays files from this development repository.

**Important:** the current development Pages workflow explicitly checks out `ref: main`, triggers on `main` and a schedule, and uses `actions/deploy-pages@v4`. Running it is not a valid test of the staging branch and could publish the wrong revision. Never invoke it for staging cutover validation.

Before cutover:
1. Build a standalone, non-deploying Pages artifact from the exact migration staging commit, using the pinned upstream source SHA rather than an unpinned branch ZIP.
2. Verify the upstream archive contains `index.html`, and all overlay targets and script injection markers exist. Fail closed if not.
3. Run the existing Playwright `validation-browser.cjs` and `results-browser.cjs` tests against the staged artifact, preserving screenshots and logs.
4. Check live prediction endpoints and all protected history archives read-only.
5. Inspect staging on iPhone Safari and desktop, compare saved V8 and EV bets, settlement and monetary totals, then document approval.
6. Only then design a separate production cutover that preserves live writers, GitHub Pages settings, and rollback.

A successful migration-safety workflow is necessary but **not sufficient** to authorize production cutover.
