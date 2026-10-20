# Game Hub

A Chrome extension that replaces your new-tab page with a personal library of browser games.

## Loading the Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked** and select this folder
4. Open a new tab — you should see the Game Hub library

## Adding a Game

**From the new-tab page:**
1. Click **+ Add Game**
2. Paste a URL — metadata (title, description, thumbnail) will be fetched automatically
3. Edit any fields, add tags, choose a launch mode, and click **Save**

**From any tab (popup):**
1. Click the Game Hub extension icon in the toolbar
2. The current tab's URL and title are pre-filled
3. Click **Add to Game Hub**

## Launch Modes

- **Tab**: Opens the game in a new browser tab (default).
- **Embed**: Opens the game in a full-screen overlay iframe within the new-tab page. If the site blocks embedding (via X-Frame-Options or CSP), a fallback message appears with an option to open in a new tab instead.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus the search box |
| `n` | Open the Add Game modal |
| `Esc` | Close modals or the embed overlay |

## Options Page

Right-click the extension icon → **Options**, or go to `chrome://extensions` → Game Hub → **Details** → **Extension options**.

- **Export**: Download your library as JSON
- **Import**: Replace your library from a JSON file (invalid entries are skipped with a report)
- **Reset**: Restore the built-in starter games
- **Storage usage**: See how much space your library uses

## Known Limitations

- **Embed detection is best-effort.** The extension checks `X-Frame-Options` and CSP `frame-ancestors` headers via a `fetch()` from the extension context. Some servers send different headers to browsers vs. fetch requests, or set frame-busting via JavaScript. The iframe fallback message handles these cases.
- **Metadata fetch** depends on the target site allowing cross-origin requests from the extension. Some sites may return incomplete or no metadata.
- **Thumbnails** are hotlinked from the original site's `og:image`. If the site goes down or changes URLs, thumbnails may break. A colored placeholder with initials is shown as a fallback.
- **Storage** uses `chrome.storage.local`, which has a ~10 MB limit. This is more than enough for a game library (thousands of entries) but not for storing images locally.

## Test Checklist

Run through these in about 10 minutes after loading the extension:

1. Load the extension at `chrome://extensions` — no errors or warnings in the panel
2. Open a new tab — the starter games grid appears with thumbnails or colored placeholders
3. Click a game card — it opens in a new tab; check that play count increments on return
4. Use the search box — type part of a game title; the grid filters in real time
5. Click a tag chip (e.g., "puzzle") — only matching games appear; click "All" to reset
6. Change the sort dropdown to "Most Played" — the game you just played should rank higher
7. Click the star on a card's three-dot menu → "Favorite" — the star icon appears; click "Favorites" chip to filter
8. Click three-dot menu → "Switch to embed" on a game, then click its card — the embed overlay appears; press Esc to close
9. Click **+ Add Game**, paste a URL (e.g., `https://www.nytimes.com`), wait for metadata fetch — title and description should auto-fill
10. Try adding a duplicate URL — a warning should appear
11. Try adding a URL without `http(s)` — an error should appear
12. Edit a game via three-dot menu → "Edit" — change the title, save, verify it persists after closing and reopening the tab
13. Delete a game via three-dot menu → "Delete" — confirm the dialog; verify it's gone
14. Delete all games, verify the empty state shows up with "Add Game" and "Restore starter games"
15. Click "Restore starter games" — the starter list returns
16. Open the extension popup on any page — verify URL and title are pre-filled; add it
17. Go to the Options page: export JSON, reset to starter list, then import the exported JSON — library should match the export
18. Press `/` to focus search, `n` to open Add Game modal, `Esc` to close — all work
19. Resize the window narrow (< 400px) — cards should reflow to a single column
20. Toggle your OS between light and dark mode — the UI theme should follow
