# YouTube Thumbnail Downloader (Chrome extension)

One click to save the best-quality thumbnail of any YouTube video.

## Where the button appears

| Place | Button |
| --- | --- |
| Home, Subscriptions, Search, channel pages, playlists, watch-page sidebar | Small picture icon in the top-left corner of a thumbnail, shown on hover (also over YouTube's hover preview) |
| Watch page | **Thumbnail** pill next to Like / Share |
| Shorts player | **Thumbnail** button at the top of the right-hand action bar |
| Shorts shelves / grids | Same hover icon as other thumbnails |

The icon is a picture, not a download arrow, so it can't be mistaken for "download video".

## What gets downloaded

- Regular videos: the largest available image, tried in this order: `maxresdefault` (1280×720) → `sddefault` → `hqdefault` → `mqdefault`.
- Shorts: `oardefault`, the original vertical image (e.g. 1080×1920), falling back to the list above.
- File name: `<video title> [<video id>].jpg`, saved to your default Downloads folder.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.

## Project layout

```
manifest.json        MV3 manifest (permissions: downloads; host: i.ytimg.com)
src/content.js       Injects buttons; MutationObserver handles YouTube's SPA navigation
src/content.css      Button styles (uses YouTube's own CSS variables for light/dark)
src/background.js    Picks the best thumbnail size and calls chrome.downloads
icons/               Extension icons (generated from icon.svg)
scripts/             agent-browser helpers used for testing
```

## Testing with agent-browser

```bash
scripts/launch-test-browser.sh "https://www.youtube.com/results?search_query=lofi"
scripts/hover-click.sh "ytd-video-renderer ytd-thumbnail" 1 test-output/shot.png
```

`launch-test-browser.sh` starts a fresh session with the extension loaded and rejects the EU cookie dialog. `hover-click.sh` hovers a thumbnail like a user, finds the button that's actually on top (the hover preview included), clicks it and checks the page didn't navigate away.

## Implementation notes

- YouTube overwrites `className` on its components, so the extension never marks hosts with a class. CSS matches them by structure (`:has(> .ytthumb-btn)`, `:hover > .ytthumb-btn`).
- Hovering a thumbnail puts YouTube's inline preview player (`ytd-video-preview`) over it, so that overlay gets its own button. The video ID is read at click time.
- Clicks are stopped from bubbling, so pressing the button never opens the video.
