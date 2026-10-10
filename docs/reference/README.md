# Reference material

Primary sources that cannot be fetched again by any automated route. Torn's
rules page, its wiki and its API documentation all refuse automated requests,
and Cloudflare blocks at the origin rather than at the client, so proxies and
archives fail too. These were saved from a signed-in browser.

## `torn-api-docs-2026-08-08.html`

Torn's API documentation as it stood on 2026-08-08. Every quotation in
`docs/rules-compliance.md` from the acceptable usage terms comes from this file:
the 100-requests-per-minute limit, the requirement to remove disabled or invalid
keys on error, the terms-of-service disclosure requirement, and the statement
that the API is read-only.

It is the HTML only. The saved page's copies of Bootstrap and jQuery were not
kept, so it opens unstyled - but every word of the terms is in this file, which
is what it is here for. The access-level table is colour-coded rather than
labelled, and the legend maps `white` to Public, `green` to Minimal Access,
`yellow` to Limited Access and `red` to Full Access.

## `torn-openapi-forum-excerpt-2026-10-08.json`

An unedited excerpt of Torn's published OpenAPI document
(`https://www.torn.com/swagger/openapi.json`, `info.version` 6.13.8), fetched
on 2026-10-08. Unlike the page above, this one answered an automated request.
It keeps only the forum paths, schemas and parameters that issue #10 (thread
reactions tracker) and issue #2 (My posts) rely on: `user/forumthreads`,
`user/forumposts`, `forum/{threadId}/thread`, `forum/{threadId}/posts`,
`ForumThreadBase`, `ForumThreadUserExtended`, `ForumThreadAuthor` (with its
`karma`), `ForumPost`, `ForumPostsResponse` and `ForumFeedTypeEnum`, plus the
`offset` and `sort` parameters, among others. It also carries `user/profile`
and `profile.karma` (the schema pruned to that one property), for the forum
karma fallback.
It is a schema, not a captured response: it says which fields Torn promises,
not what a live answer holds. Regenerate it from the full document if the
schema moves; do not edit it by hand.

## `karma-endless-knot.svg`

Supplied by the owner, 2026-10-08, used as the karma icon.

## What is not here

The **scripting rule** itself. It was supplied verbatim by the project owner
from Torn's rules page and is quoted in full at the top of
`docs/rules-compliance.md`. No copy of that page was saved.

If either source is revised, re-save it here with a new date in the filename and
re-check `docs/rules-compliance.md` against it clause by clause. Keep the old
copy: it is the evidence for what the script was built against.

## Live findings

`torn-api-live-findings-2026-10-08.md` records how the live API v2 behaved on
2026-10-08, where it differs from the OpenAPI document, and which plans each
finding affects. The redacted responses behind it are in `tests/fixtures/`.

## Forum editor (#58)

- `torn-forum-post-sample.html` is a real published post supplied by the owner.
  Its header lists the markup conventions it shows.
- `torn-forum-editor-findings-2026-10-09.md` records what Torn's forum editor
  is: TinyMCE 6.8.5 inline, with 17 `--te-text-color-*` variables. It also
  records what survives paste and what images need. Every claim is marked
  owner-observed or public docs.
- `torn-forum-editor-probe.js` produced the owner-observed half.
  - It is a read-only DevTools snippet the owner pastes into the Console on a
    page they opened themselves. It clicks, types and sends nothing.
  - It is never run by automation, and is not part of the userscript.
