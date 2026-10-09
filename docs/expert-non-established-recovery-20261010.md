# Expert non-established trifecta recovery — 2026-10-10 JST

Scope: development Expert shadow only. Production repository, models and production histories are unchanged.

## Evidence

Latest inspected development source: `09040d8e7f464fa8421db080c8b44576cb1c5cf7`.
The pending key `20261008_14_5` repeatedly failed with `invalid_payout`.
Official URL: https://www.boatrace.jp/owpc/pc/race/raceresult?rno=5&jcd=14&hd=20261008
The official trifecta table says 不成立 with 100 yen per 100-yen ticket. Six finishers include abnormal finishes; the race is unsuitable for the paired normal-finish cohort.
Full retrieved HTML SHA256: `fcf16afb51c5679af1fbc877b6b0f05d7af56c35d3c20bb73422144ee0d846fe`.
The committed fixture retains only official navigation and relevant finish/refund/trifecta tables.

## Change

Recognize this exact non-established label and refund amount only with independently parsed abnormal-finisher/refund evidence. Retain explicit `trifecta_status` and use the existing confirmed-special exclusion path. Empty, unknown, malformed and unsupported special payout labels still fail closed. This does not award hits or alter saved tickets.

## Verification

- Seven existing/extended JS gate scripts pass: official parser, prospective provenance, exhibition health, Expert shadow, realtime snapshots, shadow diagnostics and preclose variants.
- Migration regression suite: 88 passed, 0 failed.
- Replay over all 833 records in eight source archives: settled 771 unchanged; pending 3 -> 2; excluded 59 -> 60. The two remaining records were current-day pending at the snapshot.
- Saved record keys, input snapshots and every pre-existing field except the resolved record's fetch error remain identical. No replay archive is committed.
- Paired arms exactly unchanged: baseline 292 hits, 462600 investment, 396820 payout, ROI 85.7803718%; candidate 293 hits, 462600 investment, 398640 payout, ROI 86.1738003%.
- Displayed v2 classification counts do not measure an Expert-driven prediction improvement.

## Exhibition availability

Latest inspected report at 2026-10-09T23:34:16.866Z (2026-10-10 08:34 JST): `captured_preclose`, 2 eligible and 2 captured records, none missing/stale. The previous nighttime HTTP 404 has cleared. No exhibition acquisition change is included.

## Operational application

The fix is first recorded on migration/stage-live-cutover-20261009 with migration safety gates. The same parser, regression test and fixture were applied to development main in `f3168f3cf670a79e4fee02546039d9568525b628` for the existing scheduled collector. No production promotion is authorized by this continuation.

## Observed automatic recovery

- Staging fix: `eaac04e7a87b3373127eea5e3d5d6c9bd66e3646`.
- GitHub migration safety runs [38006333748](https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/38006333748) and [38006330458](https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/38006330458): success.
- Local verification expanded to 18 JS gate scripts and 8 Python tests, all passing. The Python refresh tests required installation of the workflow-pinned lhafile==0.3.1 dependency in the local environment.
- Automatic collection data checkpoint `0998f116d61dae7bbfdd63a9f8be795fbf3a9cb6`: 834 saved, 772 normally settled, 60 excluded, 2 pending; health ok with no overdue/missing/stale records.
- Cached official evidence `dev/official-result-fallback/20261008_14_5.json`: parsed non-established trifecta, 100-yen refund per 100-yen ticket, refund boats 2 and 4, six verified finishers. This race is confirmed excluded, not a loss or hit.
- Byte-equivalent parsed-record comparison against the original source verified that all 833 original keys remain and all 830 previously final records (771 normal + 59 excluded) remain deeply identical. Every old field on the recovered record except the now-resolved fetch error also remains identical.
- One newly completed current-day race explains movement of overall ROI. At the checkpoint baseline ROI 85.6692573% and candidate 86.0621762%; this is not evidence of improved profitability.

- Updated scheduled collector run [38006380894](https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/actions/runs/38006380894): completed successfully after three bounded passes.
