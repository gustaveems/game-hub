import { advanceStreak } from './leaderboard.js';

const SCHEMA_VERSION = 2;
const STORAGE_KEY = 'games';
const VERSION_KEY = 'schemaVersion';
const LOCAL_PREFIX = 'local:'; // stores uploaded HTML game bodies, keyed by game id
const THUMB_PREFIX = 'thumb:'; // caches artwork as a data URL, keyed by game id

let starterGamesCache = null;

async function loadStarterGames() {
  if (starterGamesCache) return starterGamesCache;
  const resp = await fetch(chrome.runtime.getURL('data/starter-games.json'));
  const raw = await resp.json();
  starterGamesCache = raw.map(g => sanitizeGame({
    id: crypto.randomUUID(),
    ...g
  }));
  return starterGamesCache;
}

function validateGame(g) {
  if (typeof g !== 'object' || g === null) return false;
  if (typeof g.id !== 'string') return false;
  if (typeof g.title !== 'string' || !g.title) return false;
  if (!Array.isArray(g.tags)) return false;
  if (g.launchMode !== 'tab' && g.launchMode !== 'embed') return false;
  // Local games are launched from stored HTML; remote games need an http(s) URL.
  if (g.source === 'local') return typeof g.url === 'string';
  return typeof g.url === 'string' && /^https?:\/\//i.test(g.url);
}

function sanitizeGame(g) {
  const source = g.source === 'local' ? 'local' : 'url';
  return {
    id: g.id,
    title: String(g.title),
    url: String(g.url || (source === 'local' ? `local://${g.id}` : '')),
    description: String(g.description || ''),
    thumbnail: g.thumbnail || null,
    tags: Array.isArray(g.tags) ? g.tags.map(String) : [],
    launchMode: source === 'local' ? 'embed' : (g.launchMode === 'embed' ? 'embed' : 'tab'),
    favorite: Boolean(g.favorite),
    source,
    addedAt: g.addedAt || new Date().toISOString(),
    lastPlayedAt: g.lastPlayedAt || null,
    playCount: Number(g.playCount) || 0
  };
}

// Migrate an array of games from an older schema version to the current one.
function migrate(games, fromVersion) {
  let list = games;
  if (fromVersion < 2) {
    // v1 had no `source` field; everything was a remote URL.
    list = list.map(g => ({ ...g, source: g.source || 'url' }));
  }
  return list;
}

export async function getGames() {
  try {
    const data = await chrome.storage.local.get([STORAGE_KEY, VERSION_KEY]);
    const version = data[VERSION_KEY];
    const stored = data[STORAGE_KEY];

    if (Array.isArray(stored) && typeof version === 'number' && version <= SCHEMA_VERSION) {
      let list = stored;
      if (version < SCHEMA_VERSION) {
        list = migrate(list, version);
      }
      const clean = list.filter(validateGame).map(sanitizeGame);
      if (version < SCHEMA_VERSION) await saveGames(clean);
      return clean;
    }
  } catch (e) {
    console.warn('Game Hub: could not read storage, falling back to starter list.', e);
  }
  const starter = await loadStarterGames();
  await saveGames(starter);
  return starter;
}

export async function saveGames(games) {
  await chrome.storage.local.set({
    [STORAGE_KEY]: games,
    [VERSION_KEY]: SCHEMA_VERSION
  });
}

export async function addGame(game) {
  const games = await getGames();
  games.push(sanitizeGame(game));
  await saveGames(games);
  return games;
}

export async function updateGame(id, updates) {
  const games = await getGames();
  const idx = games.findIndex(g => g.id === id);
  if (idx === -1) return games;
  games[idx] = sanitizeGame({ ...games[idx], ...updates });
  await saveGames(games);
  return games;
}

export async function deleteGame(id) {
  let games = await getGames();
  games = games.filter(g => g.id !== id);
  await saveGames(games);
  await chrome.storage.local.remove([LOCAL_PREFIX + id, THUMB_PREFIX + id]);
  return games;
}

export async function recordPlay(id) {
  const games = await getGames();
  const g = games.find(x => x.id === id);
  if (!g) return games;
  return updateGame(id, {
    lastPlayedAt: new Date().toISOString(),
    playCount: (g.playCount || 0) + 1
  });
}

export async function resetToStarter() {
  starterGamesCache = null;
  const starter = await loadStarterGames();
  await saveGames(starter);
  return starter;
}

// --- Uploaded (local) games ---------------------------------------------

