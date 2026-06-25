// Shared grid + lightbox + video + map rendering, used by both index.html
// (live paste/fetch flow) and bookmarks.html (rendering a saved bookmark).
// No dependency on the input-panel/fetch code in app.js.

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

function initLightboxControls() {
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
}

window.Viewer = {
  setImageData,
  renderVideos,
  updateMapLink,
  initLightboxControls,
  baseUrlFromSampleUrl,
  buildImageUrl,
};
