# Rules compliance

What this script does, checked clause by clause against Torn's rules and its
API acceptable usage terms.

## Sources

**The scripting rule.** Verbatim, supplied by the project owner from Torn's
rules page, which refuses automated requests:

> **SCRIPTING ABUSE: Game ban**
>
> The use of scripts, extensions, applications, or any other software is
> permitted only when they rely on data from our API or from a page that you
> have manually loaded and are actively viewing. Such software must not make
> additional non-API requests to Torn, scrape pages that are not currently being
> viewed, attempt to bypass CAPTCHA protections, or extract data from unfocused
> pages to send elsewhere, generate alerts, or draw attention to itself or
> another window. Any software that makes non-API requests which are not
> directly and manually initiated by the user is prohibited and may be tracked.
> Furthermore, releasing software with malicious or undisclosed functionality is
> strictly forbidden, and developers of API-based tools are required to comply
> with the acceptable usage terms outlined here.

**The API acceptable usage terms.** Verbatim, from a saved copy of the Torn API
documentation page supplied by the owner. The clauses that bear on this script:

> The goal of the Torn API is to provide a fully supported and **read-only**
> method for players to pull useful information from Torn.

> You must keep keys, and the data obtained from them, securely protected and
> confidential unless permitted by the key owner.

> Please make sure your scripts are optimised to retrieve only the information
> required for the specific request they're making. They should be retrieving as
> little information as possible.

> Each user can make up to 100 individual requests per minute across all of
> their keys. Multiple requests using invalid keys may result in a temporary IP
> ban - **you must account for this by removing disabled or invalid keys upon
> error.**

> If the service is not storing or sharing the data or the key anywhere, it's
> enough to state so, otherwise ToS with the information above needs to be
> clearly and visibly stated in any place where user is providing their API key
> in the table format highlighted above.

> All services must be compliant with Torn's scripting rules.

An earlier version of this document rested on a secondary quotation of the
scripting rule. It was close in substance but incomplete: it was missing the
unfocused-pages clause, the undisclosed-functionality clause, and the pointer to
the API terms, and the API terms contain a requirement this script did not meet.

## The scripting rule, clause by clause

| Clause | This script | Enforced by |
|---|---|---|
| May rely on data from the API | Five endpoints, all GET | `read-only.test.js` |
| Or from a page manually loaded and actively viewed | Reads `location` and `document.title` of the page the user is on, nothing else | `capture.test.js` |
| No additional non-API requests to Torn | **None.** `api.torn.com` is the only host anything is fetched from | `@connect` is one host; no scripted navigation exists |
| No scraping pages not currently viewed | Never loads or reads any page the user has not opened | No fetch to any `www.torn.com` URL exists |
| No bypassing CAPTCHA | Never touches it | Nothing in the source references it |
| No extracting data from unfocused pages to send elsewhere | Nothing is ever sent anywhere but `api.torn.com`, and auto-refresh stops when the page is hidden **or unfocused** | `read-only.test.js` asserts both the `hidden` and `hasFocus` guards |
| No generating alerts | No `alert`, no notification, no sound. `GM_notification` is not granted | grant list is asserted exactly |
| No drawing attention to itself or another window | No title or favicon changes, no flashing, no focus stealing, no second window. The panel is static markup on the page you are looking at | no `window.open`, no title writes |
| Non-API requests must be manually initiated | There are none to initiate | mutation-checked: reintroducing `location.href =` fails the suite |
| No malicious or undisclosed functionality | See below | |

### Undisclosed functionality

Everything the script does is stated where it happens, not only in a readme.

The one feature that reads what the user types is **autosave of the reply box**,
which is on by default. It is disclosed three times: a labelled checkbox in
Settings that can turn it off, the README's privacy section, and this table. It
writes only to local script storage and nothing about it is ever transmitted.

The API key is stored locally, masked in the panel, excluded from every export,
and scrubbed out of error messages and debug reports.

### The unfocused-pages clause

The clause reads "extract data from unfocused pages to send elsewhere, generate
alerts, or draw attention to itself or another window". Grammatically the three
outcomes hang off "extract data from unfocused pages", which this script never
does at all. It is compliant on either reading, because it also generates no
alerts and draws no attention to any window.

Auto-refresh is the only thing here that happens without a user input, and the
rule's automation sentence is scoped to **non-API** requests, which auto-refresh
does not make. It is constrained anyway: off by default, minimum interval two
minutes, single-flight, inside the 40-per-minute ceiling, and it stops when the
page is hidden or unfocused.

## The API terms, clause by clause

| Clause | This script | Enforced by |
|---|---|---|
| The API is read-only | GET only. No POST, PUT, PATCH or DELETE exists in the source | `read-only.test.js` |
| Keep keys and their data protected and confidential | Key and data never leave the device. Key excluded from exports and scrubbed from every error path | `share.test.js`, `debug-report.test.js`, `api.test.js` |
| Retrieve as little as possible | Two calls per refresh; forum names once a day; per-thread lookups only for threads with unread posts, capped at ten; post bodies only on an explicit deep search | `refresh.test.js` |
| 100 requests per minute per user across all keys | Self-limited to **40**, leaving room for whatever else uses the key | `ratelimit.test.js` |
| **Remove disabled or invalid keys upon error** | Torn codes 2, 13, 16 and 18 stop the key being used at all. The gate is in `tornApiGet`, so refresh, enrichment and deep search are all covered. The rejection is persisted, so a reload does not spend another request on a dead key | `key-rejection.test.js` |
| State the terms where the key is entered | A table in the Settings view beside the key input: who can see the data, what it is for, storage, access level, and what requests are made | `read-only.test.js` |
| Comply with the scripting rules | Above | |

### Why the key rejection matters

This was the one real gap. Before it, a revoked or paused key would be retried
on every page load and every auto-refresh, indefinitely. The terms name the
penalty for that pattern: a temporary IP ban.

Codes 5, 9, 10, 11 and 17 are deliberately **not** treated as a dead key. Rate
limiting, maintenance, the owner being in federal jail, a key changed too
recently and a Torn backend error all pass on their own, and condemning the key
would send the user to replace something that was never wrong.

## What the script cannot do, by construction

No POST, PUT, PATCH or DELETE. No `.click()`, no `.submit()`, no synthetic
mouse, pointer, key or touch event. No `window.open`, no `GM_openInTab`, no
scripted navigation, no notifications. The grant list is exactly `GM_getValue`,
`GM_setValue` and `GM_xmlhttpRequest`, and `@connect` names one host.

None of that is a promise in prose. `tests/read-only.test.js` and
`tests/key-rejection.test.js` assert each of it, and `tests/mutation-check.mjs`
breaks each one in turn and confirms the suite notices.

## If Torn ever objects

The two things to turn off first, in order, are auto-refresh (already off by
default) and the draft insert. Neither is load-bearing: the workspace, the
organiser, catch-up and search all work without them.