export async function saveLocalGameBody(id, html) {
  await chrome.storage.local.set({ [LOCAL_PREFIX + id]: html });
}

export async function getLocalGameBody(id) {
  const data = await chrome.storage.local.get(LOCAL_PREFIX + id);
  return data[LOCAL_PREFIX + id] || null;
}

// --- Thumbnail cache -----------------------------------------------------
// Each entry is { src, data }: `src` is the original thumbnail URL it was
// cached from (so we can detect edits), `data` is the image as a data URL.

export async function getThumbCache(ids) {
  const keys = ids.map(id => THUMB_PREFIX + id);
  const stored = await chrome.storage.local.get(keys);
  const map = {};
  for (const id of ids) {
    const v = stored[THUMB_PREFIX + id];
    if (v && v.src && v.data) map[id] = v;
  }
  return map;
}

export async function setThumbCache(id, src, dataUrl) {
  await chrome.storage.local.set({ [THUMB_PREFIX + id]: { src, data: dataUrl } });
}

// Drop cached thumbnails for games that no longer exist.
export async function pruneThumbCache(validIds) {
  const all = await chrome.storage.local.get(null);
  const valid = new Set(validIds);
  const stale = Object.keys(all).filter(
    k => k.startsWith(THUMB_PREFIX) && !valid.has(k.slice(THUMB_PREFIX.length))
  );
  if (stale.length) await chrome.storage.local.remove(stale);
}

export async function clearThumbCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(THUMB_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.length;
}

// --- Streak, profile, friends (leaderboard) ------------------------------
const STATS_KEY = 'stats';
const PROFILE_KEY = 'profile';
const FRIENDS_KEY = 'friends';

export async function getStats() {
  const d = await chrome.storage.local.get(STATS_KEY);
  return d[STATS_KEY] || { currentStreak: 0, longestStreak: 0, lastDailyDate: null };
}

// Call when a daily-tagged game is launched; advances the day streak.
export async function recordDailyPlay() {
  const next = advanceStreak(await getStats());
  await chrome.storage.local.set({ [STATS_KEY]: next });
  return next;
}

export async function getProfile() {
  const d = await chrome.storage.local.get(PROFILE_KEY);
  return d[PROFILE_KEY] || { name: '' };
}

export async function setProfileName(name) {
  await chrome.storage.local.set({ [PROFILE_KEY]: { name: String(name).slice(0, 40) } });
}

export async function getFriends() {
  const d = await chrome.storage.local.get(FRIENDS_KEY);
  return Array.isArray(d[FRIENDS_KEY]) ? d[FRIENDS_KEY] : [];
}

// Add or update a friend (keyed by name, case-insensitive).
export async function upsertFriend(friend) {
  const friends = await getFriends();
  const idx = friends.findIndex(f => f.name.toLowerCase() === friend.name.toLowerCase());
  if (idx === -1) friends.push(friend);
  else friends[idx] = friend;
  await chrome.storage.local.set({ [FRIENDS_KEY]: friends });
  return friends;
}

export async function removeFriend(name) {
  const friends = (await getFriends()).filter(f => f.name.toLowerCase() !== name.toLowerCase());
  await chrome.storage.local.set({ [FRIENDS_KEY]: friends });
  return friends;
}

// --- Import / export -----------------------------------------------------

export async function importGames(jsonArray) {
  const valid = [];
  const skipped = [];
  for (let i = 0; i < jsonArray.length; i++) {
    const g = jsonArray[i];
    if (validateGame(g)) valid.push(sanitizeGame(g));
    else skipped.push(i);
  }
  if (valid.length > 0) await saveGames(valid);
  return { imported: valid.length, skipped };
}

export async function exportGames() {
  return getGames();
}

export async function getStorageUsage() {
  return chrome.storage.local.getBytesInUse(null);
}

// --- Helpers -------------------------------------------------------------

// Returns up to `n` games for the quick-access list: favorites first,
// then most-played, then most-recently-added, de-duplicated.
export function pickFavorites(games, n = 5) {
  const seen = new Set();
  const out = [];
  const push = (g) => { if (!seen.has(g.id)) { seen.add(g.id); out.push(g); } };

  games.filter(g => g.favorite).forEach(push);
  [...games].sort((a, b) => b.playCount - a.playCount).filter(g => g.playCount > 0).forEach(push);
  [...games].sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt)).forEach(push);

  return out.slice(0, n);
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}
