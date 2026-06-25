const DEFAULT_SAMPLE_URL =
  "https://images.nobroker.in/images/8a9f87836f833bfd016f839395360a8c/8a9f87836f833bfd016f839395360a8c_65182_699014_large.jpg";

// Matches a CDN image URL like https://assets.nobroker.in/images/<hash>/<file>.jpg
const IMAGE_URL_RE = /^(?:https?:)?\/\/[^/\s"]+\/images\/[^/\s"]+\/[^/\s"?#]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"]*)?$/i;

function looksLikePhoto(obj) {
  return !!(obj && typeof obj === "object" && obj.imagesMap && typeof obj.imagesMap === "object" &&
    (obj.imagesMap.original || obj.imagesMap.large || obj.imagesMap.medium || obj.imagesMap.thumbnail));
}

// The pasted JSON might be the bare array, or a full API response with the
// array buried at some path (e.g. data.photos) — search for it either way.
function findPhotosArray(node, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);

  if (Array.isArray(node)) {
    if (node.length > 0 && node.every(looksLikePhoto)) return node;
    for (const item of node) {
      const found = findPhotosArray(item, seen);
      if (found) return found;
    }
    return null;
  }
  for (const value of Object.values(node)) {
    const found = findPhotosArray(value, seen);
    if (found) return found;
  }
  return null;
}

// Search the same JSON for any string field that's already a full CDN image
// URL (e.g. thumbnailImage) — its folder gives us the base path for free.
function findSampleImageUrl(node, seen = new Set()) {
  if (typeof node === "string") return IMAGE_URL_RE.test(node) ? node : null;
  if (!node || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);

  const values = Array.isArray(node) ? node : Object.values(node);
  for (const value of values) {
    const found = findSampleImageUrl(value, seen);
    if (found) return found;
  }
  return null;
}

const KNOWN_ASSET_DOMAIN = "assets.nobroker.in";

