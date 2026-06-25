# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page image/video viewer for NoBroker property listings. No build step, no
dependencies, no package.json — just `index.html` + `app.js` + `data.js` + `style.css`
served by a small Python HTTP server.

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

**`app.js`** — all client logic, no framework. The core idea: the user pastes either a
NoBroker property URL (fetched via the proxy above) or a raw JSON blob (a "photos" array,
or a full API response containing one buried somewhere in it). Several `find*` functions
walk the parsed JSON recursively to locate what's needed regardless of where it lives in
the payload shape:

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

Image URLs are built by concatenating a detected/derived `baseUrl` (the folder of one
known full image URL) with each photo's filename for the selected size. Per-image
rotation state is tracked in a `rotations[]` array parallel to `images[]`, applied via
CSS `transform: rotate()` to both the grid tile and the lightbox image for that index.

**`data.js`** — defines `window.IMAGE_DATA`, a sample photos array used as the default
content on page load (and pre-filled into the JSON textarea) before the user loads their
own data.

**`index.html`** — single page: a collapsible input panel (property URL fetch, or paste
JSON + optional manual sample-URL override), a video grid, an image grid, and a lightbox
overlay with size selector (thumbnail/medium/large/original) and rotation controls.

## Working in this codebase

- Keep the "no dependencies, no build step" property — this is meant to stay a drop-in
  static app.
- When extending the JSON auto-detection logic in `app.js`, follow the existing pattern:
  a recursive `find*(node, seen)` walker that guards against cycles via a `seen` Set and
  searches arrays/objects generically rather than hardcoding a JSON path, since NoBroker's
  API response shape varies between endpoints/listings.
