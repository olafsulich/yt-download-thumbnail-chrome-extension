// Content script: injects "download thumbnail" buttons across YouTube.
(() => {
  const BTN = "ytthumb-btn";
  const WATCH_BTN = "ytthumb-watch-btn";

  // Picture icon (not a download arrow) so it can't be mistaken for "download video".
  const ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M5 21a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5Zm0-2h14V5H5v14Zm1-2 3-4 2.25 3 3-4L18 17H6Zm2.5-7A1.5 1.5 0 1 1 8.5 7a1.5 1.5 0 0 1 0 3Z"/></svg>`;
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

  function isShortsUrl(href) {
    return /(^|\/\/[^/]+)\/shorts\//.test(href || "");
  }

  function videoFor(thumb) {
    const a =
      thumb.closest("a[href]") ||
      thumb.querySelector("a[href]") ||
      thumb.closest(CARD_SELECTORS)?.querySelector("a[href*='watch?v='], a[href*='/shorts/']");
    const href = a?.getAttribute("href");
    const isShort = isShortsUrl(href) || !!thumb.closest("ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-reel-item-renderer");
    const fromLink = idFromUrl(href);
    if (fromLink) return { id: fromLink, isShort };
    const img = thumb.querySelector("img[src*='ytimg.com/vi']");
    return { id: idFromUrl(img?.src), isShort };
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

  async function triggerDownload(btn, videoId, title, isShort = false) {
    if (btn.dataset.state === "busy") return;
    setState(btn, "busy");
    try {
      const res = await chrome.runtime.sendMessage({ type: "ytThumb:download", videoId, title, isShort });
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
      const { id, title, isShort } = btn.dataset.preview
        ? previewVideo(host)
        : { ...videoFor(host), title: titleFor(host) };
      if (!id) return setState(btn, "error");
      triggerDownload(btn, id, title, isShort);
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
    const href = a?.getAttribute("href");
    const id = idFromUrl(href);
    if (!id) return { id: null, title: "" };
    // Find the matching card on the page to get its title.
    const link = document.querySelector(
      `${CARD_SELECTORS.split(",").map((s) => `${s} a[href*="${id}"]`).join(",")}`
    );
    const thumb = link && (link.closest(THUMB_SELECTORS) || link.closest(CARD_SELECTORS)?.querySelector(THUMB_SELECTORS));
    return { id, title: thumb ? titleFor(thumb) : "", isShort: isShortsUrl(href) };
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

  // ---- Shorts player: button in the vertical action bar of every reel ----
  function shortsTitle() {
    const el =
      document.querySelector("ytd-reel-video-renderer[is-active] yt-shorts-video-title-view-model") ||
      document.querySelector("ytd-shorts yt-shorts-video-title-view-model");
    const t = el?.textContent?.trim();
    return t || document.title.replace(/\s*-\s*YouTube$/, "").replace(/\s*#shorts$/i, "");
  }

  function ensureShortsButtons() {
    if (!location.pathname.startsWith("/shorts/")) return;
    document.querySelectorAll("ytd-shorts reel-action-bar-view-model").forEach((bar) => {
      if (bar.querySelector(":scope > .ytthumb-shorts-action")) return;
      const wrap = document.createElement("div");
      wrap.className = "ytthumb-shorts-action";
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
        // The reel in view always owns the URL.
        const id = location.pathname.match(/^\/shorts\/([\w-]{11})/)?.[1];
        if (id) triggerDownload(btn, id, shortsTitle(), true);
      });
      const label = document.createElement("span");
      label.className = "ytthumb-shorts-label";
      label.textContent = "Thumbnail";
      wrap.append(btn, label);
      bar.prepend(wrap);
    });
  }

  // ---- Scan loop ----
  let scheduled = false;
  function scan() {
    scheduled = false;
    document.querySelectorAll(THUMB_SELECTORS).forEach(decorate);
    ensurePreviewButton();
    ensureWatchButton();
    ensureShortsButtons();
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