// Some payloads have no /images/ URL anywhere (e.g. thumbnailImage gets
// repurposed to point at a video instead) — fall back to whatever
// nobroker.in domain shows up anywhere else in the JSON.
function findAssetDomain(node, seen = new Set()) {
  if (typeof node === "string") {
    const match = node.match(/^(?:https?:)?\/\/([^/\s"]+)\//);
    return match && /nobroker\.in$/i.test(match[1]) ? match[1] : null;
  }
  if (!node || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);

  const values = Array.isArray(node) ? node : Object.values(node);
  for (const value of values) {
    const found = findAssetDomain(value, seen);
    if (found) return found;
  }
  return null;
}

function toFiniteNumber(value) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// Search the pasted JSON for an object carrying latitude/longitude (any of
// the common key spellings) and return them as numbers.
function findLatLong(node, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);

  if (!Array.isArray(node)) {
    const lat = toFiniteNumber(node.latitude ?? node.lat);
    const lng = toFiniteNumber(node.longitude ?? node.lng ?? node.lon);
    if (lat !== null && lng !== null) return { lat, lng };

    // Fallback: a combined "lat,lng" string field (e.g. data.location).
    if (typeof node.location === "string") {
      const match = node.location.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
    }
  }
  const values = Array.isArray(node) ? node : Object.values(node);
  for (const value of values) {
    const found = findLatLong(value, seen);
    if (found) return found;
  }
  return null;
}

// videoUnit entries look like { original, low, high, thumbnail } where each
// value is either a full URL or a domain-less path like "videos/property/<hash>/<id>".
function looksLikeVideo(obj) {
  return !!(obj && typeof obj === "object" &&
    ["original", "low", "high", "thumbnail"].some((key) => typeof obj[key] === "string" && obj[key].includes("videos/")));
}

function findVideoObjects(node, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);

  if (Array.isArray(node)) {
    if (node.length > 0 && node.every(looksLikeVideo)) return node;
    for (const item of node) {
      const found = findVideoObjects(item, seen);
      if (found) return found;
    }
    return null;
  }
  for (const value of Object.values(node)) {
    const found = findVideoObjects(value, seen);
    if (found) return found;
  }
  return null;
}

// path may already be a full/protocol-relative URL, or a bare "videos/..." path.
function resolveVideoUrl(path, domain) {
  if (/^(?:https?:)?\/\//.test(path)) return path.startsWith("//") ? `https:${path}` : path;
  return `https://${domain}/${path.replace(/^\/+/, "")}`;
}

function renderVideos(videoObjects, domain) {
  const section = document.getElementById("videoSection");
  section.innerHTML = "";

  if (!videoObjects || !videoObjects.length) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  videoObjects.forEach((v) => {
    const path = v.high || v.original || v.low;
    if (!path) return;

    const wrapper = document.createElement("div");
    wrapper.className = "video-card";

    const video = document.createElement("video");
    video.controls = true;
    video.preload = "metadata";
    video.src = resolveVideoUrl(path, domain);
    if (v.thumbnail) {
      video.poster = resolveVideoUrl(v.thumbnail, domain);
    }
    wrapper.appendChild(video);

    section.appendChild(wrapper);
  });
}

function updateMapLink(coords) {
  const mapLink = document.getElementById("mapLink");
  if (coords) {
    mapLink.href = `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
    mapLink.hidden = false;
  } else {
    mapLink.hidden = true;
  }
}

let baseUrl = "";
let images = [];
let rotations = []; // rotation (deg) per image index, shared between grid tile and lightbox
let tileImgs = []; // <img> elements in the grid, indexed to match `images`
let currentIndex = 0;

// Strip the filename off a full sample URL, keeping everything up to and
// including the last "/" — that's the folder every imagesMap filename lives in.
function baseUrlFromSampleUrl(sampleUrl) {
  return sampleUrl.slice(0, sampleUrl.lastIndexOf("/") + 1);
}

function buildImageUrl(filename) {
  return `${baseUrl}${filename}`;
}

function render() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  tileImgs = [];

  images.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "card";

    const img = document.createElement("img");
    img.src = buildImageUrl(item.imagesMap.medium);
    img.loading = "lazy";
    img.alt = item.title || `Image ${index + 1}`;
    img.style.transform = `rotate(${rotations[index]}deg)`;
    img.addEventListener("click", () => openLightbox(index));
    card.appendChild(img);
    tileImgs.push(img);

    const rotateBtn = document.createElement("button");
    rotateBtn.className = "tile-rotate-btn";
    rotateBtn.innerHTML = "&#8635;";
    rotateBtn.setAttribute("aria-label", "Rotate image");
    rotateBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setRotation(index, 90);
    });
    card.appendChild(rotateBtn);

    if (item.displayPic) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Display Pic";
      card.appendChild(badge);
    }

    grid.appendChild(card);
  });

  document.getElementById("count").textContent = `${images.length} image${images.length === 1 ? "" : "s"}`;
}

function setRotation(index, deg) {
  rotations[index] = (rotations[index] + deg + 360) % 360;
  if (tileImgs[index]) {
    tileImgs[index].style.transform = `rotate(${rotations[index]}deg)`;
  }
  if (document.getElementById("lightbox").classList.contains("open") && currentIndex === index) {
    document.getElementById("lightbox-img").style.transform = `rotate(${rotations[index]}deg)`;
  }
}

function openLightbox(index) {
  currentIndex = index;
  document.getElementById("lightbox").classList.add("open");
  updateLightboxImage();
}

function closeLightbox() {
  document.getElementById("lightbox").classList.remove("open");
}

function showNext(delta) {
  currentIndex = (currentIndex + delta + images.length) % images.length;
  updateLightboxImage();
}

function updateLightboxImage() {
  const item = images[currentIndex];
  const size = document.getElementById("sizeSelect").value;
  const lightboxImg = document.getElementById("lightbox-img");
  lightboxImg.src = buildImageUrl(item.imagesMap[size]);
  lightboxImg.style.transform = `rotate(${rotations[currentIndex]}deg)`;
  document.getElementById("lightbox-counter").textContent = `${currentIndex + 1} / ${images.length}`;
}

// sampleUrl: one full image URL — its folder becomes the base for every imagesMap filename.
// data: the array of image objects.
function setImageData(sampleUrl, data) {
  baseUrl = baseUrlFromSampleUrl(sampleUrl);
  images = data || [];
  rotations = images.map(() => 0);
  render();
}

// Returns an error message string on failure, or null on success.
function loadFromParsedJson(parsed, sampleUrlInput) {
  const photos = findPhotosArray(parsed);
  if (!photos) {
    return "Couldn't find a photos array in that JSON (looked for objects with an imagesMap field).";
  }

  const assetDomain = findAssetDomain(parsed) || KNOWN_ASSET_DOMAIN;

  // Only honor the override field if the user actually typed into it
  // themselves — not if it's still holding the auto-detected URL we wrote
  // there for a *previous* (possibly different) property.
  const manualOverride = sampleUrlInput.value.trim();
  let sampleUrl = manualOverride && manualOverride !== sampleUrlInput.dataset.autoDetected
    ? manualOverride
    : findSampleImageUrl(parsed);

  if (!sampleUrl) {
    // No literal /images/ URL anywhere — reconstruct one from a photo's own
    // filename (hash is its first underscore-segment) plus the asset domain.
    const firstFilenames = photos[0]?.imagesMap || {};
    const firstFilename = firstFilenames.original || firstFilenames.large || firstFilenames.medium || firstFilenames.thumbnail;
    const hash = firstFilename && firstFilename.split("_")[0];
    if (hash) sampleUrl = `https://${assetDomain}/images/${hash}/${firstFilename}`;
  }
  if (!sampleUrl) {
    return "Couldn't find or derive a base image URL from that JSON — paste one in the URL field.";
  }

  setImageData(sampleUrl, photos);
  sampleUrlInput.value = sampleUrl;
  sampleUrlInput.dataset.autoDetected = sampleUrl;
  updateMapLink(findLatLong(parsed));
  renderVideos(findVideoObjects(parsed), assetDomain);
  document.getElementById("inputPanel").removeAttribute("open");
  return null;
}

// NoBroker property ids are 32 lowercase hex chars, appearing as a path
// segment in any property URL (e.g. .../detail/<id>/detail or .../<id>).
const PROPERTY_ID_RE = /[0-9a-f]{32}/i;

function extractPropertyId(url) {
  const match = url.match(PROPERTY_ID_RE);
  return match ? match[0] : null;
}

document.addEventListener("DOMContentLoaded", () => {
  const sampleUrlInput = document.getElementById("sampleUrlInput");
  const jsonInput = document.getElementById("jsonInput");
  const loadError = document.getElementById("loadError");
  const propertyUrlInput = document.getElementById("propertyUrlInput");
  const fetchUrlBtn = document.getElementById("fetchUrlBtn");

  jsonInput.value = JSON.stringify(window.IMAGE_DATA, null, 2);
  setImageData(DEFAULT_SAMPLE_URL, window.IMAGE_DATA);
  updateMapLink(findLatLong(window.IMAGE_DATA));
  renderVideos(findVideoObjects(window.IMAGE_DATA), KNOWN_ASSET_DOMAIN);

  document.getElementById("loadBtn").addEventListener("click", () => {
    loadError.textContent = "";
    let parsed;
    try {
      parsed = JSON.parse(jsonInput.value);
    } catch (err) {
      loadError.textContent = `Invalid JSON: ${err.message}`;
      return;
    }
    const error = loadFromParsedJson(parsed, sampleUrlInput);
    if (error) loadError.textContent = error;
  });

  fetchUrlBtn.addEventListener("click", async () => {
    loadError.textContent = "";
    const propertyId = extractPropertyId(propertyUrlInput.value.trim());
    if (!propertyId) {
      loadError.textContent = "Couldn't find a property id (32 hex chars) in that URL.";
      return;
    }

    fetchUrlBtn.disabled = true;
    fetchUrlBtn.textContent = "Fetching…";
    try {
      const res = await fetch(`/api/property/${propertyId}`);
      const parsed = await res.json();
      if (!res.ok) {
        loadError.textContent = `Server returned ${res.status}: ${parsed?.error || res.statusText}`;
        return;
      }
      jsonInput.value = JSON.stringify(parsed, null, 2);
      const error = loadFromParsedJson(parsed, sampleUrlInput);
      if (error) loadError.textContent = error;
    } catch (err) {
      loadError.textContent = `Fetch failed: ${err.message}`;
    } finally {
      fetchUrlBtn.disabled = false;
      fetchUrlBtn.textContent = "Fetch from URL";
    }
  });

  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("lightbox-prev").addEventListener("click", () => showNext(-1));
  document.getElementById("lightbox-next").addEventListener("click", () => showNext(1));
  document.getElementById("sizeSelect").addEventListener("change", updateLightboxImage);
  document.getElementById("rotate-left").addEventListener("click", () => setRotation(currentIndex, -90));
  document.getElementById("rotate-right").addEventListener("click", () => setRotation(currentIndex, 90));

  document.getElementById("lightbox").addEventListener("click", (e) => {
    if (e.target.id === "lightbox") closeLightbox();
  });

  document.addEventListener("keydown", (e) => {
    if (!document.getElementById("lightbox").classList.contains("open")) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") showNext(-1);
    if (e.key === "ArrowRight") showNext(1);
  });
});
