# Claude review: history preservation candidate

Scope: development branch migration/stage-live-cutover-20261009 only. No production change or updater dispatch.
Candidate source copied from live 0ce012144410288949b133c1584a3c40c37a6914 into experiments/production-update. It is not connected to a scheduled writer or deployment.

## Verified findings and changes

The live updater swallowed any JSON read/parse error into a fallback, directly overwrote history files, and deleted pending records older than 45 days. Those paths exist in the reviewed code; this does not prove historical loss actually occurred.

- Invalid existing JSON now raises an error. Missing files use defaults only where explicitly allowed; missing aptitude data stops prediction generation.
- Validate hot records, every archive (including untouched ones), index counts, archive existence, schema and duplicate keys before processing.
- Require every original history key to survive, even when a replacement record would keep total count constant.
- Retain old pending records and report their count instead of deleting them.
- Serialize and validate every proposed output, stage unique temporary files, fsync them, then replace files using rename. Install index last; clean staged files after failure.
- Feed fetches have 15-second attempt timeouts and two bounded attempts. Optional failures are reported instead of silently disappearing.
- Candidate update-live-odds workflow removes continue-on-error from the prediction step, captures an initial history baseline, and validates retained keys after Expert backfill before committing. This YAML is a template outside .github/workflows and does not run.

## Validation

- 49 local tests passed: existing 31, 14 new preservation/network/workflow regressions, and 4 real-feed saved-window regressions.
- Candidate original prediction/expert self-tests passed.
- Read-only validation of an independent production data snapshot: 2782 records, 2 archives; baseline and verification pass.
- Recent-index sample: latest 100 index-changing commits ending at source SHA above; all total_record_count values 2782, no decrease or parse error in that sample. This is not a full-history audit and does not prove every record's money stayed unchanged.

New tests cover corrupt hot/index/archive/aptitude, valid-but-invalid schema, missing indexed archive, stale pending retention, repeated runs, monetary/key preservation on archiving, failure before rename, same-count key replacement, smaller valid history, transient retry, timeout and visible optional failure, and the candidate commit gate.

## Limits and remaining work

Each file replacement is atomic; a batch of different files is not a single filesystem transaction. An interruption between renames can leave count/index disagreement, which the next preflight rejects and the workflow must not publish. Restoration/recovery should be designed before deployment; remote concurrency among separate writer workflows is not solved by local renames.

Optional missing feeds are visible warnings but have no persisted health artifact yet. Corrupt existing local stats abort the run; input freshness/provenance is not yet enforced.

Claude proposals 2 (settlement validation/cancellation/legacy saved stakes) and 3 (evaluation leakage/provenance) remain to be independently verified and implemented. No historical records, production models, purchase rules or payouts were repaired or recalculated in this change. Production deployment needs separate user authorization.

## Midnight browser test correction

Initial candidate 3f8b814 passed migration safety (run 37952550311), but browser run 37952543986 failed because no current-day saved sample existed just after JST midnight. Fixture results/validation browser checks passed. The real-feed test now permits an empty sample only when all program close times are known and the first close is still in the future. At/after first close, missing saved samples still fail. It reports the actual sample count and reason, and retains model/program/server connectivity, racer rendering, responsive layout and day-switch verification.
