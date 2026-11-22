---
name: account-audit
description: Audit a Meta ad account for structure, delivery problems, signal health and the largest opportunities. Use when asked how an ad account is doing overall or what to fix first.
---

# Audit a Meta ad account

Rules: never reread a result, never poll, ask for the fields you will use.

1. Find the account. In a praecise-harness app call `meta_marketing_accounts` and use
   the name it lists. In Claude Code with Meta's Ads server connected, call
   `ads_get_ad_accounts`.
2. One call each, on Meta's Ads server:
   - `ads_insights_advertiser_context`: what the business sells and its funnel.
   - `ads_get_opportunity_score`: the 0 to 100 score and Meta's own recommendations.
   - `ads_insights_anomaly_signal`: anything unusual that needs a look.
   - `ads_get_ad_entities` for campaigns, last 30 days, with spend, results, cost per
     result and status. Ask for ad sets only under the campaigns that carry most spend.
3. Signals: check dataset and pixel health with the server's signals tools. A campaign
   optimising for an event that is not arriving is the first thing to report.
4. Report, shortest first:
   - What is losing money now (spend with no results, rejected ads, learning limited).
   - The three changes with the largest expected effect, each with the evidence.
   - What cannot be judged yet and what data would settle it.

Do not change anything in an audit. Propose; a person decides.
