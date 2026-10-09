# Authorized production cutover — 2026-10-09

The user explicitly instructed “反映して！” after development verification. This supersedes the earlier production prohibition for this cutover.

## Production commits and deployment
- Base: 2bacd6eefe65a1c217fd4899596b3aeba951a6b8.
- Root UI cutover: https://github.com/konyan3150-lgtm/kyotei-ai-v8-live/commit/d19dd778a04a0315b2b392ba9d9435b8b474315c
- Production homepage label: https://github.com/konyan3150-lgtm/kyotei-ai-v8-live/commit/72cb0774106d6bf977f1ba2f11e63a745360a04f
- Pages deployment: https://github.com/konyan3150-lgtm/kyotei-ai-v8-live/actions/runs/37942101885 — completed / success at final production commit.
- First deployment: https://github.com/konyan3150-lgtm/kyotei-ai-v8-live/actions/runs/37941908817 — success.
- Verified public results URL: https://konyan3150-lgtm.github.io/kyotei-ai-v8-live/results.html

## Exact scope
25 root UI files updated/added, zero deletions.
101 existing files outside that scope were confirmed unchanged by Git blob SHA after both commits, including all models, historical/current datasets, the existing dev subtree, scripts and 12 live workflows.
Backup branch: backup/pre-root-ui-cutover-20261009-2304 at the base SHA.
If rollback is required, restore only the UI files from that anchor onto the then-current live head; do not reset newer dataset updates.

The deployed source is the tested development application at 80dca748; server priority fix included.
HTML asset query versions were changed to cutover-20261009 to avoid stale cached scripts.
Results title/header and homepage badge now identify production.
Existing production and new application both use kyotei_v8_dev_result_ storage keys; no prefix migration, clear, or rename was added. Actual user iPhone storage is not accessible to this verification.

## Verification
Before cutover: 31 development guard/runtime tests passed; six integrity checks passed on the actual production candidate; staging/real-feed browser Actions 37940114330 succeeded.
After cutover: actual public homepage loaded today's program and V8 models with aptitude ON, connected to 2,782 server records, and rendered saved tickets. Results link opened successfully.
All-period/all-venue/all-saved totals were inspected for V8 and EV in each of hit/balance/return modes. All six matched the pre-cutover audit:
- V8 hit: investment 1,668,600 / payout 1,316,740 / ROI 78.9%.
- V8 balance: 1,668,600 / 1,263,030 / 75.7%.
- V8 return: 1,668,600 / 1,297,400 / 77.8%.
- EV hit: 1,994,200 / 1,635,450 / 82.0%.
- EV balance: 2,461,600 / 2,061,700 / 83.8%.
- EV return: 2,486,200 / 1,662,880 / 66.9%.

Saved differences, device-only records, and display missing counts were zero in the verification browser in each mode; comparison code 27aaa22eb142ae26 matched server/display.
The server data timestamp remained 22:37:45 JST with one pending record (Wakamatsu 12R); the UI correctly indicated delayed data. This deployment did not manually settle or modify that record.
These observations are timestamped and do not claim actual iPhone Safari/home-screen verification or unchanged future data.
