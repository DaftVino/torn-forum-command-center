<p style="text-align:center"><img src="{{BANNER_URL}}" alt="Forum Command Center"></p>

<p style="text-align:center"><span style="font-size: 18px; color:#5C768F"><strong>Torn Forum Command Center</strong></span></p>

<p style="text-align:center"><em>Your followed threads, gathered into one calm, organised workspace.</em></p>

<p><span style="font-size: 16px; color:#5C768F"><strong>What it is</strong></span></p>

<p>Torn's subscribed-threads box is useful, but tiny. Forum Command Center turns it into a full workspace on the forums page, where you can organise the threads you follow, see what has changed, save reply drafts and find an old discussion without digging through tabs.</p>

<p>FCC reads Torn's official API with a <strong>Minimal Access</strong> key. It never posts, replies, votes, subscribes, unsubscribes or changes anything on your account. Your folders, tags, notes, drafts and settings stay on your device.</p>

<p><span style="font-size: 16px; color:#5C768F"><strong>Who it is for</strong></span></p>

<ul>
<li><strong>A faction leader</strong> follows guides, planning threads and faction discussions, then separates them into folders instead of keeping one long list.</li>
<li><strong>A script author</strong> watches replies to their own releases, checks opening-post thumbs and forum karma, and uses author-only mode for announcement threads.</li>
<li><strong>A trader</strong> keeps a small group of market threads pinned, tagged and ordered by personal priority.</li>
<li><strong>A casual player</strong> opens Catch up and sees what is new since the last visit, without rereading every followed thread.</li>
<li><strong>A Torn PDA player</strong> gets a narrow layout designed around a small screen, with compact navigation and row actions that remain within the panel.</li>
</ul>

<p><span style="font-size: 16px; color:#5C768F"><strong>Quick start</strong></span></p>

<ol>
<li><strong><a href="https://greasyfork.org/en/scripts/599453-torn-forum-command-center">Install Forum Command Center</a></strong> in Tampermonkey or Torn PDA.</li>
<li>Open <strong>Settings</strong> in FCC and choose <strong>Create a custom key on Torn</strong>. Torn's key page opens with a least-privilege key prepared for FCC; confirm it there.</li>
<li>Paste the new key into FCC and save it. That is it.</li>
</ol>

<p>Prefer to do it by hand? Create a Minimal Access key on Torn's API key page instead; it covers everything FCC reads.</p>

<p>The pre-filled selections are <strong>user:</strong> forumsubscribedthreads, forumfeed, forumthreads, forumposts, profile; <strong>forum:</strong> categories, thread, posts.</p>

<p><span style="font-size: 16px; color:#5C768F"><strong>Feature tour</strong></span></p>

<p><span style="color:#5C768F"><strong>Views</strong></span></p>

<ul>
<li><strong>Threads</strong> is the main workspace for subscribed and manually organised threads.</li>
<li><strong>Catch up</strong> gathers threads with new activity and groups them by folder.</li>
<li><strong>My posts</strong> shows threads you started or posted in, including ones you do not follow.</li>
<li><strong>Search</strong> searches thread details and, when requested, post bodies.</li>
<li><strong>Drafts</strong> collects saved replies and helps put them back into Torn's reply box.</li>
<li><strong>Settings</strong> controls the key, refreshing, appearance, folders, backup, storage and badges.</li>
</ul>

<p><span style="color:#5C768F"><strong>Folders and personal organisation</strong></span></p>

<ul>
<li>Create folders, reorder them and move the built-in <strong>Unfiled</strong> group wherever it suits you.</li>
<li>A folder can claim one or more forums so new subscriptions from those forums are filed automatically. A forum belongs to only one folder, and filing a thread by hand wins.</li>
<li>Folders organise only threads you subscribe to or file by hand. Claiming a forum does not add every thread from that forum.</li>
<li>Catch up follows your folder order, and each group can be collapsed without changing what Mark all read covers.</li>
<li>Add tags and private notes, pin important threads, adjust personal priority, or archive a thread without deleting its local work.</li>
</ul>

<p><span style="color:#5C768F"><strong>New, read and caught up</strong></span></p>

<ul>
<li>FCC shows Torn's unread count where Torn supplies one and keeps a local dismissal layer for Mark read.</li>
<li><strong>All read</strong> clears the current Catch up list locally. <strong>Caught up</strong> moves the catch-up point to now. Neither pretends to clear Torn's own counter; opening the thread on Torn does that.</li>
<li>Author-only mode flags a thread as new only when its author posts, which is useful for guides, scripts and announcements. Other replies do not count as author activity.</li>
<li>The Rows shown setting caps Threads, Catch up and My posts after filtering and sorting. Search and Drafts remain uncapped, while Expand shows every row in the capped views.</li>
</ul>

<p><span style="color:#5C768F"><strong>Appearance and everyday flow</strong></span></p>

<ul>
<li>FCC can hide itself when you open one of its thread links, leaving a small header with Show.</li>
<li>Long titles and summaries can be clipped to one line; opening row actions on a narrow panel reveals the full text.</li>
<li>The optional see-through background lets Torn's page show through the panel and its thread rows. Expand remains solid.</li>
<li>Match Torn is the default theme; Dark and Light are a tap away in Settings.</li>
</ul>

