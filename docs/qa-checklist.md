# QA checklist

Automated tests cannot prove Torn PDA's real injection behaviour or Torn's live
API. Both matrices below must pass on the same build before release.

Run `npm test`, `npm run test:syntax` and `node tests/mutation-check.mjs` first.
Everything here assumes those are green.

You need a Torn API key that can read your subscribed threads. Make one at
Settings, API Key. Use a **Minimal Access** key, which is the least access the
script can work with. A **Limited Access** key also works but is not needed.
**Public Only** will not work.

## Before you start

- [ ] `npm test` passes, 390 or more tests, none skipped.
- [ ] `npm run test:syntax` passes.
- [ ] `node tests/mutation-check.mjs` reports every promise guarded, and
      `git status` is clean afterwards (the check edits the file in place).
- [ ] `@version`, `SCRIPT_VERSION`, `package.json` and the newest `CHANGELOG.md`
      heading all agree.

## Custom key link (blocks release)

The link format in `CUSTOM_KEY_LINK_BASE` was verified by the owner on
2026-10-09 (#45): the link Torn generated matched `buildCustomKeyUrl()`
exactly, and `tests/custom-key.test.js` pins that string.

- [x] On torn.com/api.html, generate one custom key link (any selections) and
      copy it from the new tab before confirming anything. Compare it with the
      Settings button's link, "Create a custom key on Torn": same page, same
      hash, same parameter names for the step, the title and each section.
      If they differ, fix `CUSTOM_KEY_LINK_BASE` or `buildCustomKeyUrl` and
      re-run this section. **Verified by the owner, 2026-10-09: an exact
      match.**
- [ ] Click the button. Torn's key page opens in a new tab with the name
      "Forum Command Center" and exactly these selections pre-filled: `user`
      forumsubscribedthreads, forumfeed, forumthreads, forumposts, profile; `forum`
      categories, thread, posts.
      Nothing is created until you confirm it on Torn.
- [ ] Confirm the key, paste it into Settings, and check it against every
      endpoint: Refresh loads threads and the feed, forum names load, an
      activity lookup on an unread thread succeeds, a deep search fetches
      posts, and My posts loads. No access error anywhere.

## Torn PDA

Install or update through Torn PDA's own userscript manager and select injection
time **END**.

### Startup

- [ ] Cold-launch straight to Forums. A panel appears, says it is loading, then
      shows subscribed threads.
- [ ] Navigate into Forums from another Torn page without reloading. One panel.
- [ ] Open a thread, then go back to the forum index. Still one panel, and it
      does not reload everything.
- [ ] Navigate off Forums entirely. No panel follows onto the next page.
- [ ] Background the app for a few minutes, resume, and revisit Forums.
- [ ] Force-close and relaunch. Folders, tags, pins and drafts are all still
      there.

### The key

- [ ] With no key saved, the panel says so and makes no request.
- [ ] Paste a valid key, save. Threads load.
- [ ] Try a **Custom** key with only `forumsubscribedthreads` and `forumfeed`.
      It must work, because that is what the panel tells people to make.
- [ ] Try a **Public Only** key. It must fail with a message naming the two
      selections, not a raw error code.
- [ ] Paste a 15-character key. It is refused with a message about the shape,
      and nothing is saved.
- [ ] Paste a syntactically valid but wrong key. The error names it as an
      invalid key rather than showing a raw code.
- [ ] Clear the key. The panel returns to the prompt.
- [ ] If PDA's `###PDA-APIKEY###` substitution is configured, confirm the key is
      picked up without pasting one.

### Layout

- [ ] Portrait at the narrowest practical width: no clipping, no horizontal page
      scrolling, no control unreachable, nothing hidden under PDA's navigation.
- [ ] Landscape, same.
- [ ] Expand to takeover. It fills the viewport, scrolls inside itself, and the
      page behind it does not scroll sideways.
- [ ] Shrink again. The panel returns to its inline size.
- [ ] Collapse. Only the header remains, and Show brings it back.
- [ ] Rotate the device while in takeover mode.

### Narrow view (#33)

Walk on Torn PDA, portrait, on the narrowest phone you have, then landscape.

- [ ] The header is one line: logo, badge chip, then three icon buttons. Nothing
      wraps at 375, 320 or 280px wide. At 280px the chip's padding tightens.
- [ ] TalkBack/VoiceOver reads the header buttons as "Refresh", "Expand" and
      "Hide the panel". Collapsed, the third button shows the word "Show" and
      the unread count is a bare number read as "16 new".
- [ ] The nav is a 3 x 2 grid: Threads, Catch up, Search, Drafts, Settings, My
      posts (light grey, last). Counts are faint large numerals behind the
      labels; no label wraps. A screen reader reads "Threads, 16 new, 6
      subscribed".
- [ ] The first thread row is well up the first screen. Every button outside the
      header is at least a fingertip (44px) and none overlaps another.
- [ ] Tapping the filter field does not zoom the page (iOS). Filters opens Sort,
      Folder and Tag; its number counts the folder and tag filters.
- [ ] Catch up: the check mark on a row marks it read in one tap, and focus lands
      on the next row's check mark. The last row's moves focus to the previous
      row; the only row's moves focus to the "Catch up" heading. TalkBack says
      "Marked read. N left."
- [ ] Actions ("...") opens one drawer at a time with Pin, Mark read (not in
      Catch up), Draft, Archive, the priority stepper, Folder, Add tag and Note.
- [ ] Type a note in a drawer, then tap another row's Actions without pressing
      Enter. The note is saved AND the other drawer opens.
- [ ] Tapping Actions or the check mark never hides the panel. A plain tap on a
      thread title still opens it and auto-hides (#8), and the drawer is closed
      when you come back.
- [ ] Rotate to landscape: past about 616px the wide layout returns and every
      drawer, filter and explanation closes. Rotate back: narrow again.
- [ ] Expand, then Shrink: the layout follows the panel's width, not the
      screen's.
- [ ] My posts opens with the reaction totals on its first line. On desktop the
      pill is still in the nav, before My posts.
- [ ] Every info button opens its explanation under it and closes it again.
      Settings still shows the ToS table, the request-budget line and both
      privacy lines without opening anything. At default settings (Activity
      lookups per refresh = 10) the budget line reads "A Threads refresh is at
      most 13 requests and My posts at most 17; never more than 40 a minute.";
      set the lookups to 4 and it reads 7 and 10.
- [ ] Android system font at 200%: nothing clips or scrolls sideways; the header
      is still one line.

### Narrow polish (#39)

- [ ] Catch up: "Mark all read", "Set catch-up point to now" and the info
      button share one line at 375, 320 and 280px. Where the full labels would
      wrap they read "All read" and "Caught up" (#41). TalkBack
      still reads "Mark all read" and "Set catch-up point to now". At 200%
      system font the three stay on one row and the labels wrap inside them.
- [ ] Every list (Threads, Catch up, My posts, Search) shows each row's title,
      meta line and note as one line ending in "...". Opening the row's
      drawer shows all three in full; closing it cuts them again. TalkBack
      reads the whole title.
- [ ] A long title still opens its thread when tapped anywhere along its line.
- [ ] While a drawer is open its "..." button is an X; TalkBack reads "Close
      actions, expanded". Tap the X: the drawer closes.
- [ ] With a drawer open, tap a nav cell, the Unread button, another row's
      title, and empty panel space in turn (reopening it each time): each tap
      closes the drawer AND does its own job (switches view, filters, opens
      the thread).
- [ ] With a drawer open, tap one of Torn's own links outside the panel: the
      drawer closes and Torn's link opens as normal. Tap empty page space
      outside the panel: the drawer closes and nothing else happens.
- [ ] Type a note in a drawer, then tap outside the panel without pressing
      Enter: the note is saved and the drawer closes.
- [ ] The drawer shows a pin, a check mark, a pencil and an archive box (a
      box with a down arrow, #41) on one row, in white on the dark theme and
      black on the light theme (no color emoji). TalkBack reads them as "Pin" (or "Unpin"), "Mark read", "Draft"
      (or "Edit draft") and "Archive" (or "Unarchive"). A pinned row's pin
      button is underlined.
- [ ] The archive box archives, it does not delete: the thread leaves the list
      and comes back with Unarchive.
- [ ] The drawer's buttons, stepper, folder select and fields are visibly
      smaller than the nav and Actions buttons, still easy to hit, and tapping
      a field does not zoom the page (iOS).

### Clip titles and summaries (#41)

- [ ] Fresh install, or an install updated from before #41: Settings,
      Appearance shows "Clip titles and summaries that wrap" ticked, right
      after "Hide the panel when I open a thread", with no "Settings were
      damaged" warning. Its info button explains it.
- [ ] Phone, ticked: each row's title, meta line and note are one line ending
      in "..."; opening a row's actions shows them in full.
- [ ] Phone, unticked: titles, meta lines and notes wrap onto as many lines
      as they need, closed or open. Reload: it stays unticked.
- [ ] Desktop, ticked: a long title and a long note end in "..." on one line;
      hovering either shows the full text as a tooltip, and the title still
      opens its thread. The meta line still wraps.
- [ ] Desktop, unticked: long titles and notes wrap, exactly as before.

### Hide on opening a thread

- [ ] Fresh install: Settings shows "Hide the panel when I open a thread"
      already ticked (on by default since #30). Tap a thread in Threads: the
      thread opens and the panel shows only its header with Show.
- [ ] Reload the thread page: the panel is still collapsed.
- [ ] Show brings the panel back, and it stays open while you page through the
      thread and follow Torn's own links.
- [ ] In Expand (takeover), tap a thread in Catch up: takeover ends, the thread
      is readable, and the panel is collapsed. Show returns the inline panel.
- [ ] Repeat from Search (a thread row and a post hit) and from Drafts.
- [ ] Search on Torn does not collapse the panel.
- [ ] Long-press a thread link and open it in a new tab: the panel in this tab
      stays open.
- [ ] Tap the thread you are already on: the panel collapses.
- [ ] Untick the setting: tapping a thread leaves the panel open.

### The workspace

- [ ] Every sort mode reorders the list, and pinned threads stay at the top in
      all of them.
- [ ] A thread with no resolvable activity time shows "unknown" and sits at the
      bottom of the activity sort, not the top.
- [ ] Hovering or long-pressing the time shows which source it came from.
- [ ] Filter by folder, by tag, and by unread only. Combining them narrows.
- [ ] Type in the filter box: `by:someplayer`, `tag:x`, `is:unread`, a quoted
      phrase, and a `-negated` term.
- [ ] Pin, unpin, priority up and down, add a tag, file into a folder, archive
      and unarchive. Each survives a reload.
- [ ] Priority (#30): the number and the small + and - sit right after the
      thread title. Tapping + or - changes the number and does not open the
      thread or hide the panel. Pin a thread on desktop and at the narrowest
      PDA width: Pin becomes Unpin and the row is no taller than an unpinned
      row beside it.
- [ ] Mark read hides the thread from catch-up. Torn's own counter is unchanged,
      as the panel says.
- [ ] A thread you unsubscribe from on Torn keeps its notes and tags and shows
      as not subscribed after the next refresh.
- [ ] Fresh install: Settings, Rows shown reads 5 (the default since #30), and
      a list longer than five says "Showing 5 of N".
- [ ] Settings, Rows shown, 3. Threads shows three rows and "Showing 3 of N"
      with Show all. Show all lists every row. Show 3 only caps the list again.
- [ ] With Rows shown at 3, pin four threads. Threads shows three pinned rows.
- [ ] With Rows shown at 3, Unread only and a folder filter still narrow the
      list before the cap. The count in "Showing 3 of N" is the filtered total.
- [ ] Catch up and My posts each show three rows. The nav buttons still read
      the full counts.
- [ ] Search and Drafts show every row with Rows shown at 3.
- [ ] Click Show all, navigate to another forum page within forums.php, and
      come back. Still expanded. Reload the page. Capped again.
- [ ] Reload the page. Rows shown is still 3. Set it to All. No "Showing" line
      anywhere.

### Catch up

- [ ] Threads with new posts appear, grouped by folder.
- [ ] Mark all read empties it.
- [ ] Set catch-up point to now, then confirm nothing reappears until something
      actually moves.

### Drafts

- [ ] Open a thread. Type a draft, save it, navigate away and back. It is there.
- [ ] If a reply box is found, Insert puts the text into it and Torn's editor
      keeps the text after it re-renders. **This is the one that matters:** a
      plain value assignment would look right and then vanish.
- [ ] If no reply box is found, the panel says so and offers Copy instead.
- [ ] Autosave: type in Torn's reply box, navigate away, come back, and the
      draft is there.
- [ ] Delete a draft. It goes from both the thread view and the drafts list.

### Search

- [ ] Metadata search finds a thread by title, author, forum, your note and your
      tag.
- [ ] Search inside posts fetches, reports progress, and shows post hits newest
      first.
- [ ] Run the same deep search again. It is fast, because it is cached.
- [ ] `by:player words` finds a specific person's posts inside a thread.
- [ ] Search on Torn is a link, not a button. Middle-click it: it should open a new tab, which a scripted navigation could not do.
- [ ] Clear the post cache. The size drops to zero and folders are untouched.

### Interaction

- [ ] Click into the API key box and leave it. The caret stays. Type a full key
      without it disappearing. This is the regression that made the script
      unusable: the panel was redrawing about seven times a second.
- [ ] Type into a tag box and a note box on a thread row. Both hold the caret.
- [ ] Press every button twice in a row. None of them silently does nothing.
- [ ] Leave the panel open on a busy forum page for a minute without touching
      it. The panel must not visibly flicker or reflow.
- [ ] With auto refresh on, start typing in a box and wait past the interval.
      Your text survives, and the update appears once you click away.

### Failure behaviour

- [ ] Turn off connectivity and refresh. A named error appears with a retry, and
      the panel does not go blank.
- [ ] Restore connectivity and retry. It recovers.
- [ ] Refresh twice quickly. The second is ignored, not doubled.
- [ ] Leave the panel open with auto refresh at 2 minutes, background the app,
      and confirm it does not refresh while hidden.

### Privacy

- [ ] Copy the debug report and read every line. It must contain no API key, no
      draft, no note, no post text, no thread title and no thread id.
- [ ] Copy an export string and decode it. It must contain no API key and no
      cached posts.

### My posts

- [ ] My posts is the last nav button and sits at the right edge, in Dark,
      Light and Match Torn (toggle Torn's own theme while it is open).
- [ ] It is light grey with dark text in all three, and visibly pressed (bar
      under the label) when open.
- [ ] At the narrowest PDA width the nav is a 3 x 2 grid and My posts is still
      last and reachable.
- [ ] Opening it the first time loads your threads; the number of requests in
      the API key log (Torn Settings, API, key log) is at most 17 (12 for My
      posts itself plus up to 5 opening posts for thumbs, #10).
- [ ] Closing and reopening within 15 minutes makes no request (key log).
- [ ] A thread you started and do not follow appears with `started`.
- [ ] A thread you replied in and do not follow appears with `posted in`.
- [ ] Have a second account reply in a thread you **posted in** and do not
      follow; Refresh in My posts; it shows `1 new` with `local count`.
- [ ] Have a second account reply in a thread you **started** and do not
      follow; Refresh in My posts; it shows `1 new` with **no** `local count`
      note (Torn's `new_posts`). Open the thread on Torn, come back after 15
      minutes or press Refresh; it shows no count.
- [ ] Mark read on a thread you posted in, then subscribe to it on Torn and
      Refresh Threads; it shows no new until someone replies (the units agree).
- [ ] Mark read zeroes it, survives a reload, and the thread does **not**
      appear in Threads.
- [ ] Pin it; it now appears in Threads as not subscribed, and in My posts.
- [ ] Unread only in My posts shows only threads with new replies.
- [ ] `is:started`, `is:posted`, `by:`, `tag:` work in the filter box.
- [ ] A thread link with no known forum opens the right thread (spec open
      question 4, `f=0` links, not probed).
- [ ] Refresh in Threads makes no My posts request (key log).

Owner checks for the live API (spec "Prerequisite"; all block release):

- [x] With the **Minimal** key the script asks for, `user/forumthreads` and
      `user/forumposts` both answer, and note whether `new_posts` is present
      (the capture used a Limited key). **Verified by the owner, 2026-10-09:
      Minimal Access works.**
- [ ] With an account that has more than 20 posts: does `limit=100` return
      more than 20 rows? Record the answer under the spec's open question 2.
- [ ] If possible: a deleted thread, and a thread in a faction or private
      forum, in My posts (spec open questions 5 and 7; not probed).

### Author-only (#4)

- [ ] Turn on **Only flag new posts by the thread author** and confirm the
      counts read "by author" (row and header).
- [ ] Follow a busy thread where only others post: no badge, and nothing in
      Catch up.
- [ ] Have the author post (or find a thread where they did): "N new by
      author", and the thread is in Catch up.
- [ ] With Activity lookups set to 1, the other threads show
      "author: not checked", and Catch up lists them under "Not yet checked
      for author posts".
- [ ] On a thread with 21 to about 55 posts since the last visit, and Activity
      lookups above the number of unread threads: an exact "N new by author"
      or no badge (the walk reached the marker).
- [ ] On a thread with far more than 58 new posts: "N+ new by author" or
      "author: not checked (too many new)", never a bare count or nothing.
      Then open the thread on Torn and confirm the badge clears.
- [ ] Paste the debug report and note the request count of one refresh in the
      key log: it must not exceed 3 + Activity lookups.
- [ ] Open a thread, refresh at once: the last post you saw is not flagged as
      new (the inclusive `from` boundary).
- [ ] My posts shows the same counts with the setting on and off.
- [ ] Turn it off: Torn's counts come back at once.
- [ ] Record any deleted author post seen during QA (spec open question 6,
      deleted posts in `posts.total`, still open).

### Reactions tracker

Torn PDA and desktop (#10).

- [ ] Fresh install, before opening My posts: the line reads
      `- (thumbs up) - (thumbs down)` in the nav row, just before My posts,
      never 0. The thumbs are white on Dark and black on Light (#30).
- [ ] Open My posts. API key log: at most 17 requests for that open, and the
      `forum/<id>/posts` ones are only for threads you started.
- [ ] Pick a thread you started with visible thumbs. On Torn's thread page
      note thumbs up, thumbs down. In My posts its row shows the same
      `N up, M down`. If they differ, stop: file it against the spec (owner
      check 1, stop condition).
- [ ] A thread not yet checked shows `net +N` in its row, and the tracker
      says `net ... on K more`.
- [ ] If you have a started thread whose opening post has thumbs down: note
      its `net` figure before it is checked and its up and down after. Record
      whether `net` was up minus down or up alone (live finding 13, still open).
- [ ] Sum check: tracker up and down equal the sums of the row figures.
- [ ] Reopen My posts within 12 hours: no `forum/<id>/posts` request for a
      thread already checked (key log).
- [ ] Hover (desktop): the tooltip ends with the subscriber sentence.
- [ ] At the narrowest PDA width the tracker is the first line of My posts; on
      desktop it stays in the nav, before My posts.
- [ ] Collapse: the tracker is gone; Show brings it back.
- [ ] Tapping the tracker opens My posts.
- [ ] Dark, Light and Match Torn: readable in all three.
- [ ] After a day without opening My posts, the line shows `(1d ago)`.
- [ ] Karma: the endless-knot icon and a number follow the thumbs, with no word
      "karma" on screen. Before My posts has ever loaded it shows `-`, not 0.
- [ ] The icon takes the text color in Dark, Light and Match Torn (visible,
      not black on dark).
- [ ] The karma figure equals the karma on your Torn profile (owner check 2).
- [ ] A test account with no threads and no posts: opening My posts shows the
      karma alone, and the key log shows exactly 3 requests for that open
      (`user/profile` once); reopening within 12 hours shows no `user/profile`.
- [ ] A normal refresh of Threads makes no `user/profile` request.

## Desktop regression

Tampermonkey, on the same build.

- [ ] Direct load of `forums.php`, reload, sidebar navigation in and out, and
      browser back and forward all leave exactly one panel.
- [ ] Torn's React re-render does not stack a second panel.
- [ ] If Torn provides a known container, the panel mounts inline rather than in
      the fixed fallback.
- [ ] Light theme, dark theme, and Match Torn all render readable text on a
      readable background. No dark-on-dark, no white-on-white in any input.
- [ ] Open every dropdown. The options must be readable: on some platforms the
      popup is drawn by the OS and defaults to black on white.
- [ ] Set the theme to **Match Torn**, then switch Torn's own theme between
      light and dark from Torn's settings. The panel must follow immediately,
      without a reload and without losing whatever you had typed.
- [ ] Read the API key table in dark mode. Every answer must be readable; those
      cells used to take Torn's black.
- [ ] Run `node tests/render-preview.mjs` then `node tests/contrast-audit.mjs`.
      Every preview must pass WCAG AA. This is what caught links in the Search
      and Drafts views falling back to the browser default blue, which reads as
      black against the dark panel. It renders each view twice, the second time
      under a stylesheet that fights ours the way Torn's does; the plain
      previews were too clean to catch either color bug.
- [ ] Keyboard only: tab through the panel. Focus is always visible.
- [ ] With "Hide the panel when I open a thread" on: a plain click on a thread
      collapses the panel and opens the thread; Ctrl-click and middle-click open
      it in a new tab and leave this panel open; Tab to a thread link and press
      Enter collapses it. Reload: still collapsed. Untick: nothing collapses.
- [ ] Same, from takeover: takeover ends and the thread is readable.
- [ ] Import an export made on the other browser. The summary counts are right
      and existing local work is merged, not replaced.
- [ ] Import a deliberately damaged string. It is refused by name and changes
      nothing.
- [ ] Reset folders and tags. Drafts and the API key survive.
- [ ] Reset everything. The API key survives, as the button says, and My posts
      is empty until it is opened again.
- [ ] My posts: walk the Torn PDA "My posts" section on desktop.

## Rules compliance

See `docs/rules-compliance.md` for the rule text and the line-by-line check.

- [ ] Watch the network tab through a full session. Every request goes to
      `api.torn.com` and nowhere else.
- [ ] **Revoke or pause the key on Torn while the panel is open, then refresh.**
      The panel must say the key was refused, and must then make no further
      request at all: reload the page twice and confirm the network tab stays
      empty. Torn's API terms require a bad key to be dropped on error, and name
      a temporary IP ban as the penalty for retrying one.
- [ ] Save a fresh valid key. Requests resume immediately.
- [ ] With auto refresh on, switch to another window without hiding the tab
      (split screen, or another app over the top). No request fires while the
      window is unfocused.
- [ ] Confirm the Settings view shows the data table next to the key input.
- [ ] Confirm no request is made to any `torn.com` page the user is not viewing.
- [ ] Confirm a refresh with the default settings issues at most 13 requests.
- [ ] Confirm opening My posts with the default settings issues at most 17
      requests, and reopening it within 15 minutes issues none.
- [ ] Confirm nothing is ever sent that would post, reply, subscribe or
      otherwise change the account.

## Badges (#9)

Walk on Torn PDA and on desktop, signed in to a real account.

- [ ] Upgrade from the previous release: no "were damaged" notice, and no
      badges appear until you do something (no backfill).
- [ ] The cup chip sits right after the FCC logo in Dark, Light and
      Match Torn (toggle Torn's own theme while it is open).
- [ ] The FCC logo (#30) is crisp, about one text line tall, in its blue-grey
      `#5C768F` in both themes, and a screen reader names it "Forum Command
      Center".
- [ ] At the narrowest PDA width, portrait and landscape: Refresh, Expand and
      Hide stay together, in order, on the header's one line (#33); they shrink
      rather than wrap.
- [ ] Tap the cup itself, and the number: the shelf opens both times.
- [ ] Open a thread and keep it in front for 15 s: Focused thread visits goes
      up by 1 in the Settings catalogue. Leave after 5 s: it does not.
- [ ] Open a thread, switch to another app or tab for 30 s, come back for
      10 s: no visit. Five more seconds: one visit.
- [ ] Open the same thread again today: no change. Tomorrow (TCT): +1.
- [ ] Hide the panel, then open a thread: the chip still shows in the
      collapsed header, and an earned toast appears there.
- [ ] Two tabs on the same thread for 15 s: the count goes up by 1.
- [ ] A quiet day: the page-load refresh finds Catch up empty and the streak
      glyph fills.
- [ ] A busy day: the glyph stays an outline until Catch up is empty (Mark all
      read counts), then fills.
- [ ] Across 00:00 TCT: a check-in before and after midnight makes the streak
      grow by one.
- [ ] Settings, Badges: the list is collapsed by default, shows all 15 with how
      to earn each, and progress bars for the counted ones.
- [ ] Turn badges off: the chip disappears, and the debug report's counts do
      not move over a session.
- [ ] Export, Reset everything (badges gone, no toast storm), Import (badges
      back, and the notice says how many).
- [ ] Cartographer: Debug in Settings still reports `categories:` at or above
      15. It was 43 on 2026-10-08 (`docs/reference/torn-api-live-findings-2026-10-08.md`,
      finding 14). If Torn ever cuts the board below 15, revisit the
      threshold of 12.
- [ ] With a screen reader on (TalkBack in Torn PDA), an earned toast is
      announced once, or not at all, and never repeats on a redraw.

## Compact drawer and transparency (#43)

- [ ] On a phone (375 and 320px), open a row's actions: Pin, Mark read, Draft,
      Archive, the info icon, the priority number, + and - share one line;
      the info icon opens the priority explanation under that line.
- [ ] Tag and Note open the small box in the panel; the keyboard opens on
      its field. Save adds the tag or saves the note; Cancel and a tap
      elsewhere close it. In Torn PDA, the keyboard's Enter saves.
- [ ] A saved note shows as a bar under Note.
- [ ] My posts looks like the other nav buttons until it is the current view.
- [ ] Info icons have no box; hovering or opening one tints it.
- [ ] With "See-through background" on (the default), Torn's page shows
      through the panel's base and the thread rows only, in both themes;
      buttons, fields, pills, the shelf and the popup stay solid. Note how
      readable text is over the forum page behind it. Expand is solid.
- [ ] Turn "See-through background" off: the panel is solid, as before #43,
      and it stays off after a reload.
- [ ] Expand shows every row with no "Showing N of M" line; Shrink brings
      the cap back.

## Narrow Settings and forum claims (#47)

- [ ] On a phone (375, 320 and 280px), Settings scrolls noticeably shorter
      than before; items are still clearly separate, each label sits next to
      its control, and every checkbox, its label and its info icon share one
      line. Tapping a checkbox's label toggles it. Fields do not zoom on iOS.
- [ ] Settings, Folders: claim two forums for one folder. Each shows as a chip
      with an x; the other folders' menus no longer offer them.
- [ ] Remove one chip. Threads already filed in that folder stay there; a new
      subscription from that forum is no longer filed.
- [ ] A workspace from before #47 with one claimed forum shows it as one chip,
      with no "Folders and tags were damaged" notice.
- [ ] Export, Reset folders and tags, Import: every claim comes back.
- [ ] On a desktop, Settings looks as before, apart from the chips.

## Drafts editor (#58)

- [ ] 1. Insert a Markdown draft with every construct into a reply and a new
      thread. Press Post in the owner's test thread, then confirm the
      published post matches Preview. This settles what Torn keeps on save:
      quote; strike; italic; cell alignment; `table-wrap`.
- [ ] 2. The same Insert in Torn PDA (Android, and iOS if available). The
      synthetic paste must work in PDA's webview, otherwise the panel offers
      Copy.
- [ ] 3. Copy, then paste into Torn's editor: the styles survive.
- [ ] 4. Old drafts and settings from v0.2.2 load with no damage notice.
- [ ] 5. At 320px in PDA, the pill, toolbar, More drawer and pickers fit, with
      44px targets.
- [ ] 6. Fixed image links render after Post. Check each of these: a Drive
      file; a Dropbox file; an Imgur single image, as a JPG and as a GIF; a
      GitHub image; a Gyazo screenshot. A host that fails is moved to "not
      derivable" before release.

## Sign-off

Release is blocked until every box above is ticked on the same build, on a real
signed-in account, on real hardware.
