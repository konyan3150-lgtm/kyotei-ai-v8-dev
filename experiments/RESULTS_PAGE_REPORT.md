# Dedicated DEV result list

Adds results.html with responsive race cards, prominent finish combination and authoritative saved payout, collapsible saved picks, V8/value separation and mode/date/venue/result/recommendation filters. Defaults to today's hits. Summary always includes purchased settled misses in the selected scope and excludes pending/cancelled/skipped records. Reference V8 hits are labelled. Full history is requested only for earlier dates or expanded periods; display is paged at 50 cards. Uses the existing server/local merge and payout fields without computing stakes or replacing historical records. Refreshes every three minutes and retains displayed records on network failure.

Deployment adds a homepage link and runs tests/results-browser.cjs alongside the existing mobile dashboard and monetary integrity checks before Pages publication. Production source repository is unchanged.
