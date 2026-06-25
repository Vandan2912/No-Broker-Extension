# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page image/video viewer for NoBroker property listings. No build step, no
dependencies, no package.json — just static HTML/CSS/JS files served by a small Python
HTTP server.

## Running it

```
python3 server.py [port]   # defaults to 8123
```

Then open `http://localhost:<port>/`. There is no build/lint/test tooling in this repo.

## Architecture

**`server.py`** — a `ThreadingHTTPServer` subclassing `http.server.SimpleHTTPRequestHandler`
that serves the static files as-is, plus one extra route:

- `GET /api/property/<32-hex-char-id>` — proxies server-side to NoBroker's public
  property-detail API (`https://www.nobroker.in/api/v3/property/<id>`). This exists
  solely to dodge NoBroker's `*.nobroker.in`-only CORS policy; the browser calls this
  same-origin endpoint instead of calling NoBroker directly. The property id is validated
  with a strict regex before being interpolated into the upstream URL.

**`viewer.js`** — shared rendering code with no dependency on the input-panel/fetch flow,
exposed as `window.Viewer`. Owns the image grid, the lightbox (open/close/next/prev/resize/
rotate), the video section, and the map link. Per-image rotation state is tracked in a
`rotations[]` array parallel to `images[]`, applied via CSS `transform: rotate()` to both
the grid tile and the lightbox image for that index. Both `index.html` (live viewer) and
`bookmarks.html` (saved-property detail view) load this file and call into it
(`Viewer.setImageData`, `Viewer.renderVideos`, `Viewer.updateMapLink`,
`Viewer.initLightboxControls`) — keeping one implementation of the grid/lightbox instead
of duplicating it per page. Both pages must therefore provide the same element ids
(`#grid`, `#videoSection`, `#lightbox` and its children, `#count`, `#mapLink`) in their
markup, even if some are visually different (e.g. bookmarks list page hides them).

**`bookmarks.js`** — localStorage-backed CRUD for saved properties, exposed as
`window.Bookmarks` (`loadBookmarks`/`saveBookmarks`/`upsertBookmark`/`removeBookmark`/
`getBookmark`). Single key `nb-bookmarks` holds a JSON array; entries are keyed by `id`
(the property's 32-hex-char id when known, else the derived image hash) so saving the same
property twice updates in place rather than duplicating. Each entry stores the full
`photos`/`videoObjects` arrays (not just a thumbnail) so the bookmark detail view can
render the complete grid/lightbox purely from localStorage, with no network call.

**`app.js`** — landing-search + fetch logic for the live viewer (`index.html`), no
framework. The user pastes a NoBroker property URL; `extractPropertyId` (a `[0-9a-f]{32}`
regex) pulls the property id out of it, the page calls the proxy above, and the JSON
response is fed through `loadFromParsedJson`. Several `find*` functions walk the parsed
JSON recursively to locate what's needed regardless of where it lives in the payload
shape (NoBroker's API response shape isn't trusted to be stable across endpoints/listings):

- `findPhotosArray` — locates the array of photo objects (each has an `imagesMap` with
  `original`/`large`/`medium`/`thumbnail` filenames).
- `findSampleImageUrl` — finds any full CDN image URL already in the JSON so its parent
  folder can be reused as the base path for every other filename in `imagesMap`.
- `findAssetDomain` — fallback for when no `/images/` URL exists anywhere (e.g. the
  thumbnail field got repurposed to point at a video); finds any `*.nobroker.in` domain
  in the payload instead.
- `findVideoObjects` / `looksLikeVideo` — same recursive-search pattern, but for video
  units (`{ original, low, high, thumbnail }` paths under `videos/...`).
- `findLatLong` — recursively finds lat/lng fields (several possible key spellings, plus
  a combined `"lat,lng"` string fallback) to populate the "View on Map" link.
- `findPropertyInfo` — best-effort scrape of title/locality/city/address/price/deposit/
  BHK/bathrooms/area/furnishing/property type/owner-or-agent name+phone, trying several
  known key spellings per field since NoBroker's response shape varies by endpoint.
  Missing fields are simply omitted from the rendered property-info panel.

After a successful load, `app.js` keeps the derived state (`currentPropertyId`,
`currentAssetDomain`, `currentInfo`, `currentPhotos`, `currentVideoObjects`,
`currentSampleUrl`, `currentCoords`) in module scope so the "Save Property" button can
build a bookmark entry from whatever's currently displayed, via `Bookmarks.upsertBookmark`.

**`index.html`** — two view states on one page, toggled by the `hidden` attribute on
`#landing` vs `#viewerContent` (`showLanding`/`showViewer` in `app.js`): a centered,
Google-style search box (`#propertyUrlInput` + `#fetchUrlBtn`, link-only — no JSON paste,
no default sample data) is the initial/landing state; after a successful proxy fetch it
switches to the viewer state (Save Property button, property-info panel, video grid, image
grid, lightbox). Clicking the header brand (`#brandHome`) resets the header and returns to
the landing state. Loads `viewer.js`, `bookmarks.js`, then `app.js`. `data.js` (a sample
photos array) is no longer referenced by `index.html` — it's unused dead weight now, left
in the repo only because nothing currently requires deleting it.

**Note on `#landing`/`#viewerContent`'s CSS:** both use `display: flex`/`block` as their
base rule, so each needs an explicit `#id[hidden] { display: none; }` override — the
`[hidden]` attribute alone loses to an id selector with an explicit `display` value at
equal specificity once both rules are in the same stylesheet.

**`bookmarks.html`** + **`bookmarks-page.js`** — the saved-properties page. A single page
with two view states switched by a `?id=` query param (no router): with no `id`, renders
the bookmark list (cards with thumbnail/title/locality/price, a delete button per card,
and a "View All on Map" button that's only shown when ≥1 bookmark has coordinates — it
opens a Google Maps directions URL chaining every bookmark's lat/lng as a waypoint, since
that's the only no-API-key way to plot multiple distinct points on one Maps link); with an
`id`, looks up that bookmark and renders it through the same `viewer.js` grid/lightbox used
by `index.html`, entirely from localStorage data.

## Working in this codebase

- Keep the "no dependencies, no build step" property — this is meant to stay a drop-in
  static app.
- When extending the JSON auto-detection logic in `app.js`, follow the existing pattern:
  a recursive `find*(node, seen)` walker that guards against cycles via a `seen` Set and
  searches arrays/objects generically rather than hardcoding a JSON path, since NoBroker's
  API response shape varies between endpoints/listings.
