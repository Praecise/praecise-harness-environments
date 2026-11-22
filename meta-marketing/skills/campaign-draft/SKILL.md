---
name: campaign-draft
description: Prepare a Meta campaign, its ad sets, creatives and ads in a paused state and hand it to a person to approve. Use when asked to create, launch or set up advertising on Facebook or Instagram.
---

# Draft a Meta campaign

Nothing here starts spending. Meta creates campaigns, ad sets and ads paused, and
switching one on is a separate step that a person approves.

1. Agree the brief first: objective, the ad account, the Page or Instagram account it
   runs from, audience, placements, daily budget and end date, the creative, the
   destination. Ask once for whatever is missing.
2. In a praecise-harness app the ad account must be in draft mode. If it is in read
   mode, say so and give the command: `praecise meta-marketing mode <account> draft`.
3. On Meta's Ads server, in order:
   - `ads_get_field_context` once, for the fields the objective needs.
   - `ads_create_campaign`, then `ads_create_ad_set` with targeting, budget and
     optimisation goal, then `ads_create_creative`, then `ads_create_ad`.
   - `ads_get_ad_preview` for each placement that matters.
4. Show the person: the structure, the budget and what it commits per day and in
   total, the previews, and anything Meta flagged.
5. Stop. Activation is `ads_activate_entity`; in a harness app it waits for an
   approval and needs the account in act mode. Never activate in the same step as
   creating.

Use an existing creative or post when one fits (`ads_get_creatives`,
`ads_get_ig_media`) before making a new one.
