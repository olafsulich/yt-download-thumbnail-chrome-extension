// Service worker: resolves the best available thumbnail for a video and downloads it.

const QUALITIES = ["maxresdefault", "sddefault", "hqdefault", "mqdefault", "default"];

// YouTube serves a 120x90 grey placeholder (with 404) when a size doesn't exist.
async function exists(url) {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!res.ok) return false;
    const len = Number(res.headers.get("content-length") || 0);
    return len === 0 || len > 1500; // placeholder is ~1 KB
  } catch {
    return false;
  }
}

async function bestThumbnail(videoId) {
  for (const q of QUALITIES) {
    const url = `https://i.ytimg.com/vi/${videoId}/${q}.jpg`;
    if (await exists(url)) return { url, quality: q };
  }
  return { url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, quality: "hqdefault" };
}

function sanitize(name) {
  return (
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 150) || "thumbnail"
  );
}

async function download({ videoId, title }) {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error("Invalid video id");
  const { url, quality } = await bestThumbnail(videoId);
  const base = title ? `${sanitize(title)} [${videoId}]` : videoId;
  const downloadId = await chrome.downloads.download({
    url,
    filename: `${base}.jpg`,
    conflictAction: "uniquify",
  });
  return { downloadId, url, quality };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "ytThumb:download") return;
  download(msg)
    .then((r) => sendResponse({ ok: true, ...r }))
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // async response
});
