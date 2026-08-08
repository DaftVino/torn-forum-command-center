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

Needs a Torn API key with **Minimal** access. Nothing else, and nothing leaves
your browser except the API calls themselves.

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

### Drafts

- Write a reply, save it, come back days later. Drafts live on your device.
- On a thread page, insert a saved draft straight into the reply box. Where the
  reply box cannot be found, you get a Copy button and an explanation instead of
  a silent failure.
- Optional autosave of whatever is in the reply box.

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
4. Open Settings in the panel and paste a Torn API key with Minimal access.

### Torn PDA (mobile)

1. Add the script through Torn PDA's own userscript manager.
2. Set injection time to **END**.
3. Open the forums in the app and add your key in Settings.

No separate mobile build exists. The same file runs in both places.

## Getting an API key

Torn, Settings, API Key. Create a key with **Minimal** access — that is the
lowest level that can read your own subscribed threads. Do not use a Full
Access key; this script has no use for one.

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

## How it stays inside Torn's rules

Torn allows a script to act on the official API, or on a page you have manually
loaded, with one input producing one request. It prohibits fetching pages you
are not looking at.

This script reads the official API and nothing else. A refresh is one action and
at most 13 requests: two fixed calls, one forum-name call at most once a day,
and up to ten last-activity lookups for threads that have unread posts. It holds
itself to 40 requests a minute against the roughly 100 the community reports, so
it leaves room for whatever else is using your key. Auto refresh is off by
default, and when on it pauses whenever the page is not visible.

It never reads a forum page you are not on.

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
