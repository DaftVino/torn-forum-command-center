# Image host link rules (2026-10-09)

Research for #58's image link fixer.

- **Source:** web search by an agent. Community and forum posts for the most
  part, plus a few vendor pages. No live URL was fetched and no URL was tested.
- **Every rule is "public docs"** with the confidence shown, except Google
  Drive, which the owner verified.
- **The fixer is a pure string rewrite** with no network lookup. A host whose
  direct URL cannot be computed from the page link gets an instruction instead.
- **FCC's Preview loads the result**, so the player sees at once whether a
  rewritten link works.

## Deterministic rewrites (the fixer converts these)

| Host | Input shapes | Rewrite | Caveats | Confidence |
|---|---|---|---|---|
| Google Drive | `drive.google.com/file/d/ID/view`, `/file/d/ID/edit`, `/file/u/N/d/ID/...`, `open?id=ID`, `uc?id=ID...` | `https://drive.google.com/thumbnail?id=ID&sz=w1000` | The file must be shared "Anyone with the link". The result is a resized thumbnail, 1000px wide. `uc?export=view` reportedly returns 403. Folders (`/drive/folders/`) and `docs.google.com` are not images | **Owner-verified** |
| Dropbox | `dropbox.com/s/ID/name.ext?dl=0`, `dropbox.com/scl/fi/ID/name.ext?rlkey=KEY&dl=0` | Same URL with `dl=0` or `dl=1` replaced by `raw=1`; `rlkey` is kept | The link must be public. `/scl/fo/` is a folder. `raw=1` redirects once | Medium |
| GitHub | `github.com/O/R/blob/REF/PATH`, `.../raw/REF/PATH`, `?raw=true` | `https://raw.githubusercontent.com/O/R/REF/PATH` | Public repositories only. SVG will not render (it is served as text). A user reports hotlinks rate-limited with 429 | Medium-high |
| Giphy | `giphy.com/gifs/slug-ID`, `giphy.com/embed/ID` | `https://media.giphy.com/media/ID/giphy.gif` | The ID is the part after the last hyphen | Medium |
| Gyazo | `gyazo.com/<32 hex>` | `https://i.gyazo.com/<hash>.png` | Right for screenshots. GIF and video captures use other extensions, so the picker also says "or use Share, Copy Direct Link" | Medium |
| Imgur, a single image | `imgur.com/ID` (not `/a/` or `/gallery/`) | `https://i.imgur.com/ID.png` | Unverified that Imgur serves any type under `.png`, and a GIF would lose its animation. **Owner QA item.** Imgur has been blocked in the UK since 2025-09-30, so UK readers see a broken image; the picker warns | Low-medium |
| Reddit media wrapper | `reddit.com/media?url=ENC` | the decoded inner URL | `i.redd.it` reportedly blocks embedding on other sites, so the picker warns | Low-medium |

## Not derivable (the picker shows an instruction)

| Host | Why | Instruction shown |
|---|---|---|
| Google Photos (`photos.app.goo.gl`, `photos.google.com/share/...`) | The image URL, `lh3.googleusercontent.com/pw/<token>`, is not in the link | Open the photo, right-click it, then Copy image address. It starts with `lh3.googleusercontent.com` |
| OneDrive (`1drv.ms`, `onedrive.live.com`, SharePoint) | A personal direct form is unreliable, and short links need a redirect | Open the image in OneDrive on the web, right-click it, then Copy image address. Or use another host |
| ImgBB (`ibb.co/ID`) | The direct URL needs the file name | On the ImgBB page, copy the "Direct link" field (`i.ibb.co/...`) |
| Postimages (`postimg.cc/ID`) | The same reason | Copy the "Direct link" (`i.postimg.cc/...`) |
| Imgur albums and galleries (`/a/`, `/gallery/`) | An album id is not an image id | Open the image, right-click it, then Copy image address (`i.imgur.com/...`) |
| Lightshot (`prnt.sc/ID`) | The image path holds a random token | Open the page, right-click the image, then Copy image address |
| Tenor (`tenor.com/view/...`) | The media path is a different hash from the id | Right-click the GIF, then Copy image address |

## Refused, with a warning

| Host | Why |
|---|---|
| Discord (`cdn.discordapp.com`, `media.discordapp.net`) | Links are signed and expire (`ex=`, `is=`, `hm=`, reportedly about 24h). The post's image would break. The warning says to upload to a lasting host. Torn players also report that Discord images stopped working |
| `http://` | Not `https`, so the picker refuses it |

## Always accepted as is

- `https://editor.torn.com/...`, Torn's own upload host. Owner-observed working.
- Any `https://` URL ending in `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp`.

## Not verified

- Imgur serving any type under `.png`.
- Whether the alternatives to Drive's `thumbnail` form work now:
  `lh3.googleusercontent.com/d/ID` and
  `drive.usercontent.google.com/download?id=...&export=view`.
- Dropbox `raw=1` on `/scl/fi/` links, inside an `<img>`.
- Discord's current expiry window.
- Whether Torn's `ProcessImagePlugin` rehosts external images. That is test D
  in the editor findings.
