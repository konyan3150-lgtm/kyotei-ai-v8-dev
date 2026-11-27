# Claude review handoff (free/manual)

This document is a copy/paste review brief. It does not connect to Claude or transmit code automatically.

## Scope
Review draft PR #1 in `konyan3150-lgtm/kyotei-ai-v8-dev`:
https://github.com/konyan3150-lgtm/kyotei-ai-v8-dev/pull/1

## Prompt to paste into Claude
Please review the GitHub Actions workflow changes in the linked draft PR. If you cannot access the repository or PR, ask me to paste the workflow YAML; do not claim to have inspected it.

Prioritize:
1. GitHub Actions security: permissions, untrusted pull requests, shell interpolation, and third-party actions.
2. Whether checkout depth and base SHA diff checks work for pull_request events.
3. Whether JSON validation, merge-marker detection, and archive deletion protection can produce false positives or miss important files.
4. Whether Expert evaluation checks are mathematically valid and handle missing keys, NaN, booleans, and zero investment.
5. Whether history regression rules block legitimate corrections or miss destructive edits.
6. Suggest minimal patches and test cases, without touching production.

Please report: severity, exact file/line or YAML step, reproduction, proposed fix, and what cannot be verified.

## Constraints
- Never edit or deploy `kyotei-ai-v8-live` without explicit user approval.
- Never overwrite historical race or betting records.
- Keep V8 and EV mode saved bets and results separate.
- No paid API or secrets. Claude Free review is manual.
- Do not claim tests passed without a GitHub Actions run.
