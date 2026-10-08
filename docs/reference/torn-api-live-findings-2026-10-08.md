# Torn API v2: live findings, 2026-10-08

Captured on 2026-10-08 with the owner present, using a Limited Access key
read from a local file and sent only in the `Authorization: ApiKey` header.
That took 20 requests. Every response used here is saved, redacted, in
`tests/fixtures/`:

- player ids are remapped to 1000 and up;
- usernames become `playerNNN`;
- titles, post content and every name are stripped;
- the profile is cut down to `karma`.

Thread ids are left in, because they are public. The OpenAPI schema used for
comparison is v6.13.8.

This note records **observed behaviour**. Where it disagrees with the OpenAPI
document, it wins until Torn changes the API. Re-run the probe and update this
note when that happens.

## Findings

| # | Finding | Evidence (fixture) | Plans affected |
|---|---|---|---|
| 1 | `user/forumthreads` returns `{ forumThreads: [...], _metadata: { links: { prev, next } } }`. Each row has `id, title, forum_id, posts, rating, views, author, last_poster, first_post_time, last_post_time, has_poll, is_locked, is_sticky, new_posts`. `new_posts` is present with a Limited key. | `user-forumthreads.json` | #2, #10 |
| 2 | `user/forumposts` returns `{ forumPosts: [...], _metadata }`. Each row has `id, thread_id, author, is_legacy, is_topic, is_edited, is_pinned, created_time, edited_by, has_quote, quoted_post_id, content, likes, dislikes`. | `user-forumposts.json` | #2, #10 |
| 3 | **A thread's `posts` counts replies, not posts.** Thread 16561608 reports `posts: 6206`, but its last page (offset 6200) holds 7 posts, so 6,207 posts exist. Thread 16505837 reports `posts: 0` and returns 1 post, the topic. This holds on `forum/{id}/thread` and `user/forumthreads`. | `forum-posts-large-last-page.json`; `forum-thread.json` | #2, #4 |
| 4 | **The subscribed-thread `posts.total` counts every post, including the topic.** Thread 16505837 shows `total: 1` there and `posts: 0` from `forum/{id}/thread`. The two sources differ by exactly 1, so any comparison between them must add 1 to the thread-side figure. | `user-forumsubscribedthreads.json` (the comparison was made live and is recorded here) | #2, #4 |
| 5 | Without `from`, `forum/{id}/posts` returns **oldest first, 20 per page**, with the topic post (`is_topic: true`) at offset 0. | `forum-posts-large-offset0.json`, `forum-thread-posts-asc.json` | #10 |
| 6 | **`sort` is ignored.** `sort=DESC` returned the same oldest-first page as no sort. | `forum-posts-large-sort-desc-ignored.json` | #10, #4 |
| 7 | **`limit` is ignored.** `limit=50` returned 20. The API's own `next` links do contain `limit=20&stripTags=true`. | `forum-posts-large-limit50-ignored.json` | #4, #10 |
| 8 | **With `from=<t>`, the endpoint returns the newest posts with `created_time >= t`, newest first, at most 20, and no `next` link.** `offset` is ignored when `from` is set: `from=t&offset=20` returned the same 20 posts. So a thread with more than 20 posts after `t` can only show its newest 20. | `forum-posts-large-from.json`, `forum-posts-large-from-offset20-ignored.json` | #4 |
| 9 | **`from` is inclusive.** In thread 16589908, `from` set exactly to the newest post's `created_time` returned that post. | `forum-thread-posts-from-small.json` | #4 |
| 10 | `last_poster` exists on thread objects, as `{ id, username, karma }`. | `forum-thread.json`, `user-forumthreads.json` | #2, #4 |
| 11 | Posts carry `is_edited` and `edited_by`, but **no edit timestamp**. | `user-forumposts.json` | #4 |
| 12 | **Karma agrees across sources.** `author.karma` on the owner's thread row, `author.karma` on the owner's post rows, and `profile.karma` all equal the same value. | `user-forumthreads.json`, `user-forumposts.json`, `user-profile-karma.json` | #10 |
| 13 | On the owner's thread 16589908, the topic post has `likes: 7, dislikes: 0` and the thread has `rating: 7`. That is consistent with `rating = likes - dislikes` on the topic post, but one sample with 0 dislikes cannot tell net from likes-only. | `forum-thread-posts-asc.json`, `forum-thread.json` | #10 |
| 14 | **`forum/categories` lists 43 forums.** | `forum-categories.json` | #9 |

## Still open

- Whether the thumbs shown on Torn's thread page equal the topic post's
  `likes` and `dislikes`, and whether the karma on the profile page equals the
  API value. The owner reads these off pages they open themselves; the answers
  are recorded below when given.
- Whether `rating` is net or likes-only. This needs a topic post with
  dislikes.
- What `type` means on `user/forumfeed` rows. Not probed.
- How deleted threads, private forums and `f=0` thread links behave. Not
  probed.

## Owner checks

| Check | API value | Page value | Match |
|---|---|---|---|
| Thumbs on the topic post of thread 16589908 | 7 up, 0 down | | |
| Karma on the owner's profile | (see fixture) | | |
