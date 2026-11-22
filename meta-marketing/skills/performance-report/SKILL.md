---
name: performance-report
description: Produce a weekly or monthly performance report for one or more Meta ad accounts, with trends and benchmarks. Use for any request to report, summarise or compare advertising results.
---

# Report on Meta advertising

Rules: never reread a result, never poll, one call per question.

1. Fix the period and the comparison period before the first call. Use whole days in
   the account's time zone and say which.
2. Per account, on Meta's Ads server:
   - `ads_get_ad_entities` at campaign level for both periods: spend, impressions,
     results, cost per result, and purchase value where the account reports it.
   - `ads_insights_performance_trend` for the metrics that moved.
   - `ads_insights_industry_benchmark` once, to say whether a number is good.
3. Across accounts, keep each account's own currency. Never add amounts in different
   currencies; show them side by side.
4. Write the report in this order: the result against the goal, what changed and why,
   what will be done next. One table, at campaign level. Numbers come from the calls,
   never from memory, and a number that could not be read is reported as missing.

A report only reads. It works on an account in read mode.
