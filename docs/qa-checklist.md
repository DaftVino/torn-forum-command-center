# QA checklist

Automated tests cannot prove Torn PDA's real injection behaviour or Torn's live
API. Both matrices below must pass on the same build before release.

Run `npm test`, `npm run test:syntax` and `node tests/mutation-check.mjs` first.
Everything here assumes those are green.

You need a Torn API key that can read your subscribed threads. Make one at
Settings, API Key. Use a **Custom** key with only `forumsubscribedthreads` and
`forumfeed` ticked, which is the least access the script can work with, or a
**Limited Access** key. **Public Only** will not work.

## Before you start

- [ ] `npm test` passes, 259 or more tests, none skipped.
- [ ] `npm run test:syntax` passes.
- [ ] `node tests/mutation-check.mjs` reports every promise guarded, and
      `git status` is clean afterwards (the check edits the file in place).
- [ ] `@version`, `SCRIPT_VERSION`, `package.json` and the newest `CHANGELOG.md`
      heading all agree.

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
- [ ] Mark read hides the thread from catch-up. Torn's own counter is unchanged,
      as the panel says.
- [ ] A thread you unsubscribe from on Torn keeps its notes and tags and shows
      as not subscribed after the next refresh.

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
- [ ] Run `node tests/render-preview.mjs` then `node tests/contrast-audit.mjs`.
      Every preview must pass WCAG AA. This is what caught links in the Search
      and Drafts views falling back to the browser default blue, which reads as
      black against the dark panel.
- [ ] Keyboard only: tab through the panel. Focus is always visible.
- [ ] Import an export made on the other browser. The summary counts are right
      and existing local work is merged, not replaced.
- [ ] Import a deliberately damaged string. It is refused by name and changes
      nothing.
- [ ] Reset folders and tags. Drafts and the API key survive.
- [ ] Reset everything. The API key survives, as the button says.

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
- [ ] Confirm nothing is ever sent that would post, reply, subscribe or
      otherwise change the account.

## Sign-off

Release is blocked until every box above is ticked on the same build, on a real
signed-in account, on real hardware.
