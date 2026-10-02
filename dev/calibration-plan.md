# V8 calibration / data integration plan

Updated: 2026-10-02

## Confirmed data sources
- Historical training CSV: 55,301 races, 2024-04-01 through 2025-03-31.
  - train: 41,441
  - validate: 6,862
  - test: 6,998
  - duplicate race keys: 0
  - missing trifecta results: 0
- Server predictions index: 1,741 records total.
  - 202609 archive: 1,405 records.
- Expert V2: 326 captured before close; 321 settled; 5 pending.
- Meeting context / official results / odds / racer aptitude / course and venue stats are auxiliary sources.

## Leakage rules
Only information captured before race close may be used as prediction features.
Official result, payout, settlement status and post-race fields are labels/evaluation only.
Cancelled/scratched races must be separated from normal calibration samples.
Deduplicate by canonical race key: date + stadium/place + race number.

## Calibration experiment
Do not replace production V8 yet.
Compare chronological out-of-sample:
1. current raw probabilities
2. legacy isotonic calibration
3. Platt/logistic calibration
4. recent-window calibration when sample size is sufficient

Primary metrics:
- Brier score
- Log loss
- ECE / reliability bins
- trifecta recommendation hit rate
- ROI after recalculating EV from calibrated probability

## Important legacy finding
The archived V8 model already contains rank1/rank2/rank3 isotonic calibrators.
On its historical test split, calibrated Brier was slightly worse than raw for all three ranks, so legacy isotonic must not be promoted blindly.

## Promotion gate
Keep all work in DEV/shadow until chronological evaluation shows a repeatable improvement.
Never delete historical performance records while integrating sources.
