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
`user/forumposts`, `forum/{threadId}/thread`, `ForumThreadBase`,
`ForumThreadUserExtended`, `ForumPost` and `ForumFeedTypeEnum`, among others.
It is a schema, not a captured response: it says which fields Torn promises,
not what a live answer holds. Regenerate it from the full document if the
schema moves; do not edit it by hand.

## What is not here

The **scripting rule** itself. It was supplied verbatim by the project owner
from Torn's rules page and is quoted in full at the top of
`docs/rules-compliance.md`. No copy of that page was saved.

If either source is revised, re-save it here with a new date in the filename and
re-check `docs/rules-compliance.md` against it clause by clause. Keep the old
copy: it is the evidence for what the script was built against.