<p><span style="color:#5C768F"><strong>Made for narrow screens</strong></span></p>

<ul>
<li>The header becomes one line of scaling icon buttons, and view counts sit decoratively behind the navigation labels while remaining available to screen readers.</li>
<li>Each row has an actions drawer for pin, read, draft, archive, priority and folder controls.</li>
<li>Tag and note buttons open small in-panel editors, while bare info buttons explain controls without filling the screen with permanent help text.</li>
<li>Catch up keeps its read action close to each row, and the compact layout is based on the panel's width rather than merely the phone's width.</li>
</ul>

<p><span style="color:#5C768F"><strong>Your threads, reactions and badges</strong></span></p>

<ul>
<li>My posts tracks threads you started and threads you posted in. Started threads use Torn's supplied unread figure where available; other posted-in threads use a clearly labelled local count.</li>
<li>The reactions tracker reads the opening posts of started threads and shows checked thumbs up, thumbs down and your forum karma. Until a thread is checked, Torn's rating is shown only as <em>net</em>; FCC does not assume whether that value means net reactions or likes alone.</li>
<li>There are <strong>15 badges</strong> for setup, organisation, focused visits, explored forums, clearing a backlog and Catch up streaks.</li>
<li>Streaks advance by TCT (UTC) day. Badges are earned locally and make no request of their own.</li>
</ul>

<p><span style="color:#5C768F"><strong>Drafts, search and safekeeping</strong></span></p>

<ul>
<li>Reply drafts stay on your device. Reply-box autosave is on by default and can be disabled in Settings.</li>
<li>Insert places a saved draft into Torn's reply box when it is available. If FCC cannot find the box, it offers Copy and explains why.</li>
<li>Search covers titles, authors, forums, tags and notes. Deep search can fetch post bodies for chosen threads, cache them locally and combine text with filters such as author, folder, tag, unread, pinned or draft.</li>
<li>Search on Torn passes the query to Torn's own forum search as an ordinary link.</li>
<li>Export carries your organisation, read markers, drafts and badges as a portable string. It never includes the API key or post cache. Import merges it in and reports what it added; a damaged string is refused without changing anything.</li>
<li>Settings can produce a privacy-safe debug report for bug reports. It excludes the key, drafts, notes, post text, thread titles and thread IDs.</li>
<li>Auto refresh is optional and off by default. When enabled, it pauses while the page is hidden or the window is unfocused.</li>
</ul>

<p><span style="font-size: 16px; color:#5C768F"><strong>Privacy, safety and Torn's rules</strong></span></p>

<ul>
<li>FCC asks for <strong>Minimal Access</strong>. The key is stored on this device, masked in the panel, stripped from errors and debug reports, and never included in an export.</li>
<li>Every network request is a GET to api.torn.com. FCC makes no non-API Torn request and sends no telemetry.</li>
<li>A Threads refresh is at most 13 requests and My posts at most 17 at the default lookup setting; the limiter never allows more than 40 requests in a minute.</li>
<li>FCC does not scrape Torn's page data. Route capture uses the address and title of the page you are viewing. Beyond that it reads only the reply box, solely to save or insert drafts, and, for the default Match Torn theme, the page's background colour.</li>
<li>FCC never automates gameplay. It does not post, reply, vote, subscribe, navigate on its own or submit a form. You remain the person who opens threads and presses Torn's Post button.</li>
</ul>

<p><span style="font-size: 16px; color:#5C768F"><strong>Screenshots</strong></span></p>

<p style="text-align:center"><img src="{{SHOT_THREADS_URL}}" alt="Forum Command Center Threads view"></p>
<p style="text-align:center"><em>The main Threads workspace: followed discussions, filters and personal organisation in one place.</em></p>

<p style="text-align:center"><img src="{{SHOT_CATCHUP_URL}}" alt="Forum Command Center Catch up view"></p>
<p style="text-align:center"><em>Catch up groups new activity by folder, with a clear point for where your next visit begins.</em></p>

<p style="text-align:center"><img src="{{SHOT_MOBILE_URL}}" alt="Forum Command Center narrow mobile layout"></p>
<p style="text-align:center"><em>The narrow layout in Torn PDA, with compact navigation and row actions close at hand.</em></p>

<p style="text-align:center"><img src="{{SHOT_SETTINGS_URL}}" alt="Forum Command Center Settings view"></p>
<p style="text-align:center"><em>Settings keeps the key disclosure, appearance, folders, backup and local badges together.</em></p>

<p><span style="font-size: 16px; color:#5C768F"><strong>Feedback is welcome</strong></span></p>

<p>If something feels awkward, a count looks wrong, or you have an idea that would make the forum workspace calmer and more useful, please say so. Bug reports, Torn PDA observations and feature suggestions are all welcome.</p>

<p style="text-align:center"><span style="color:#5C768F"><strong>Follow the conversations you care about. Let FCC keep the desk tidy.</strong></span></p>
