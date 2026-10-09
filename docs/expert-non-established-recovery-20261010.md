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

The fix is first recorded on migration/stage-live-cutover-20261009 with migration safety gates. The same parser, regression test and fixture can be applied to development main for the existing scheduled collector. No production promotion is authorized by this continuation.
