# Expert V2 integration checkpoint — 2026-10-02

328 unique pre-close Expert records joined to the 1,741-race server history.
326 settled results match the server exactly; two pending.
325 pre-close meeting-context records and 326 pre-close probability/odds records are available.
One probability/odds snapshot failed the pre-close timestamp gate and was excluded.

Features and outcomes are stored in separate objects. Selected-ticket probabilities are not a full 120-ticket distribution. Expert weights are classification indicators, not win probabilities.

Expert was not used in prediction in all 328 records. Grouped baseline performance is descriptive and cannot establish improvement from Expert-driven bets. Two dates are insufficient for a promotion decision.

## Descriptive class performance

| Class | Settled races | Lane 1 won | Baseline V8 hit-mode hit rate |
|---|---:|---:|---:|
| exhibition | 17 | 58.8% | 35.3% |
| inside | 48 | 79.2% | 54.2% |
| normal | 223 | 51.6% | 32.3% |
| upset | 22 | 18.2% | 22.7% |
| water | 16 | 37.5% | 25.0% |

## Reproduce

Run `python experiments/integrate_expert.py --expert-root <dev-checkout> --server-root <live-checkout> --out <output>`. Expert source commit: 6ffc20e24e6bf49680609323b23a46595ba6a3a7. Live source commit: 8286a9783a7799aacade7d0f0de72e8636a681ac.

## Next

Use chronological future holdout days for Expert candidates; retain existing model as baseline. Extend prospective snapshots to all 120 combinations before full-distribution calibration and EV reselection. Preserve baseline predictions and financial history. No production changes in this checkpoint.
