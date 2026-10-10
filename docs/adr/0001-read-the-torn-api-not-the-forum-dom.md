# ADR 0001: Read the Torn API for all data, and require an API key

**Status:** Accepted
**Amended by:** ADR 0002 (the reply-box access point)
**Date:** 2026-08-07

## Context

The brief asked for a workspace built from "the currently viewed page and
locally captured visits, rather than crawling forum pages in the background" —
a reasonable instinct about Torn's rules, written before we knew what the API
offered.

Three findings from research changed the picture. Torn's API v2 has real forum
endpoints, verified field-for-field against `torn.com/swagger/openapi.json`,
three independently generated clients, and Torn PDA's production code.
`user/forumsubscribedthreads` returns `posts.new` — a per-thread unread count
that no amount of HTML parsing would produce. Torn's own API v2 roadmap thread
scoped a `forumUpdates` feature and shipped the endpoints without building an
interface for them.

Against that, no source anywhere could confirm a single current forums selector.
Every real selector research surfaced (`#forums-page-wrap`, `.threads-list`,
`.post-wrap`) comes from userscripts predating Torn's React rewrite. We would
have been writing a parser against markup we had never seen.

Torn's scripting rules allow acting on the official API, or on a page the user
has manually loaded, one input producing one request. The API is the sanctioned
channel, not a tolerated one.

## Decision

We will read the Torn API v2 for every piece of data, and we will require an API
key with Minimal access. There is no degraded no-key mode.

No data path may depend on Torn's markup. DOM access is confined to two places,
choosing a mount container and finding the reply textarea, and both must degrade
visibly. The local capture layer reads `location` and `document.title` only.

This applies to this repo.

## Alternatives considered

**Scrape the forums DOM, no key.** The most literal reading of the brief and the
lowest friction to install. Rejected: we could not confirm the DOM, hashed
React classnames change without notice, and it yields no unread counts at all —
the single most valuable field. A parser we could not test against real markup
would have been the whole product resting on a guess.

**Optional key with a scraping fallback.** The recommendation put to the owner,
because it keeps a zero-config on-ramp. Rejected by the owner in favour of one
data path. That is the better engineering call: two data paths means two sets of
failure modes, two merge behaviours and two things to keep working, in exchange
for a mode that would have been the weaker product anyway.

**Same-origin page data endpoint**, the trick the sibling Education Scheduler
uses against `page.php?sid=educationInitData`. Rejected: no equivalent forum
endpoint could be confirmed, and unlike the API it is undocumented and could
change without any notice at all.

## Consequences

Easier: a full refresh is two requests rather than a crawl. Unread counts,
authors, forum ids and post bodies arrive as typed JSON. Rules compliance is
argued from the sanctioned channel rather than from a reading of what counts as
crawling. A Torn redesign can move our panel but cannot break our data. The
engine stays pure and the whole product is testable in Node.

Harder: the script does nothing until the user pastes a key, which will cost
installs. `GM_xmlhttpRequest` and `@connect api.torn.com` are a real escalation
over the sibling script's grant list. We inherit Torn's rate limits and the
asymmetry that `forumsubscribedthreads` has unread counts but no last-post time,
which is the entire reason the enrichment budget and the last-activity
precedence chain exist.

Revisit if Torn removes or paywalls the forum endpoints, if the key requirement
proves to be the dominant reason people uninstall, or if Torn ships a documented
same-origin forum data endpoint that needs no key. Any of those is a new ADR
superseding this one.
