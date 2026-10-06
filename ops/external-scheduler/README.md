# External DEV collection trigger

Prepared 2026-10-06; not deployed or activated. A separate Cloudflare account and its deployment authorization are required. No credentials are present in this repository. This folder is a proposed five-minute fallback; it is not the already configured hourly ChatGPT recovery watch.

The Worker checks the DEV collection workflow every five minutes (UTC minutes 3,8,...,58), within 08:00–22:59 JST. It dispatches only the hardcoded DEV/main prospective workflow when collection is at least seven minutes old and there is no active or recently completed run. Production is never addressed. Requests time out after 15 seconds; failed reads and invalid timestamps block dispatch. Dry-run is the default. An HTTP endpoint cannot dispatch runs. The existing GitHub collector concurrency and bounded passes remain in force. These guards reduce duplicate requests but are not an exactly-once guarantee across simultaneous scheduler invocations.

## Activation

1. Use an authorized Cloudflare account and install its Wrangler CLI. Authenticate with `wrangler login`.
2. Create a fine-grained GitHub token restricted to `konyan3150-lgtm/kyotei-ai-v8-dev`, with Actions write and Contents read. Metadata read is automatic. Do not put the token into code, GitHub files, command arguments or a chat message.
3. From this folder, deploy with `wrangler deploy` while `DISPATCH_ENABLED = "false"`. Set the token through the interactive `wrangler secret put GITHUB_TOKEN` prompt.
4. Inspect Worker logs. Confirm dry-run decisions for stale collection and suppression for active/recent/fresh runs.
5. Change `DISPATCH_ENABLED` to `"true"` and deploy. Confirm one dispatched workflow completes and its saved `health.checked_at` advances. Keep the GitHub cron fallback enabled.
6. Disable writes by setting `DISPATCH_ENABLED = "false"` and deploying. Remove all cron triggers with `crons = []` if disabling the Worker entirely.

Run gate tests with `node test.mjs`. The tests mock service responses; they do not prove provider deployment or the live credential. Cron invocation, GitHub runners and upstream data can all still be delayed. This provides an independent wake-up source, not a real-time guarantee.

Official references:
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://docs.github.com/en/rest/actions/workflows

## Hourly recovery watch already configured

ChatGPT automation `V8開発版の収集復旧` checks hourly during 08:00–22:59 JST. It may re-run the latest DEV/main collect job when both the collection heartbeat and the latest completed run are more than 20 minutes old and no run is active. Normal status and accepted recovery requests do not produce notifications. Read/authentication failures, rejected recovery requests or jobs stalled for two hours are reported in chat. It neither edits code nor touches production. Hourly checks cannot prevent all missed pre-close windows and their execution can also be delayed.
