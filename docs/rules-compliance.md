# Rules compliance

What this script does, checked line by line against Torn's scripting rule.

## Provenance of the rule text, stated first

**Nobody on this project has read `torn.com/rules.php` directly.** It, the Torn
wiki, and every proxy and archive route tried all refuse automated requests, and
Cloudflare blocks at the origin rather than at the client, so a proxy does not
help either.

What we have instead is a quotation of the rule that appears, in quotation
marks and with the same wording, in three independent places: a userscript
author's README on GitHub that was fetched and read directly
(`raw.githubusercontent.com/edlau2/Tampermonkey/master/README.md`, which
attributes it to Torn's Tools and Userscripts forum), and search-engine renderings
of two Torn threads that could not be fetched — "New rule addition - Scripting
abuse" (t=16000717) and "[QUESTION] Scripting rules" (t=16482084).

The wording is idiosyncratic enough, down to the closing "go wild!", that three
independent reconstructions of it are implausible. Treat it as reliable in
substance and uncertain in punctuation.

> "The use of scripts, extensions, applications or any other kind of software is
> allowed only if it uses data from our API or a page you (or your users) have
> loaded manually and are currently viewing."
>
> "[They cannot] make additional non-API requests to Torn, scrape pages that
> you're not currently viewing, or attempt to bypass the captcha."
>
> "If the software you're using makes non-API requests that are not manually
> triggered by you, it is not allowed and can be tracked. Assuming this rule is
> followed, go wild!"

**Still unverified.** Whether the popular gloss "one input, one request" is
Torn's own phrasing or a community summary — the evidence suggests a forum
reply, not the rule text. And the ~100 requests per minute figure, which is
reported everywhere and quoted nowhere.

**The one open action.** A human should load `torn.com/rules.php` and the pinned
"Rules for Scripts, Addons, Extensions & Tools" thread by Chedburn in the Tools
and Userscripts forum in an ordinary signed-in browser, and paste the scripts
section here verbatim. Until that happens this document rests on a secondary
quotation. `docs/qa-checklist.md` carries it as a release item.

## The check

| The rule says | What this script does | Verified by |
|---|---|---|
| May use data from the official API | Reads five API endpoints, all GET | `read-only.test.js`, every method is GET |
| Or from a page loaded manually and currently viewed | Capture reads `location` and `document.title` of the page the user is on, nothing else | `capture.test.js` |
| No additional non-API requests to Torn | **Zero.** The only host anything is fetched from is `api.torn.com` | `read-only.test.js`, `@connect` is one host; no scripted navigation |
| No scraping pages you are not viewing | Never loads or reads any page the user has not opened | No fetch to any `www.torn.com` URL exists |
| No bypassing the captcha | Never touches it | Nothing in the source references it |
| Non-API requests must be manually triggered | There are no non-API requests to trigger | Mutation-checked: reintroducing `location.href =` fails the suite |

### Where auto-refresh lands

This mattered enough to chase the wording for. The rule's automation clause is
scoped to **non-API requests**: "if the software you're using makes *non-API*
requests that are not manually triggered by you". Auto-refresh makes API
requests, which the first clause permits outright.

It is still the one thing here that happens without a user input, so it is
constrained anyway: off by default, minimum interval two minutes, paused while
the page is not visible, single-flight, and inside the same 40-per-minute
ceiling as everything else. All five are tested.

### Where the reply-box draft insert lands

Inserting a saved draft writes text into Torn's reply box and dispatches one
`input` event so React notices the change. It **types**; it does not send. No
click is simulated, no form is submitted, and the user still presses Post
themselves. This is the only synthetic event in the whole script and a test
asserts it stays that way.

Search surfaced one further line, single-sourced and so weaker than the rest:
that scripts "can rearrange things on the page to make your clicking easier, but
can't make non-API requests on their own". If accurate, it describes this script
exactly.

### Search on Torn

Originally a button that assigned `location.href`. It is now a plain `<a href>`.
Both load the same page, but a link makes the request unambiguously the user's
own click rather than something the script initiated, which removes the last
place the script could be said to have made a non-API request to Torn.

## What the script cannot do, by construction

No POST, PUT, PATCH or DELETE exists in the source. No `.click()`, no
`.submit()`, no synthetic mouse, pointer, key or touch event. No `window.open`,
no `GM_openInTab`, no scripted navigation. The grant list is exactly
`GM_getValue`, `GM_setValue` and `GM_xmlhttpRequest`, and `@connect` names one
host.

None of that is a promise in prose. `tests/read-only.test.js` asserts each of
them, and `tests/mutation-check.mjs` breaks each one in turn and confirms the
suite notices — a non-GET verb, a simulated click, a scripted navigation, an
auto-refresh that defaults on, an auto-refresh that ignores page visibility, and
a second `@connect` host all fail the build.

## If Torn ever objects

The two things to turn off first, in order, are auto-refresh (already off by
default) and the draft insert. Neither is load-bearing: the workspace, the
organiser, catch-up and search all work without them.
