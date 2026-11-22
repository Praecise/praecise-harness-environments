# Meta Platforms marketing environment for Claude by Praecise

Lets Claude run marketing on Meta Platforms for the accounts you connect:
advertising on Facebook and Instagram, and WhatsApp Business messaging. It works in a
praecise-harness app, where one sign-in covers every account and each account has its
own limits, and in Claude Code as a plugin.

Needs a Meta account with access to the business assets you want to work on. In a
praecise-harness app it also needs a Meta app of your own, for its App ID.

## What is in it

```
skills/
  account-audit        how an ad account is doing and what to fix first
  performance-report   weekly and monthly reporting with trends and benchmarks
  campaign-draft       a campaign prepared paused, for a person to approve
  whatsapp-setup       numbers, templates and webhooks on the Cloud API
index.ts               the praecise-harness environment
.mcp.json              Meta's own MCP servers, for Claude Code
.claude-plugin/        the Claude Code plugin
```

The test is `tests/meta-marketing.test.ts` at the top of the repository.

Four skills, on purpose: every installed skill adds its description to every session.

## What it reaches

Meta runs its own MCP servers, and the environment uses them as they are.

| Server | Address | Used for |
|---|---|---|
| Meta Ads | `https://mcp.facebook.com/ads` | Reporting, campaigns, creatives, audiences, catalogs, tests |
| WhatsApp Business Tools | `https://mcp.facebook.com/whatsapp_business_tools` | Numbers, templates, webhooks, sending |
| Meta Social Technologies | `https://mcp.facebook.com/devtools` | Apps, App Review, compliance, webhooks, docs search |
| Instagram | `https://mcp.facebook.com/instagram` | Publishing. Live, not yet documented by Meta |

Accounts are found through the Graph API. Page posts and comments, Messenger, and
Instagram comments, messages and insights are not offered by any of Meta's servers yet
and are not in this version.

## In a praecise-harness app

```ts
import { defineConfig } from "@praecise/harness";
import { metaMarketing } from "@praecise/harness-environments/meta-marketing";

export default defineConfig({
  plugins: [metaMarketing({ appId: "your Meta app's App ID", profile: "read" })],
});
```

One sign-in:

```sh
praecise meta-marketing connect      # opens Meta's page; choose what the app may reach
praecise meta-marketing accounts     # every account found, by name, all in read mode
praecise meta-marketing doctor       # what is missing
```

`connect` signs in with Facebook Login for Business as a public client with PKCE: no
app secret, and nothing to paste. What Meta returns is kept in the login keychain on a
Mac, or in a sealed file under `PRAECISE_VAULT_KEY` elsewhere, and is presented to each
of Meta's servers and to the Graph API. You choose the businesses, ad accounts, Pages
and numbers on Meta's own page, and can change or revoke that at any time under
Settings > Your Activity > Business Integrations.

The Meta app needs:

- The use case "Create & manage ads with ads MCP server", and Facebook Login for
  Business.
- `http://localhost:8765/callback` among its redirect addresses (or the port you give
  as `callbackPort`).
- Nothing else while you work on assets you administer. Working on other
  organisations' assets needs Meta's App Review and Business Verification.

`profile` decides what is asked of Meta:

| Profile | Adds |
|---|---|
| `read` | Reporting, and listing businesses, ad accounts, Pages and Instagram accounts |
| `draft` | Creating and editing ads, catalogs |
| `act` | Publishing to Instagram, WhatsApp management and messaging |

Every account starts in read mode. A person moves one further, and sets its limits:

```sh
praecise meta-marketing mode acme/eu-store draft
praecise meta-marketing limits acme/eu-store perDay=500 approveAbove=50
```

Agents use three functions: `meta_marketing_accounts` lists the accounts by name,
`meta_marketing_tools` lists what one of Meta's servers offers and what each tool
does, and `meta_marketing_call` calls one. Reading works on any account. Creating
needs the account in draft mode. Activating, updating, boosting, sending and anything
else that goes live needs act mode and a person's approval, and deleting always does.

For messages and other deliveries from Meta, mount `environment.receive` on the app's
server and set `META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN`. Deliveries are
checked against Meta's signature and published as events named
`meta-marketing.<object>.<field>`.

## In Claude Code

```
/plugin marketplace add Praecise/praecise-harness-environments
/plugin install meta-marketing
```

Claude Code is a client Meta recognises, so each server signs in by itself the first
time it is used, with no Meta app. The skills are the same. The accounts list, modes,
limits and approvals above belong to the harness and are not in this path: here Claude
asks before it changes anything, and Meta creates campaigns, ad sets and ads paused.

## What is not done yet

- Changing things through Meta's servers from a harness app. The environment refuses
  any change that does not name an account, and the names of the arguments Meta's
  tools take for an account are confirmed against a live sign-in before they are
  mapped. Reading works now.
- Whether Meta accepts a token from your own app on the WhatsApp, Instagram and Social
  Technologies servers, as it documents for the Ads server. Where it does not, those
  servers are for Claude Code until it does.
- Holding an account to its limits on Meta's side. Meta has rules for this in limited
  availability; a business must be enrolled.
- Threads. Meta's server answers but nothing is published about it.

## Rules it keeps

- Never reread, never poll, small output.
- Nothing is switched on, sent or published without a person.
- No token, id or secret is written to the repository, a log or a prompt.
- What Meta returns is governed by the Meta Platform Terms, which bind the app and the
  agent acting for it.
