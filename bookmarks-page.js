// List + detail view logic for bookmarks.html. View is chosen by a ?id=
// query param: absent -> list view, present -> detail view for that bookmark.

function buildThumbUrl(bookmark) {
  const firstPhoto = bookmark.photos?.[0];
  if (!firstPhoto) return "";
  const base = Viewer.baseUrlFromSampleUrl(bookmark.sampleUrl);
  const filename = firstPhoto.imagesMap.medium || firstPhoto.imagesMap.thumbnail || firstPhoto.imagesMap.large;
  return `${base}${filename}`;
}

// Opens a Google Maps directions URL with the user's current location as the
// start point and every bookmark as a stop. Falls back to a stops-only route
// (no defined origin) if geolocation is unavailable or denied.
function openDirectionsFromCurrentLocation(stopsBookmarks) {
  const stops = stopsBookmarks.map((b) => `${b.lat},${b.lng}`).join("/");

  if (!navigator.geolocation) {
    window.open(`https://www.google.com/maps/dir/${stops}`, "_blank", "noopener");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const origin = `${position.coords.latitude},${position.coords.longitude}`;
      window.open(`https://www.google.com/maps/dir/${origin}/${stops}`, "_blank", "noopener");
    },
    () => {
      window.open(`https://www.google.com/maps/dir/${stops}`, "_blank", "noopener");
    },
  );
}

function renderList() {
  const bookmarks = Bookmarks.loadBookmarks();
  const listView = document.getElementById("listView");
  const grid = document.getElementById("bookmarksGrid");
  const empty = document.getElementById("emptyState");
  const mapAllBtn = document.getElementById("mapAllBtn");
  grid.innerHTML = "";

  empty.hidden = bookmarks.length > 0;
  grid.hidden = bookmarks.length === 0;

  const withCoords = bookmarks.filter((b) => b.lat != null && b.lng != null);
  mapAllBtn.hidden = withCoords.length === 0;
  mapAllBtn.onclick = () => openDirectionsFromCurrentLocation(withCoords);

  bookmarks.forEach((bookmark) => {
    const card = document.createElement("div");
    card.className = "card bookmark-card";

    const img = document.createElement("img");
    img.src = buildThumbUrl(bookmark);
    img.loading = "lazy";
    img.alt = bookmark.title || "Saved property";
    card.appendChild(img);

    const overlay = document.createElement("div");
    overlay.className = "bookmark-overlay";
    const title = bookmark.title || bookmark.locality || "Saved property";
    const subtitle = [bookmark.locality, bookmark.city].filter(Boolean).join(", ");
    overlay.innerHTML = `
      <div class="bookmark-title">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="bookmark-subtitle">${escapeHtml(subtitle)}</div>` : ""}
      ${bookmark.price != null ? `<div class="bookmark-price">&#8377;${escapeHtml(String(bookmark.price))}</div>` : ""}
    `;
    card.appendChild(overlay);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "tile-rotate-btn bookmark-delete-btn";
    deleteBtn.innerHTML = "&times;";
    deleteBtn.setAttribute("aria-label", "Remove bookmark");
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      Bookmarks.removeBookmark(bookmark.id);
      renderList();
    });
    card.appendChild(deleteBtn);

    card.addEventListener("click", () => {
      window.location.href = `bookmarks.html?id=${encodeURIComponent(bookmark.id)}`;
    });

    grid.appendChild(card);
  });

  listView.hidden = false;
}

function renderDetail(id) {
  const bookmark = Bookmarks.getBookmark(id);
  const detailView = document.getElementById("detailView");
  const notFound = document.getElementById("detailNotFound");

  if (!bookmark) {
    detailView.hidden = true;
    notFound.hidden = false;
    return;
  }

  notFound.hidden = true;
  detailView.hidden = false;

  Viewer.setImageData(bookmark.sampleUrl, bookmark.photos);
  Viewer.renderVideos(bookmark.videoObjects, bookmark.assetDomain);
  Viewer.updateMapLink(bookmark.lat != null && bookmark.lng != null ? { lat: bookmark.lat, lng: bookmark.lng } : null);

  const info = bookmark.info || {};
  const rows = [];
  if (bookmark.title) rows.push(`<h2 class="property-title">${escapeHtml(bookmark.title)}</h2>`);
  const locationParts = [info.address, bookmark.locality, bookmark.city].filter(Boolean);
  if (locationParts.length) rows.push(`<div class="property-location">&#128205; ${escapeHtml(locationParts.join(", "))}</div>`);

  const specs = [];
  if (bookmark.price != null) specs.push(`&#8377;${escapeHtml(String(bookmark.price))}`);
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

  const panel = document.getElementById("propertyInfo");
  panel.innerHTML = rows.join("");
  panel.hidden = rows.length === 0;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", () => {
  Viewer.initLightboxControls();

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (id) {
    document.getElementById("listView").hidden = true;
    renderDetail(id);
  } else {
    document.getElementById("detailView").hidden = true;
    document.getElementById("detailNotFound").hidden = true;
    renderList();
  }
});
