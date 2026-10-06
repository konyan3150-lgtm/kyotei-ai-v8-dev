# Bounded DEV collection passes

2026-10-06: The repaired prospective collector runs up to three sequential passes per scheduled workflow, separated by a 60-second wait after each pass has collected and pushed its checkpoint. Each pass re-runs the existing collector in a fresh process, preserving its pre-close and confirmed-result gates. A failed collection is recorded and retried in the next pass. A failed checkpoint stops the loop and fails the workflow; a final collection failure also fails the workflow. No indefinite polling or self-dispatch is used.

The loop stops starting additional passes after an eight-minute budget; this is a start budget, not a hard timeout for a pass already running. The existing 15-minute workflow timeout remains. Maximum nominal extra idle runner time is two minutes per run. The schedule retains five-minute spacing but shifts away from minute zero to 2,7,12,...,57, following GitHub's recommendation to avoid hourly peak load. Concurrency still serializes collectors without cancelling a running collector.

`dev/shadow-collection-run.json` records attempt timestamps, failures and last successful collection. Each checkpoint commits the diagnostics with the experimental archive and official input history. An always-run artifact step retains diagnostics when a push fails. The file reports the last job's behavior; it cannot independently detect a scheduler which never starts.

Tests cover three successful checkpoints, transient failure recovery, repeated failure, push failure, and the pass start budget. The workflow also retains all existing prediction, source validation, calibration and result fallback tests.

Scope: DEV prospective cohort only. Production prediction generation and payouts are untouched. The engine and classifier remain pinned. Live auxiliary files are those prepared at workflow start; stale odds are still rejected by the existing freshness gate. The change may reduce short gaps between collections after a job starts. It cannot eliminate multi-hour GitHub schedule delays, make unavailable official results available, or reconstruct missing pre-close forecasts.

Reference: https://docs.github.com/en/actions/how-tos/troubleshoot-workflows — scheduled events may be delayed during high load, particularly at the start of an hour.
