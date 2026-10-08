# Torn Forum Command Center

> ## 📱 TORN PDA COMPATIBLE
>
> Runs in the **Torn PDA** app as well as desktop Tampermonkey. The workspace
> lays out for narrow mobile screens, and the panel appears reliably under PDA's
> own userscript engine.

Torn's subscribed-threads box is a small list in a corner. This replaces it with
a real workspace on the forums page: folders, tags, pinned threads, unread
tracking, a catch-up view for everything new since your last visit, reply drafts
saved on your device, and search across the threads you follow — including the
author-plus-text search Torn's own interface never gives you a box for.

Needs a Torn API key that can read your subscribed threads. Nothing else, and
nothing leaves your browser except the API calls themselves.

## Read-only, and it stays that way

This script **never acts on your account**. It cannot post, reply, subscribe,
unsubscribe, vote, or change anything at all. There is no POST, PUT or DELETE
anywhere in it, no simulated click, no form submission, and no page it loads on
its own.

It makes **no non-API requests to Torn**. Every request is a GET to
`api.torn.com`, and the only thing it reads from the page is the address bar and
the title of the page you are already looking at. It generates no alerts, opens
no windows, and changes no page title or favicon.

That is checked clause by clause against Torn's scripting rule and the API
acceptable usage terms in [`docs/rules-compliance.md`](docs/rules-compliance.md),
and it is held there by tests rather than by good intentions: a suite asserts
each property and a mutation check breaks each one in turn to prove the suite
notices.

## Features

### The workspace

- Every subscribed thread on one page, with its unread count, forum, author and
  last activity.
- Sort by last activity, unread first, your own priority, title, author, forum,
  or recently added. Pinned threads stay at the top of all of them.
- Filter by folder, by tag, by unread only, or by typing a query.
- Give a thread a priority from -2 to +2 when "last activity" is not the order
  you actually care about.
- Expand the panel to fill the screen, or collapse it to a single line.
- A Rows shown setting (3 to 30, or All) that caps Threads, Catch up and My
  posts, with Show all for the rest. Search and Drafts are never capped.

### Folders, tags and watchlists

- Folders are the watchlists: keep guides, faction discussion and script
  releases apart.
- A folder can claim a forum, and new subscriptions from that forum file
  themselves into it. Filing a thread by hand always wins over a rule.
- Tag anything. Filter and search by tag.
- Add a private note to a thread. Notes are searchable.
- Deleting a folder unfiles its threads. It never deletes your notes or tags:
  the label goes, the work stays.

### Read, unread and catch-up

- Unread counts come from Torn, per thread.
- **Catch up** lists everything new since your last visit, grouped by folder.
- Mark one thread read, or all of them, to clear it from the list. This hides a
  thread from your catch-up view; it cannot clear Torn's own new-post counter,
  which only clears when you open the thread. The panel says so rather than
  pretending otherwise.

### My posts

- A **My posts** view lists the threads you started or posted in, whether or
  not you follow them, with the same row actions, filters and sort as Threads,
  plus `is:started` and `is:posted`.
- Threads you started carry Torn's own unread count. Threads you only posted in
  get a count made on your device, from the first time the script sees them,
  cleared by Mark read or by your own post, and labelled as a local count. A
  thread not looked up yet says so instead of showing zero.
- It fetches only when you open it, at most once every 15 minutes unless you
  press Refresh, and at most 12 requests by default.

### Drafts

- Write a reply, save it, come back days later. Drafts live on your device.
- On a thread page, insert a saved draft straight into the reply box. Where the
  reply box cannot be found, you get a Copy button and an explanation instead of
  a silent failure.
- Optional autosave of whatever is in the reply box, on by default. It reads
  your typing and keeps it locally so a long reply survives a stray navigation;
  one checkbox in Settings turns it off.

### Search

- Search titles, authors, forums, your notes and your tags.
- Search **inside post bodies** for chosen threads, cached so the second search
  is instant.
- One query syntax for both: bare words, `"quoted phrases"`, `by:username`,
  `tag:name`, `folder:name`, `is:unread`, `is:pinned`, `is:draft`, and a leading
  `-` to exclude any of them.
- **Search on Torn** hands the same query to Torn's own forum search. Torn
  understands `by:player words` but has never exposed a box for it, which
  players have asked for more than once.

### Backup

- Export folders, tags, pins, priorities, notes, read markers and drafts as one
  string, and import it in another browser.
- An export never carries your API key or the post cache.
- Import is additive and tells you what it changed before it changes it. A
  damaged string is refused by name and changes nothing.

## Install

### Desktop

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Install the script.
3. Visit <https://www.torn.com/forums.php>.
4. Open Settings in the panel and paste your Torn API key.

### Torn PDA (mobile)

