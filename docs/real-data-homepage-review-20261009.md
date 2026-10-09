# Real-data homepage and review preparation — 2026-10-09

**Development only. No writes, merge, deployment, or workflow dispatch to kyotei-ai-v8-live.**

## GitHub evidence

- `dfdef7a`: added `tests/homepage-live-browser.cjs`.
- `b24b99e`: run staged homepage against real feeds.
- `f234076`: add lightweight review site builder.
- `d5b01f17d36f8c3acb9d2b67ba44f54e44f70fe0`: verify both full staging homepage and lightweight review packaging.
- Staging run https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/37937361642 — **success**.
- Safety runs https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/37937364660 and https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/37937361681 — **success**.

Real-network homepage checks passed for both full staging and lightweight review:
today's race program, three model ranks, saved server records, saved race samples (up to three), V8/EV hit/balance/return isolation, authoritative tickets/stakes/payouts, six racers, mobile/desktop rendering, no horizontal overflow, today/tomorrow switching, no JavaScript page errors.
Tests use temporary isolated browser storage; this does not verify the user's existing iPhone storage.
Existing validation/results fixture browser tests passed too.

Artifact `11617784717`: `staging-ui-review-d5b01f17d36f8c3acb9d2b67ba44f54e44f70fe0`, includes site, lightweight review directory, screenshots and homepage-live-report.json; expires 2026-10-16.
Digest `sha256:b061ad175e773e9bc356c7b477ca1961f208e7aaf77ca8bdd42c3c1730de8b89`.

## Production preservation proposal (not applied)

`docs/root-ui-cutover-proposal-20261009.json`, committed as `ae2d1a4`, defines **25 root UI file updates/additions, 101 protected files, zero deletions** against live snapshot `70f5ae01805149827b0d86271a02c68814656055`.
All live datasets, model, existing dev subtree, updater scripts and 12 workflows are preserved.
Server prediction generation is standalone and does not import the replaced UI scripts; sampled source audit found no UI-to-writer file dependency.
This is a root UI migration proposal, not permission to replace the whole live repository or proof of all future live behavior.
The live snapshot must be refreshed before any authorized implementation: scheduled writers keep changing main.

Local self-tests against the read-only extracted live snapshot passed:
- `node scripts/update_server_predictions.mjs --self-test`: prediction settlement and expert self-tests.
- `node scripts/test_pending_results.mjs`: pending recovery, immutable prediction fields, date validation and idempotency; only temporary test data written.

## Data-update limitation identified

Live `update-live-odds.yml` uses `*/10 0-12,22-23 * * *` (UTC), and prediction generation and settlement steps have `continue-on-error: true`.
Browser sync is every three minutes. Those are different cadences.
A green whole update workflow alone does not prove every prediction/result step succeeded; verify individual steps and data timestamps.
No cadence or failure-policy change was made to production.

## Monetary comparison example (snapshot, not a live quote)

Snapshot `70f5ae0`, all-period/all-venue/all-saved-prediction scope, display-eligible settled records:

| View/mode | Races | Investment JPY | Payout JPY | ROI |
|---|---:|---:|---:|---:|
| V8 hit | 2,780 | 1,668,000 | 1,316,350 | 78.92% |
| V8 balance | 2,780 | 1,668,000 | 1,262,640 | 75.70% |
| V8 return | 2,780 | 1,668,000 | 1,297,400 | 77.78% |
| EV hit | 2,689 | 1,993,500 | 1,635,450 | 82.04% |
| EV balance | 2,729 | 2,460,400 | 2,061,700 | 83.80% |
| EV return | 2,726 | 2,485,000 | 1,662,880 | 66.92% |

2,782 unique records remain. At this later snapshot only Wakamat​su (20) 11R/12R are unsettled; the earlier frozen baseline had five. Scheduled settlement changed live data independently of this development work.
The figures above are snapshot references, not numbers that a later opening must still show.

## Review hosting limitation

Existing PageShare development site: `site_d8bf956a64c4458cb4ca31cdf5fe25f5`, original public access retained.
Prepared version `ver_7c69ddfec69c43d4b71e533df229a4b9` contains 36 static files; all data remain read-only GitHub requests and the model is pinned to tested upstream `6c7f1841`.
The site was already expired/suspended since September. Replacing content does not reset expiry; extending expiry is unavailable under the Free plan.
A five-minute version preview was issued, but opening it in the browser redirected to PageShare sign-in. Therefore the old URL and this preview are **not verified as a freely accessible iPhone review link**.
Do not claim the normal old URL has been restored. Do not upgrade the account or create a new public site without the required explicit access choice.

## iPhone comparison once an accessible review link is available

1. Safari: open current production and the separate review; do not clear history or import/overwrite storage.
2. On results, use the same period, venue, prediction view, hit/balance/return mode and all-saved/recommended scope.
3. Open the saved-data monetary audit; wait for full history to show loaded; compare server/visible counts, investment, payout, missing records and audit codes at similar update timestamps.
4. Compare saved tickets for the same completed race in V8 and EV separately.
5. Repeat from the existing production home-screen app.
6. Report differing figures and screenshots. A new review origin cannot read or migrate the existing production origin's localStorage.

Next: provide an accessible separate review URL after an explicit hosting access choice; complete actual iPhone verification; keep live reflection/merge prohibited until separately authorized.
