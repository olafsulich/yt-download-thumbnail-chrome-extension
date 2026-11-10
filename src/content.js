// Content script: injects "download thumbnail" buttons across YouTube.
(() => {
  const BTN = "ytthumb-btn";
  const WATCH_BTN = "ytthumb-watch-btn";

  // Icons from YouTube's own current icon set (fonts.gstatic.com/s/i/youtube_outline_experimental/*):
  // "image" (v8), "check" (v13), "alert_triangle" (v10). A picture, not a download arrow, so it
  // can't be mistaken for "download video".
  const svg = (d) =>
    `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
  const ICON = svg("M20 2H4a2 2 0 00-2 2v16a2 2 0 002 2h16a2 2 0 002-2V4a2 2 0 00-2-2ZM4 18.033V4h16v9.233l-2.456-1.473a3 3 0 00-2.906-.1l-.182.1L4 18.033ZM9 6a3 3 0 100 6 3 3 0 000-6Zm0 2a1 1 0 110 2 1 1 0 010-2Zm7.515 5.475L20 15.565V20H4.61l10.875-6.525.122-.063a1 1 0 01.908.063Z");
  const CHECK = svg("M19.793 5.793 8.5 17.086l-4.293-4.293a1 1 0 10-1.414 1.414L8.5 19.914 21.207 7.207a1 1 0 10-1.414-1.414Z");
  const ERROR = svg("M10.68 1.844 1.017 19.79a1.5 1.5 0 001.32 2.211h19.326a1.5 1.5 0 001.32-2.21L13.32 1.843c-.566-1.052-2.074-1.052-2.64 0ZM3.174 20 12 3.61 20.826 20H3.174ZM12 8a1 1 0 00-1 1v4.5a1 1 0 002 0V9a1 1 0 00-1-1Zm0 7.75a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5Z");

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

  let watchBtn = null;

  function makeWatchButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = WATCH_BTN;
    btn.title = "Download thumbnail";
    btn.setAttribute("aria-label", "Download thumbnail");
    btn.innerHTML = `<span class="ytthumb-icon">${ICON}</span>`;
    btn.dataset.state = "idle";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const vid = currentWatchId();
      if (vid) triggerDownload(btn, vid, watchTitle());
    });
    return btn;
  }

  // Keep the button at the end of the action row (after Share / Save / Thanks, before "⋯").
  // Logged-in layouts put those in #flexible-item-buttons, logged-out ones in #top-level-buttons-computed.
  function ensureWatchButton() {
    if (!currentWatchId()) return;
    const menu = document.querySelector("ytd-watch-metadata #actions ytd-menu-renderer");
    if (!menu) return;
    const flexible = menu.querySelector(":scope > #flexible-item-buttons");
    const topLevel = menu.querySelector(":scope > #top-level-buttons-computed");
    const hasFlexibleItems =
      flexible && [...flexible.children].some((c) => c !== watchBtn && c.getBoundingClientRect().width > 0);
    const target = hasFlexibleItems ? flexible : topLevel;
    if (!target) return;
    watchBtn ||= makeWatchButton();
    // Drop stale copies (e.g. left behind by a re-render).
    menu.querySelectorAll(`.${WATCH_BTN}`).forEach((b) => b !== watchBtn && b.remove());
    if (target.lastElementChild !== watchBtn) target.appendChild(watchBtn);
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
      wrap.append(btn);
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
