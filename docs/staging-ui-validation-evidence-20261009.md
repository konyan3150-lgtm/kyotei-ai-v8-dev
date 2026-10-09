# Staging UI validation evidence (2026-10-09)

- Staging commit: `aece224be1755f16d64efd93bbbff57e43a558ec`.
- Read-only staging workflow run: https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/37933733420
- Run conclusion: **success**. Pinned upstream UI download, overlay, static/runtime checks, headless Chromium smoke tests, and artifact upload completed.
- Artifact: `staging-ui-review-aece224be1755f16d64efd93bbbff57e43a558ec` (GitHub Actions artifact ID `11617332571`, approximately 16.8 MB, available at time of audit). Includes `site/` and any generated `ui-screenshots/`; artifacts expire.
- Migration safety workflow for same commit: https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/37933739605 — success.

**Not yet verified:** actual iPhone Safari interaction, production Pages routing, browser localStorage migration on an existing user's device, all 12 live update jobs after cutover, and end-to-end comparison of current production monetary totals immediately before switch. No public staging URL was deployed, and no production cutover occurred.

**Decision: HOLD PRODUCTION.** Passing automated browser tests is necessary but not sufficient. Review the generated artifact and screenshots, then run real-device and live endpoint parity checks without writing to live.
