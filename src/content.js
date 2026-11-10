// Content script: injects "download thumbnail" buttons across YouTube.
(() => {
  const BTN = "ytthumb-btn";
  const WATCH_BTN = "ytthumb-watch-btn";

  const ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M12 15.6 7.4 11l1.4-1.4 2.2 2.2V4h2v7.8l2.2-2.2 1.4 1.4L12 15.6ZM5 20v-2h14v2H5Z"/></svg>`;
  const CHECK = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="m9.6 17.2-5.3-5.3 1.4-1.4 3.9 3.9 8.7-8.7 1.4 1.4-10.1 10.1Z"/></svg>`;
  const ERROR = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M11 15h2v2h-2v-2Zm0-8h2v6h-2V7Zm1-5a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z"/></svg>`;

  // Thumbnail containers across old (ytd-thumbnail) and new (view-model) layouts.
  const THUMB_SELECTORS = [
    "ytd-thumbnail",
    "yt-thumbnail-view-model",
    "ytd-playlist-thumbnail",
    ".shortsLockupViewModelHostThumbnailContainer",
    "ytm-shorts-lockup-view-model .ShortsLockupViewModelHostThumbnailContainer",
  ].join(",");

  // Card containers used to find a title for the filename.
  const CARD_SELECTORS = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-playlist-video-renderer",
    "ytd-playlist-panel-video-renderer",
    "ytd-reel-item-renderer",
    "ytd-movie-renderer",
    "ytd-channel-video-player-renderer",
    "yt-lockup-view-model",
    "ytm-shorts-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2",
  ].join(",");

  const ID_RE = /^[\w-]{11}$/;

  function idFromUrl(href) {
    if (!href) return null;
    try {
      const u = new URL(href, location.origin);
      const v = u.searchParams.get("v");
      if (v && ID_RE.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
      if (m) return m[1];
      const img = u.pathname.match(/\/vi(?:_webp)?\/([\w-]{11})\//);
      if (img) return img[1];
    } catch {}
    return null;
  }

  function videoIdFor(thumb) {
    const a =
      thumb.closest("a[href]") ||
      thumb.querySelector("a[href]") ||
      thumb.closest(CARD_SELECTORS)?.querySelector("a[href*='watch?v='], a[href*='/shorts/']");
    const fromLink = idFromUrl(a?.getAttribute("href"));
    if (fromLink) return fromLink;
    const img = thumb.querySelector("img[src*='ytimg.com/vi']");
    return idFromUrl(img?.src);
  }

  function titleFor(thumb) {
    const card = thumb.closest(CARD_SELECTORS);
    if (card) {
      const el = card.querySelector(
        "#video-title, .yt-lockup-metadata-view-model__title, .ytLockupMetadataViewModelTitle, h3 a[title], h3 span, .shortsLockupViewModelHostMetadataTitle, h3"
      );
      const t = (el?.getAttribute("title") || el?.textContent || "").trim();
      if (t) return t;
    }
    const img = thumb.querySelector("img[alt]");
    const alt = img?.getAttribute("alt")?.trim();
    return alt && alt !== "true" ? alt : "";
  }

  function setState(btn, state) {
    btn.dataset.state = state;
    btn.querySelector(".ytthumb-icon").innerHTML =
      state === "done" ? CHECK : state === "error" ? ERROR : ICON;
  }

  async function triggerDownload(btn, videoId, title) {
    if (btn.dataset.state === "busy") return;
    setState(btn, "busy");
    try {
      const res = await chrome.runtime.sendMessage({ type: "ytThumb:download", videoId, title });
      if (!res?.ok) throw new Error(res?.error || "Download failed");
      btn.dataset.quality = res.quality;
      setState(btn, "done");
    } catch (e) {
      console.warn("[YT Thumbnail]", e);
      setState(btn, "error");
    }
    clearTimeout(btn._reset);
    btn._reset = setTimeout(() => setState(btn, "idle"), 1800);
  }

  // Swallow every event that could make YouTube navigate or start a hover preview.
  function guard(el) {
    for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "dblclick"]) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  function makeOverlayButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN;
    btn.title = "Download thumbnail";
    btn.setAttribute("aria-label", "Download thumbnail");
    btn.innerHTML = `<span class="ytthumb-icon">${ICON}</span>`;
    btn.dataset.state = "idle";
    guard(btn);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const host = btn.parentElement;
      if (!host) return;
      const { id, title } = btn.dataset.preview
        ? previewVideo(host)
        : { id: videoIdFor(host), title: titleFor(host) };
      if (!id) return setState(btn, "error");
      triggerDownload(btn, id, title);
    }, true);
    return btn;
  }

  function decorate(thumb) {
    // Skip tiny thumbnails (e.g. avatars, mini-guide) and those nested in another decorated one.
    if (thumb.querySelector(`:scope > .${BTN}`)) return;
    if (thumb.parentElement?.closest(`:has(> .${BTN})`)) return;
    if (thumb.closest("ytd-miniplayer, #video-preview")) return;
    thumb.appendChild(makeOverlayButton());
  }

  // ---- Hover inline preview: YouTube lays a player over the thumbnail, covering our button ----
  function ensurePreviewButton() {
    const preview = document.querySelector("#video-preview ytd-video-preview");
    if (!preview || preview.querySelector(`:scope > .${BTN}`)) return;
    const btn = makeOverlayButton();
    btn.dataset.preview = "1";
    preview.appendChild(btn);
  }

  function previewVideo(preview) {
    const a = preview.querySelector("a[href*='watch?v='], a[href*='/shorts/']");
    const id = idFromUrl(a?.getAttribute("href"));
    if (!id) return { id: null, title: "" };
    // Find the matching card on the page to get its title.
    const link = document.querySelector(
      `${CARD_SELECTORS.split(",").map((s) => `${s} a[href*="${id}"]`).join(",")}`
    );
    const thumb = link && (link.closest(THUMB_SELECTORS) || link.closest(CARD_SELECTORS)?.querySelector(THUMB_SELECTORS));
    return { id, title: thumb ? titleFor(thumb) : "" };
  }

  // ---- Watch page: pill button next to Like / Share ----
  function currentWatchId() {
    if (location.pathname === "/watch") return new URLSearchParams(location.search).get("v");
    return null;
  }

  function watchTitle() {
    return (
      document.querySelector("ytd-watch-metadata h1")?.textContent?.trim() ||
      document.title.replace(/\s*-\s*YouTube$/, "")
    );
  }

  function ensureWatchButton() {
    const id = currentWatchId();
    if (!id) return;
    const bar = document.querySelector("ytd-watch-metadata #top-level-buttons-computed");
    if (!bar) return;
    if (bar.querySelector(`.${WATCH_BTN}`)) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = WATCH_BTN;
    btn.title = "Download thumbnail";
    btn.setAttribute("aria-label", "Download thumbnail");
    btn.innerHTML = `<span class="ytthumb-icon">${ICON}</span><span class="ytthumb-label">Thumbnail</span>`;
    btn.dataset.state = "idle";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const vid = currentWatchId();
      if (vid) triggerDownload(btn, vid, watchTitle());
    });
    bar.appendChild(btn);
  }

  // ---- Shorts player: button in the vertical action bar ----
  function ensureShortsButton() {
    const m = location.pathname.match(/^\/shorts\/([\w-]{11})/);
    if (!m) return;
    const active =
      document.querySelector("ytd-reel-video-renderer[is-active]") ||
      document.querySelector("ytd-shorts");
    if (!active) return;
    const bar = active.querySelector("#actions, reel-action-bar-view-model, ytd-reel-player-overlay-renderer #actions");
    if (!bar || bar.querySelector(".ytthumb-shorts-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${WATCH_BTN} ytthumb-shorts-btn`;
    btn.title = "Download thumbnail";
    btn.setAttribute("aria-label", "Download thumbnail");
    btn.innerHTML = `<span class="ytthumb-icon">${ICON}</span>`;
    btn.dataset.state = "idle";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = location.pathname.match(/^\/shorts\/([\w-]{11})/)?.[1];
      const title = document.title.replace(/\s*-\s*YouTube$/, "").replace(/\s*#shorts$/i, "");
      if (id) triggerDownload(btn, id, title);
    });
    bar.prepend(btn);
  }

  // ---- Scan loop ----
  let scheduled = false;
  function scan() {
    scheduled = false;
    document.querySelectorAll(THUMB_SELECTORS).forEach(decorate);
    ensurePreviewButton();
    ensureWatchButton();
    ensureShortsButton();
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("yt-navigate-finish", schedule);
  window.addEventListener("yt-page-data-updated", schedule);
  scan();
})();