1. Add the script through Torn PDA's own userscript manager.
2. Set injection time to **END**.
3. Open the forums in the app and add your key in Settings.

No separate mobile build exists. The same file runs in both places.

## Getting an API key

Torn, Settings, API Key.

The script reads two of your own selections, `forumsubscribedthreads` and
`forumfeed`, plus the public forum endpoints and, for My posts, the public
`forumthreads` and `forumposts` selections. Those two need a **Minimal
Access** key, which is the level to create. **Limited Access** also works but is
not needed. **Public Only** does not.

Do not give it a Full Access key. It has no use for one and will not ask again
if you give it less.

The key is stored in userscript storage on that device. It is masked in the
panel, excluded from exports, and stripped out of error messages and debug
reports before they can be shown or copied.

## Privacy and permissions

- Runs only on `forums.php`, enforced at runtime as well as in the metadata,
  because Torn PDA ignores `@match` and injects on every Torn page.
- Requests exactly three permissions: `GM_getValue`, `GM_setValue` and
  `GM_xmlhttpRequest`.
- `@connect` names exactly one host, `api.torn.com`. There are no third-party
  requests and no telemetry.
- Only ever sends GET requests. It never posts, replies, subscribes,
  unsubscribes, or changes anything at all on your account.
- Folders, tags, notes and drafts stay in userscript storage. Clearing ordinary
  Torn site data does not clear them; removing the script does.
- **Autosave reads what you type into Torn's reply box** and saves it as a local
  draft, so a long reply survives a stray navigation. It is on by default, it
  writes only to storage on your device, and nothing about it is ever
  transmitted. Turn it off with one checkbox in Settings.
- The Settings view states, next to the key input, exactly who can see your data
  (nobody), what it is used for, where it is stored, and what access level is
  needed. That is Torn's API terms requirement, and it belongs on screen rather
  than in a readme.

## How it stays inside Torn's rules

Torn's rule permits software only when it relies "on data from our API or from a
page that you have manually loaded and are actively viewing", and prohibits
making "additional non-API requests to Torn", scraping pages not currently being
viewed, bypassing CAPTCHA, extracting data from unfocused pages, generating
alerts, or drawing attention to itself or another window.

This script makes **no non-API requests to Torn at all**. Every request is a GET
to `api.torn.com`. The only thing it reads from the page is the address bar and
the page title, of the page you are already looking at.

It also takes **no action on your behalf**. There is no POST anywhere in it, no
simulated click, no form submission, and no navigation it starts by itself.
Inserting a saved draft types into the reply box and stops; you press Post.

A refresh is one action and at most 13 requests: two fixed calls, one forum-name
call at most once a day, and up to ten last-activity lookups for threads with
unread posts. Torn's API docs allow "up to 100 individual requests per minute
across all of their keys"; this holds itself to **40**, leaving room for whatever
else uses your key.

Auto refresh is off by default. When on, the shortest interval is two minutes and
it stops whenever the page is hidden **or unfocused**, so it never runs against a
window you are not using.

It generates no alerts, changes no title or favicon and opens no window. The one
focus call puts the caret in the reply box after you click Insert, inside the
page you are already on.

Torn's API terms also require that a disabled or invalid key is removed on
error, because retrying one risks a temporary IP ban. If Torn rejects the key,
the script stops using it immediately, remembers that across reloads, and tells
you to save a new one.

`docs/rules-compliance.md` has the full clause-by-clause check against both the
scripting rule and the API acceptable usage terms.

## Limitations

- **It cannot clear Torn's unread counter.** Marking read is a local dismissal.
  Only opening a thread on Torn clears Torn's own count.
- **It cannot notify you when your browser is closed.** No userscript can. The
  catch-up view is the honest substitute.
- Read state does not sync between devices. Use export and import.
- Last activity is not always exact. `forumsubscribedthreads` carries no
  timestamp, so it is resolved from the activity feed, a budgeted per-thread
  lookup, and your own visits, and each row tells you which one it used. A
  thread whose time cannot be resolved shows "unknown" rather than a guess.
- Deep search covers the pages it has fetched, up to five per thread, not the
  whole of a very long thread.
- Inserting a draft into the reply box depends on finding Torn's reply box. If
  Torn changes it, you get a Copy button and a message, not a silent failure.

## Development

```text
npm test                        # 249 tests, Node only, no browser
npm run test:syntax
node tests/mutation-check.mjs   # breaks each promise, checks a test notices
node tests/render-preview.mjs   # every view as standalone HTML, for looking at
```

Tests never modify the userscript on disk; see `tests/load-userscript.js`. The
mutation check does modify it, deliberately, and restores it — including on
being killed. Do not pipe its output into `head`.

Release is blocked on `docs/qa-checklist.md`, which has to be walked on a real
signed-in account on real hardware.

## License

MIT. See `LICENSE`.
