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

// Best-effort scrape of human-useful property details (title, location, price,
// specs, owner/agent contact) from anywhere in the pasted JSON. Field names
// vary by NoBroker endpoint, so each field tries several known key spellings.
// Missing fields are simply omitted — this never throws or blocks rendering.
const PROPERTY_INFO_KEYS = {
  title: ["title", "propertyTitle"],
  locality: ["locality", "localityName", "society", "societyName"],
  city: ["city", "cityName"],
  address: ["address", "fullAddress"],
  price: ["price", "rentAmount", "expectedRent", "monthlyRent", "sellPrice"],
  deposit: ["deposit", "securityDeposit"],
  bhk: ["bedroomNum", "bhk"],
  bathrooms: ["bathroomNum", "bathroom"],
  area: ["buildupArea", "area", "superBuiltupArea"],
  furnishing: ["furnishing", "furnishingDesc"],
  propertyType: ["propertyType", "type"],
};
const CONTACT_NAME_KEYS = ["ownerName", "agentName", "name"];
const CONTACT_PHONE_KEYS = ["mobile", "phone", "contactNumber", "phoneNumber"];
const CONTACT_CONTAINER_KEYS = ["owner", "lessor", "agent", "contact", "primaryAgent"];

function firstNonEmpty(node, keys) {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function findPropertyInfo(node, info = {}, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return info;
  seen.add(node);

  if (!Array.isArray(node)) {
    for (const [field, keys] of Object.entries(PROPERTY_INFO_KEYS)) {
      if (info[field] == null) {
        const value = firstNonEmpty(node, keys);
        if (value != null && !(field === "title" && value === "multipart")) info[field] = value;
      }
    }
    if (!info.contactName || !info.contactPhone) {
      for (const containerKey of CONTACT_CONTAINER_KEYS) {
        const container = node[containerKey];
        if (container && typeof container === "object" && !Array.isArray(container)) {
          if (!info.contactName) {
            const name = firstNonEmpty(container, CONTACT_NAME_KEYS);
            if (name) info.contactName = name;
          }
          if (!info.contactPhone) {
            const phone = firstNonEmpty(container, CONTACT_PHONE_KEYS);
            if (phone) info.contactPhone = phone;
          }
        }
      }
    }
  }

  const values = Array.isArray(node) ? node : Object.values(node);
  for (const value of values) {
    findPropertyInfo(value, info, seen);
  }
  return info;
}

function hasPropertyInfo(info) {
  return info && Object.keys(info).length > 0;
}

function renderPropertyInfo(info) {
  const panel = document.getElementById("propertyInfo");
  if (!hasPropertyInfo(info)) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  const rows = [];
  if (info.title) rows.push(`<h2 class="property-title">${escapeHtml(info.title)}</h2>`);

  const locationParts = [info.address, info.locality, info.city].filter(Boolean);
  if (locationParts.length) rows.push(`<div class="property-location">&#128205; ${escapeHtml(locationParts.join(", "))}</div>`);

  const specs = [];
  if (info.price != null) specs.push(`&#8377;${escapeHtml(String(info.price))}${info.deposit != null ? "" : "/mo"}`);
  if (info.deposit != null) specs.push(`Deposit &#8377;${escapeHtml(String(info.deposit))}`);
  if (info.bhk != null) specs.push(`${escapeHtml(String(info.bhk))} BHK`);
  if (info.bathrooms != null) specs.push(`${escapeHtml(String(info.bathrooms))} Bath`);
  if (info.area != null) specs.push(`${escapeHtml(String(info.area))} sqft`);
  if (info.furnishing) specs.push(escapeHtml(String(info.furnishing)));
  if (info.propertyType) specs.push(escapeHtml(String(info.propertyType)));
  if (specs.length) rows.push(`<div class="property-specs">${specs.map((s) => `<span>${s}</span>`).join("")}</div>`);

  if (info.contactName || info.contactPhone) {
    const contactParts = [info.contactName, info.contactPhone].filter(Boolean).map(escapeHtml);
    rows.push(`<div class="property-contact">&#128222; ${contactParts.join(" &middot; ")}</div>`);
  }

  panel.innerHTML = rows.join("");
  panel.hidden = rows.length === 0;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

let currentPropertyId = null;
let currentAssetDomain = KNOWN_ASSET_DOMAIN;
let currentInfo = {};
let currentPhotos = [];
let currentVideoObjects = null;
let currentSampleUrl = "";
let currentCoords = null;

// NoBroker property ids are 32 lowercase hex chars, appearing as a path
// segment in any property URL (e.g. .../detail/<id>/detail or .../<id>).
const PROPERTY_ID_RE = /[0-9a-f]{32}/i;

function extractPropertyId(url) {
  const match = url.match(PROPERTY_ID_RE);
  return match ? match[0] : null;
}

// Search the pasted JSON itself (not just a URL) for a 32-hex-char id, e.g. a
// "propertyId" field — used as a fallback when no URL is available.
function findPropertyIdInJson(node, seen = new Set()) {
  if (typeof node === "string") return PROPERTY_ID_RE.test(node) ? node.match(PROPERTY_ID_RE)[0] : null;
  if (!node || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);

  const values = Array.isArray(node) ? node : Object.values(node);
  for (const value of values) {
    const found = findPropertyIdInJson(value, seen);
    if (found) return found;
  }
  return null;
}

// Returns an error message string on failure, or null on success.
function loadFromParsedJson(parsed) {
  const photos = findPhotosArray(parsed);
  if (!photos) {
    return "Couldn't find any photos in that property's data.";
  }

  const assetDomain = findAssetDomain(parsed) || KNOWN_ASSET_DOMAIN;

  let sampleUrl = findSampleImageUrl(parsed);
  let hash = null;
  if (!sampleUrl) {
    // No literal /images/ URL anywhere — reconstruct one from a photo's own
    // filename (hash is its first underscore-segment) plus the asset domain.
    const firstFilenames = photos[0]?.imagesMap || {};
    const firstFilename = firstFilenames.original || firstFilenames.large || firstFilenames.medium || firstFilenames.thumbnail;
    hash = firstFilename && firstFilename.split("_")[0];
    if (hash) sampleUrl = `https://${assetDomain}/images/${hash}/${firstFilename}`;
  }
  if (!sampleUrl) {
    return "Couldn't derive an image URL from that property's data.";
  }

  const coords = findLatLong(parsed);
  const videoObjects = findVideoObjects(parsed);
  const info = findPropertyInfo(parsed);

  Viewer.setImageData(sampleUrl, photos);
  Viewer.updateMapLink(coords);
  Viewer.renderVideos(videoObjects, assetDomain);
  renderPropertyInfo(info);

  currentPropertyId = findPropertyIdInJson(parsed) || (hash ? hash : null);
  currentAssetDomain = assetDomain;
  currentInfo = info;
  currentPhotos = photos;
  currentVideoObjects = videoObjects;
  currentSampleUrl = sampleUrl;
  currentCoords = coords;

  return null;
}

function saveCurrentProperty() {
  if (!currentPhotos.length) return "Nothing loaded to save yet.";

  const id = currentPropertyId || currentSampleUrl;
  Bookmarks.upsertBookmark({
    id,
    title: currentInfo.title || "",
    locality: currentInfo.locality || "",
    city: currentInfo.city || "",
    price: currentInfo.price ?? null,
    sampleUrl: currentSampleUrl,
    assetDomain: currentAssetDomain,
    photos: currentPhotos,
    videoObjects: currentVideoObjects,
    lat: currentCoords?.lat ?? null,
    lng: currentCoords?.lng ?? null,
    info: currentInfo,
    savedAt: Date.now(),
  });
  return null;
}

function showLanding() {
  document.getElementById("landing").hidden = false;
  document.getElementById("viewerContent").hidden = true;
}

function showViewer() {
  document.getElementById("landing").hidden = true;
  document.getElementById("viewerContent").hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  Viewer.initLightboxControls();

  const loadError = document.getElementById("loadError");
  const propertyUrlInput = document.getElementById("propertyUrlInput");
  const fetchUrlBtn = document.getElementById("fetchUrlBtn");
  const newSearchError = document.getElementById("newSearchError");
  const newSearchInput = document.getElementById("newSearchInput");
  const newSearchBtn = document.getElementById("newSearchBtn");
  const saveBtn = document.getElementById("saveBtn");
  const saveStatus = document.getElementById("saveStatus");
  const brandHome = document.getElementById("brandHome");

  async function search(input, errorEl, button) {
    errorEl.textContent = "";
    const propertyId = extractPropertyId(input.value.trim());
    if (!propertyId) {
      errorEl.textContent = "Paste a valid NoBroker property link.";
      return;
    }

    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "Searching…";
    try {
      const res = await fetch(`/api/property/${propertyId}`);
      const parsed = await res.json();
      if (!res.ok) {
        errorEl.textContent = `Server returned ${res.status}: ${parsed?.error || res.statusText}`;
        return;
      }
      const error = loadFromParsedJson(parsed);
      if (error) {
        errorEl.textContent = error;
        return;
      }
      saveStatus.textContent = "";
      saveBtn.classList.remove("saved");
      propertyUrlInput.value = input.value;
      newSearchInput.value = input.value;
      showViewer();
    } catch (err) {
      errorEl.textContent = `Search failed: ${err.message}`;
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  fetchUrlBtn.addEventListener("click", () => search(propertyUrlInput, loadError, fetchUrlBtn));
  propertyUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search(propertyUrlInput, loadError, fetchUrlBtn);
  });

  newSearchBtn.addEventListener("click", () => search(newSearchInput, newSearchError, newSearchBtn));
  newSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search(newSearchInput, newSearchError, newSearchBtn);
  });

  saveBtn.addEventListener("click", () => {
    saveStatus.textContent = "";
    const error = saveCurrentProperty();
    saveBtn.classList.toggle("saved", !error);
    saveStatus.textContent = error || "Saved ✓";
  });

  brandHome.addEventListener("click", () => {
    propertyUrlInput.value = "";
    newSearchInput.value = "";
    loadError.textContent = "";
    newSearchError.textContent = "";
    saveBtn.classList.remove("saved");
    document.getElementById("count").textContent = "";
    document.getElementById("mapLink").hidden = true;
    showLanding();
  });
  brandHome.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") brandHome.click();
  });
});
