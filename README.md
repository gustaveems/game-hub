# Game Hub

A Chrome extension that turns your new-tab page into a personal library of browser games, with a quick-launch popup for your favorites. Comes with ~30 curated games (trivia/daily-puzzle heavy) and lets you add your own by URL or by uploading an HTML file.

## Loading the Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder
4. Open a new tab — the Game Hub library appears

## The Popup (toolbar icon)

Click the Game Hub icon in the toolbar to get a compact panel with:

- **Favorites** — up to 5 tiles with each game's logo. Clicking one launches it (URL games open in a tab; embedded/uploaded games open in the full library overlay). The list is filled by: starred favorites first, then most-played, then most-recently-added.
- **Quick add** — paste a URL and hit **Add**, grab the **Current tab**, or **Upload** a local `.html` game.
- **Open Full Library →** — opens the new-tab page with the whole collection.

## The Full Library (new-tab page)

- **Grid of game cards** — each shows the site's favicon as a logo on a branded-color tile (or an `og:image` thumbnail if one was fetched/set), with title, tags, and a favorite star.
- **Search** — filters by title and tag as you type.
- **Filter chips** — All, Favorites, Recently Played, and one per tag.
- **Sort** — Title, Recently Added, Most Played.
- **Card menu (⋮)** — Edit, Delete, Toggle favorite, Switch launch mode.
- **+ Add Game** — opens a modal with URL metadata auto-fetch, duplicate warnings, tag input, launch-mode toggle, and an **Upload .html** option.

## Logos

Game logos come from the site's favicon via Google's favicon image service (an image URL, not a script — no remote code runs). If a game has an explicit `og:image` thumbnail it's used instead. If both fail, a colored tile with the title's initials is shown.

## Launch Modes

- **Tab** — opens the game in a new browser tab (default; best for sites that block framing like NYT, GeoGuessr, sports-reference).
- **Embed** — opens the game in a full-screen overlay iframe. If the site blocks embedding (X-Frame-Options / CSP `frame-ancestors`), a fallback message offers to open it in a new tab.
- **Uploaded games** always use embed mode — the stored HTML plays from a blob URL in the overlay.

## Keyboard Shortcuts (library)

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `n` | Open Add Game |
| `Esc` | Close modal or embed overlay |

## Options Page

`chrome://extensions` → Game Hub → **Details** → **Extension options**.

- **Export** library as JSON
- **Import** from JSON (replaces the library; invalid entries are skipped with a report)
- **Reset** to the starter list
- **Storage usage** readout

## Known Limitations

- **Embed detection is best-effort.** The check reads `X-Frame-Options`/CSP via a `fetch()` from the extension; some servers send different headers to real navigations, or frame-bust via JavaScript. The iframe fallback message exists precisely because this can't be fully reliable from an extension.
- **Favicon logos** are fetched from Google's favicon service and depend on it being reachable; the initials tile is the fallback.
- **Thumbnails** (when set) are hotlinked from the source site and can break if that site changes.
- **Uploaded games** are stored in `chrome.storage.local` (the `unlimitedStorage` permission is declared). Only self-contained HTML files work well; games that load external assets by relative path may not.
- **`og:image`/metadata fetching** needs the target site to allow a cross-origin request from the extension; some sites return nothing.

## Data Model

```
{
  id, title, url, description, thumbnail,
  tags: string[],
  launchMode: "tab" | "embed",
  source: "url" | "local",
  favorite: boolean,
  addedAt, lastPlayedAt, playCount
}
```
Stored under key `games` with `schemaVersion: 2`. Uploaded game bodies are stored separately under `local:<id>`. A migration hook upgrades v1 data (adds `source: "url"`).

## Test Checklist (~10 minutes)

1. Load at `chrome://extensions` — no errors or warnings
2. Open a new tab — ~30 starter games appear, each with a favicon logo tile
3. Click the toolbar icon — the popup shows favorites (initially most-recent), quick-add, and "Open Full Library"
4. In the popup, click a favorite tile — the game launches and the popup closes
5. In the popup, paste a URL (e.g. `https://sudoku.com`) and click Add — it appears; the count increments
6. In the popup, click **+ Current tab** on any page — it's added
7. In the popup, click **Open Full Library →** — the library tab opens
8. In the library, search "trivia" — only trivia-tagged games show
9. Click a tag chip (e.g. "geography") — the grid filters; click "All" to reset
10. Star a game via ⋮ → Favorite — reopen the popup; it should now appear in Favorites
11. Sort by "Most Played" after launching a couple of games — they rank higher
12. ⋮ → Switch to embed on an embeddable game (e.g. 2048), click it — the overlay plays it; press Esc to close
13. Click an embed game that blocks framing — the fallback "Open in a new tab" message appears
14. **+ Add Game**, paste a URL, wait — title/description/thumbnail auto-fill; edit and save
15. Try a duplicate URL — a warning shows; try a non-http URL — an error shows
16. **+ Add Game → Upload .html**, pick a self-contained HTML game — it's added as a "local" card; click it to play in the overlay
17. Edit a game (⋮ → Edit), change the title, save — reload the tab; the change persists
18. Delete a game (⋮ → Delete, confirm) — it's gone after reload
19. Delete all games — the empty state with "Restore starter games" appears; click it
20. Options page: Export, Reset, then Import the exported file — library round-trips
21. Resize the window below 400px — cards reflow to fewer columns
22. Toggle OS light/dark mode — the theme follows
