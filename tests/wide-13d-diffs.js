'use strict';

// The owner-approved wide markup changes of spec section 13d, one literal
// replacement per audited item (the item numbers are the spec's audit table),
// applied to main's golden by tests/wide-parity.test.js.

const SVG_INFO = '<svg class="tfcc-gl" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">'
  + '<path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5v.5"/></svg>';

function INFO(key, label) {
  return '<button type="button" class="tfcc-info" data-act="info" data-info="' + key + '" aria-expanded="false"'
    + ' aria-controls="tfcc-info-' + key + '" aria-label="' + label + '">' + SVG_INFO + '</button>';
}

function HID(key, text) {
  return '<p class="tfcc-note tfcc-infotext" id="tfcc-info-' + key + '" hidden>' + text + '</p>';
}

module.exports = [
  {
    item: "2 Catch up", view: "catchup",
    from: "<button type=\"button\" data-act=\"catchup-done\">Set catch-up point to now</button></div><p class=\"tfcc-note\">Marking read here hides a thread from this list. It cannot clear Torn's own new-post counter, which only clears when you open the thread.</p>",
    to: "<button type=\"button\" data-act=\"catchup-done\">Set catch-up point to now</button>"
      + INFO("catchup", "About Catch up")
      + "</div>"
      + HID("catchup", "Marking read here hides a thread from this list. It cannot clear Torn's own new-post counter, which only clears when you open the thread."),
  },
  {
    item: "4 My posts", view: "mine",
    from: "<p class=\"tfcc-note\">Threads you started or posted in. Updated 4m ago.</p>",
    to: "<div class=\"tfcc-infobar\"><span class=\"tfcc-note\">Updated 4m ago.</span>"
      + INFO("mine", "About My posts")
      + "</div>"
      + HID("mine", "Threads you started or posted in. Opening My posts checks Torn again at most once every 15 minutes; Refresh always does."),
  },
  {
    item: "8 Search", view: "search",
    from: "Search on Torn</a></div><p class=\"tfcc-note\">Filtering searches titles, authors, forums, your notes and tags. Searching inside posts fetches up to 5 pages for each of the threads currently listed, then keeps them for next time. Search on Torn hands the same query to Torn's own forum search, which understands by:player but never shows you a box for it.</p>",
    to: "Search on Torn</a>"
      + INFO("search", "About Search")
      + "</div>"
      + HID("search", "Filtering searches titles, authors, forums, your notes and tags. Searching inside posts fetches up to 5 pages for each of the threads currently listed, then keeps them for next time. Search on Torn hands the same query to Torn's own forum search, which understands by:player but never shows you a box for it."),
  },
  {
    item: "11 Drafts", view: "drafts",
    from: "<p class=\"tfcc-note\">No reply box was found on this page, so Insert is unavailable. Copy puts the draft on your clipboard instead.</p>",
    to: "<p class=\"tfcc-note\">No reply box here, so Copy replaces Insert.</p>",
  },
  {
    item: "13 key note", view: "settings",
    from: "<p class=\"tfcc-note\">This script needs a key that can read your subscribed threads. On Torn, go to Settings, API Key, and create a <strong>Minimal Access</strong> key. A <strong>Limited Access</strong> key also works but is not needed. A <strong>Public Only</strong> key does not.</p>",
    to: "<p class=\"tfcc-note\">Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).</p>",
  },
  {
    item: "16 custom key", view: "settings",
    from: "<p class=\"tfcc-note\">This opens Torn's key page in a new tab with only the selections this script uses. You confirm the key there, then paste it here.</p>",
    to: "<p class=\"tfcc-note\">Opens Torn in a new tab with only this script's selections.</p>",
  },
  {
    item: "17 budget", view: "settings",
    from: "<p class=\"tfcc-note\">A refresh of Threads makes two requests, plus one for the forum list at most once a day. Opening My posts, or refreshing while it is open, makes two requests of its own, at most once every 15 minutes unless you press Refresh. Each activity lookup adds one more to either, and only runs for a thread with no recent time. My posts also reads the opening post of up to 5 threads you started, for their thumbs up and down, each at most once every 12 hours; with lookups set to 0 it reads none. If you have started no threads and written no posts, My posts instead reads your profile once for your forum karma, at most once every 12 hours, which is 3 requests in all. With the default of 10, a Threads refresh is at most 13 requests and My posts at most 17; at the largest setting of 25, 28 and 32. The script keeps itself under 40 requests a minute regardless.</p>",
    to: "<div class=\"tfcc-infobar\"><span class=\"tfcc-note\">A Threads refresh is at most 13 requests and My posts at most 17; never more than 40 a minute.</span>"
      + INFO("settings-budget", "About the request budget")
      + "</div>"
      + HID("settings-budget", "A refresh of Threads makes two requests, plus one for the forum list at most once a day. Opening My posts, or refreshing while it is open, makes two requests of its own, at most once every 15 minutes unless you press Refresh. Each activity lookup adds one more to either, and only runs for a thread with no recent time. My posts also reads the opening post of up to 5 threads you started, for their thumbs up and down, each at most once every 12 hours; with lookups set to 0 it reads none. If you have started no threads and written no posts, My posts instead reads your profile once for your forum karma, at most once every 12 hours, which is 3 requests in all. With the default of 10, a Threads refresh is at most 13 requests and My posts at most 17; at the largest setting of 25, 28 and 32. The script keeps itself under 40 requests a minute regardless."),
  },
  {
    item: "18 author-only", view: "settings",
    from: "<p class=\"tfcc-note\">With this on, a thread in Threads and Catch up counts as new only when its author has posted since you last looked. Each activity lookup then reads the thread's posts since you last looked, 20 at a time, newest first, instead of its last-post time. Each page is one lookup from the same allowance, so the cost does not change: with your setting of 10, a Threads refresh is at most 13 requests a refresh, on or off. A thread gets at most 3 pages, and only once every other thread has had its first. With more new posts than that, a count shows as a minimum (N+), or as \"not checked (too many new)\" when none of the posts read is by the author. Threads not checked yet show \"not checked\". My posts ignores this setting. Posts from before you started using this script are not flagged, and edits are not detected.</p>",
    to: "<div class=\"tfcc-infobar\"><span class=\"tfcc-note\">Costs no extra requests. Some threads may show &quot;not checked&quot;.</span>"
      + INFO("settings-author", "About author-only mode")
      + "</div>"
      + HID("settings-author", "With this on, a thread in Threads and Catch up counts as new only when its author has posted since you last looked. Each activity lookup then reads the thread's posts since you last looked, 20 at a time, newest first, instead of its last-post time. Each page is one lookup from the same allowance, so the cost does not change: with your setting of 10, a Threads refresh is at most 13 requests a refresh, on or off. A thread gets at most 3 pages, and only once every other thread has had its first. With more new posts than that, a count shows as a minimum (N+), or as \"not checked (too many new)\" when none of the posts read is by the author. Threads not checked yet show \"not checked\". My posts ignores this setting. Posts from before you started using this script are not flagged, and edits are not detected."),
  },
  {
    item: "19 rows shown", view: "settings",
    from: "<p class=\"tfcc-note\">Applies to Threads, Catch up and My posts. Search and Drafts always show everything. A capped list says how many it is hiding, and Show all lifts the cap for that list until the page reloads. The default is 5.</p>",
    to: "<div class=\"tfcc-infobar\"><span class=\"tfcc-note\">Applies to Threads, Catch up and My posts.</span>"
      + INFO("settings-rows", "About Rows shown")
      + "</div>"
      + HID("settings-rows", "Search and Drafts always show everything. A capped list says how many it is hiding, and Show all lifts the cap for that list until the page reloads. The default is 5."),
  },
  {
    item: "20 auto-hide", view: "settings",
    from: "data-act=\"auto-hide\" checked></div><p class=\"tfcc-note\">Only thread links in this panel do this, and only a plain click. Opening a link in a new tab, or following links on the Torn page itself, leaves the panel as it is. Press Show to bring it back.</p>",
    to: "data-act=\"auto-hide\" checked>"
      + INFO("settings-autohide", "About hiding the panel")
      + "</div>"
      + HID("settings-autohide", "Only thread links in this panel do this, and only a plain click. Opening a link in a new tab, or following links on the Torn page itself, leaves the panel as it is. Press Show to bring it back."),
  },
  {
    item: "21 folders", view: "settings",
    from: "<div class=\"tfcc-section\"><h4>Folders</h4><p class=\"tfcc-note\">A folder can claim a forum, and new subscriptions from that forum file themselves into it. Filing a thread by hand always wins over a rule.</p>",
    to: "<div class=\"tfcc-section\"><div class=\"tfcc-infobar\"><h4>Folders</h4>"
      + INFO("settings-folders", "About folders")
      + "</div>"
      + HID("settings-folders", "A folder can claim a forum, and new subscriptions from that forum file themselves into it. Filing a thread by hand always wins over a rule."),
  },
  {
    item: "23 backup", view: "settings",
    from: "<p class=\"tfcc-note\">An export carries folders, tags, pins, priorities, notes, read markers drafts and badges. It never carries your API key or the post cache.</p>",
    to: "<p class=\"tfcc-note\">Never includes your API key or the post cache.</p>",
  },
  {
    item: "25 debug", view: "settings",
    from: "<p class=\"tfcc-note\">A debug report carries the script version, the transport in use, counts and the last error. It never carries your key, your drafts, your notes or any post text.</p>",
    to: "<p class=\"tfcc-note\">Never includes your key, drafts, notes or post text.</p>",
  },
  {
    item: "26 badges", view: "settings",
    from: "<p class=\"tfcc-note\">Earned from what you do here: focused visits to threads, finishing Torn days with Catch up empty, and organising. A visit counts once a Torn day, after 15 seconds with the page in front of you. A day is a Torn day, from 00:00 TCT. Nothing is sent anywhere, and no request is made. Turning this off stops recording, and a streak does not survive days with it off.</p>",
    to: "<div class=\"tfcc-infobar\"><span class=\"tfcc-note\">Recorded on this device only. No request is made.</span>"
      + INFO("settings-badges", "About badges")
      + "</div>"
      + HID("settings-badges", "Earned from what you do here: focused visits to threads, finishing Torn days with Catch up empty, and organising. A visit counts once a Torn day, after 15 seconds with the page in front of you. A day is a Torn day, from 00:00 TCT. Nothing is sent anywhere, and no request is made. Turning this off stops recording, and a streak does not survive days with it off."),
  },
];
