# Meta Platforms marketing environment for Claude by Praecise

Lets Claude run marketing on Meta Platforms for the accounts you connect:
advertising on Facebook and Instagram, a Page's and an Instagram account's posts,
comments and conversations, Threads, and WhatsApp Business messaging. It works in a
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

The tests are `tests/meta-marketing.test.ts` at the top of the repository.

Four skills, on purpose: every installed skill adds its description to every session.

## What it reaches

Meta runs its own MCP servers, and the environment uses them as they are.

| Server | Address | Used for |
|---|---|---|
| Meta Ads | `https://mcp.facebook.com/ads` | Reporting, campaigns, creatives, audiences, catalogs, tests |
| WhatsApp Business Tools | `https://mcp.facebook.com/whatsapp_business_tools` | Numbers, templates, webhooks, sending |
| Meta Social Technologies | `https://mcp.facebook.com/devtools` | Apps, App Review, compliance, webhooks, docs search |
| Instagram | `https://mcp.facebook.com/instagram` | Publishing. Live, not yet documented by Meta |

Accounts are found through the Graph API. A Page's posts and comments and an Instagram
account's media and comments are not offered by any of Meta's servers, so the
environment works on them through the Graph API when `organic` is set.

## In a praecise-harness app

```ts
import { defineConfig } from "@praecise/harness";
import { metaMarketing } from "@praecise/harness-environments/meta-marketing";

export default defineConfig({
  plugins: [metaMarketing({ appId: "your Meta app's App ID", profile: "read" })],
  // also: organic: true, messaging: true, threads: { appId: "..." }, rules: true, separate: ["whatsapp"]
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
does, and `meta_marketing_call` calls one. An account is named wherever a tool asks
for one, by the name in the list; the environment sends Meta the id, and gives back
names for the ids in the answer. Reading works on any account. Creating needs the
account in draft mode. Activating, updating, boosting, sending and anything else that
goes live needs act mode and a person's approval, and deleting always does. A change
that names no account is refused.

With `organic: true` a Page and its Instagram account are worked on through the Graph
API, as the Page itself:

| Function | Does |
|---|---|
| `meta_page_posts`, `meta_page_comments` | Read a Page's posts, and the comments on one |
| `meta_page_post` | Publish a post now, or at a time up to 30 days ahead |
| `meta_page_comment` | Comment on a post as the Page |
| `meta_page_comment_hide`, `meta_page_comment_delete` | Hide or show a comment; delete one |
| `meta_instagram_media`, `meta_instagram_comments` | Read an Instagram account's posts, and the comments on one |
| `meta_instagram_publish` | Publish one JPEG, a reel from one video, or a carousel of 2 to 20 JPEGs |
| `meta_instagram_reply` | Reply to a comment |
| `meta_instagram_comment_hide`, `meta_instagram_comment_delete` | Hide or show a comment; delete one |

With `messaging: true` the conversations a Page has in Messenger, and its Instagram
account has in Instagram Direct, can be read and answered:

| Function | Does |
|---|---|
| `meta_conversations` | List recent conversations, on `messenger` or `instagram` |
| `meta_messages` | Read one conversation's latest messages; Meta gives the 20 most recent |
| `meta_message_send` | Reply to the person, as the Page |

Meta takes a reply only within 24 hours of the person's last message. Reading and
answering conversations with people who have no role on your business needs Meta's
Advanced Access.

With `threads: { appId }` a Threads profile is worked on through the Threads API:

| Function | Does |
|---|---|
| `meta_threads_posts` | Read the profile's recent posts |
| `meta_threads_publish` | Publish text of up to 500 characters, with one image if given |
| `meta_threads_insights` | Views, likes, replies, reposts and quotes over a period |
| `meta_threads_reply_hide` | Hide a reply and those under it, or show it again |

Threads has an app, a sign-in page and a token of its own, so `connect` opens a second
page for it straight after Meta's. `appId` is the Threads App ID, the Threads app
secret is read from `THREADS_APP_SECRET`, and `http://localhost:8766/callback` must be
among the Threads app's redirect addresses (or the port you give). The token Threads
returns lasts an hour; the environment trades it at once for one that lasts sixty
days and renews that before it runs out.

Publishing, sending, replying and hiding need the account in act mode and a person's
approval; deleting always needs a person. The Meta app needs the permissions these
ask for: `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement`,
`instagram_manage_comments` and `instagram_content_publish` for `organic`, and
`pages_messaging`, `pages_manage_metadata` and `instagram_manage_messages` for
`messaging`.

With `rules: true` an ad account's mode and limits are also written to Meta as its own
rules for agents, so Meta refuses what the account forbids whichever client asks: read
mode denies everything, draft mode denies switching delivery on or off, and `perAction`
and `perDay` become the largest budget increase and the daily budget ceiling. Meta
offers these rules to enrolled businesses only; for one that is not, changing a mode
says so.

Meta documents that its Ads server takes a token from your own app. If one of its
other servers does not, list it in `separate` (`"instagram"`, `"whatsapp"`,
`"developer"`): `connect` then signs in to it by itself straight after the first, in
the same browser.

Two workflows come with it. `meta-weekly-report` reports on one ad account for the
last seven days against the seven before. `meta-campaign-launch` takes an ad account
and a brief: an agent drafts the campaign paused and previews it, and switching it on
is a second step that stops at an approval gate until a person agrees to exactly that
call. The ad account must be in act mode for the second step.

A tool of Meta's that the environment does not list, such as those of the Instagram
server, is classed by what the server says of it: a tool it marks as only reading is a
read, one it marks as destructive destroys, and anything else is treated as publishing.
A tool that takes only something inside an account, such as a campaign, is given the
account's name in `account`, beside its own arguments.

For comments, messages and other deliveries from Meta, point the Meta app's webhook at
`/environments/meta-marketing/intake` on the app's server and set `META_APP_SECRET`
and `META_WEBHOOK_VERIFY_TOKEN`. Deliveries are checked against Meta's signature and
published as events named `meta-marketing.<object>.<field>`, with the account's name
as the subject.

## In Claude Code

```
/plugin marketplace add Praecise/praecise-harness-environments
/plugin install meta-marketing
```

Claude Code is a client Meta recognises, so each server signs in by itself the first
time it is used, with no Meta app. The skills are the same. The accounts list, modes,
limits and approvals above belong to the harness and are not in this path: here Claude
asks before it changes anything, and Meta creates campaigns, ad sets and ads paused.

## What has not been tried against Meta itself

Everything here is built from what Meta publishes and from what its servers answer
without a sign-in, and is tested against a stand-in for Meta. A real sign-in is what
shows:

- Whether Meta takes the one token on its WhatsApp, Instagram and Social Technologies
  servers. `separate` is there for the ones that do not.
- The tools of the Instagram server, which Meta has not documented.
- Whether your business is enrolled for Meta's rules for agents.
- Whether Threads accepts a redirect to this machine, and its token in a header.

Not here because Meta does not publish them: Threads' own MCP server, which answers
but has no documentation, and replying to a comment on a Page (commenting on the post
is there).

The guard holds a call to the accounts it names. A campaign, ad set or ad inside an
account is named to Meta by Meta's own id, and it is Meta that checks which account it
belongs to; `rules: true` is what makes Meta hold that account to its limits.

## Rules it keeps

- Never reread, never poll, small output.
- Nothing is switched on, sent or published without a person.
- No token, id or secret is written to the repository, a log or a prompt.
- What Meta returns is governed by the Meta Platform Terms, which bind the app and the
  agent acting for it.
