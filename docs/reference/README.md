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
