# Game Hub

A Chrome extension that gives you a personal library of browser games. Click the toolbar icon for a quick-launch popup of your favorites, and open the full library in its own tab. Comes with ~70 curated games (trivia/daily-puzzle heavy) and lets you add your own by URL or by uploading an HTML file. It does **not** take over your new-tab page.

## Loading the Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder
4. Click the Game Hub icon in the toolbar — the popup opens; hit **Open Full Library →** to see everything

## The Popup (toolbar icon)

Click the Game Hub icon in the toolbar to get a compact panel with:

- **Favorites** — up to 5 tiles with each game's logo. Clicking one launches it (URL games open in a tab; embedded/uploaded games open in the full library overlay). The list is filled by: starred favorites first, then most-played, then most-recently-added.
- **Quick add** — paste a URL and hit **Add**, grab the **Current tab**, or **Upload** a local `.html` game.
- **Open Full Library →** — opens the full library in its own tab.

## The Full Library (its own tab)

- **Grid of game cards** — each shows the site's favicon as a logo on a branded-color tile (or an `og:image` thumbnail if one was fetched/set), with title, tags, and a favorite star.
- **Search** — filters by title and tag as you type.
- **Filter chips** — All, Favorites, Recently Played, and one per tag.
- **Sort** — Title, Recently Added, Most Played.
- **Card menu (⋮)** — Edit, Delete, Toggle favorite, Switch launch mode.
- **+ Add Game** — opens a modal with URL metadata auto-fetch, duplicate warnings, tag input, launch-mode toggle, and an **Upload .html** option.

## Logos & Artwork Caching

Each game shows its `og:image` artwork when available, otherwise the site's favicon (via Google's favicon image service — an image URL, not a script, so no remote code runs), and finally a colored tile with the title's initials.

Artwork is **cached the first time you see it**: the image is fetched once, converted to a data URL, and stored in `chrome.storage.local` keyed by game id. After that the library renders instantly from the cache and keeps working even if a site changes or removes its image (link rot). The cache self-prunes when you delete games, refreshes automatically if you change a game's thumbnail URL, and can be cleared from the Options page.

## Launch Modes

- **Tab** — opens the game in a new browser tab (default; best for sites that block framing like NYT, GeoGuessr, sports-reference).
- **Embed** — opens the game in a full-screen overlay iframe. If the site blocks embedding (X-Frame-Options / CSP `frame-ancestors`), a fallback message offers to open it in a new tab.
- **Uploaded games** always use embed mode — the stored HTML plays from a blob URL in the overlay.

## Leaderboard (Daily Streak)

Click **🏆 Leaderboard** in the library to compete with friends on your **daily-play streak** — the number of consecutive days you launch at least one daily-tagged game. The streak resets if you miss a day. (The extension can only detect that you *opened* a daily game, not that you solved it — third-party game sites don't expose your score — so the streak measures showing up, not winning.)

**Friends (works now, no server):**
- Pick a name; the modal generates a `GH1-…` **share code** of your stats.
- Copy it to friends; paste theirs into "Add a friend's code."
- Everyone is ranked by current streak, with 🥇🥈🥉 for the top three and your row highlighted. It's a local, point-in-time snapshot — re-share codes to update.

**Global leaderboard:** planned as a second phase. It requires a hosted backend (server + database) and isn't built yet.

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
- **Clear image cache** (frees space / forces artwork to re-download)
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
2. Click the toolbar icon — the popup shows favorites (initially most-recent), quick-add, and "Open Full Library"; your new-tab page is untouched
3. Click **Open Full Library →** — the library opens in a tab with ~70 games, grouped into sections with a "Today's Dailies" strip on top
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
