# Official result fallback (DEV only)

When the results API is unavailable or incomplete, closed pending prospective records now check the official individual result page. Page race/date/venue links, all six distinct boats and racer registrations, finish codes, trifecta payout and explicit refund table must be present. Normal settlement requires all six unique ranks and the payout combination matching the first three boats. Published daily payout is cross-checked when available. Confirmed refund or special finishes remain excluded from ordinary paired ROI. Missing or unexpected fields stay pending with a recorded diagnostic.

Verified responses are cached with URL, capture time and raw HTML SHA256 under dev/official-result-fallback. Forecasts and previous review history remain unchanged. Fetches have a 20-second timeout, at most 12 fallback attempts per run; subsequent scheduled runs continue pending records. Upstream production is unchanged.

Validation: real official 唐津 2026-10-03 1R structural fixture (2-1-4, 3480 yen), wrong race/date, unknown rank, missing refund section, invalid payout, confirmed special/refund and incomplete API cases; existing prospective/variant/expert/EV/realtime/diagnostics/health tests. Live scheduled collector verification follows deployment.
