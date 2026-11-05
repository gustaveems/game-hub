import { advanceStreak } from './leaderboard.js';

// Every write to the library goes through mutate(), which re-reads the freshest data under a lock
// shared by all extension pages. A stale tab can no longer overwrite another tab's changes.

const SCHEMA_VERSION = 3;
const STORAGE_KEY = 'games';
const VERSION_KEY = 'schemaVersion';
const SEEN_KEY = 'starterSeen'; // normalized URLs of starter games already offered to this library
const QUARANTINE_KEY = 'quarantine'; // damaged entries, kept so nothing is lost silently
const SNAPSHOT_KEY = 'snapshot'; // the library before the last import-replace or reset
const LOCAL_PREFIX = 'local:'; // stores uploaded HTML game bodies, keyed by game id
const THUMB_PREFIX = 'thumb:'; // caches artwork as a data URL, keyed by game id

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 300;
const MAX_TAGS = 12;
const MAX_URL = 2048;

let starterGamesCache = null;
let starterMeta = null; // normalized url -> { since }

async function loadStarterGames() {
  if (starterGamesCache) return starterGamesCache;
  const resp = await fetch(chrome.runtime.getURL('data/starter-games.json'));
  const raw = await resp.json();
  starterMeta = new Map(raw.map(g => [normalizeUrl(g.url), { since: g.since || 1 }]));
  starterGamesCache = raw.map(g => sanitizeGame({ id: crypto.randomUUID(), ...g }));
  return starterGamesCache;
}

function isHttp(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function validateGame(g) {
  if (typeof g !== 'object' || g === null) return false;
  if (typeof g.id !== 'string') return false;
  if (typeof g.title !== 'string' || !g.title.trim()) return false;
  if (!Array.isArray(g.tags)) return false;
  if (g.launchMode !== 'tab' && g.launchMode !== 'embed') return false;
  // Local games are launched from stored HTML; remote games need an http(s) URL.
  if (g.source === 'local') return typeof g.url === 'string';
  return isHttp(g.url);
}

function sanitizeGame(g) {
  const source = g.source === 'local' ? 'local' : 'url';
  const thumbnail = String(g.thumbnail || '').trim().slice(0, MAX_URL);
  return {
    id: g.id,
    title: String(g.title).trim().slice(0, MAX_TITLE),
    url: String(g.url || (source === 'local' ? `local://${g.id}` : '')).trim().slice(0, MAX_URL),
    description: String(g.description || '').trim().slice(0, MAX_DESCRIPTION),
    thumbnail: isHttp(thumbnail) || thumbnail.startsWith('data:image/') ? thumbnail : null,
    tags: Array.isArray(g.tags)
      ? [...new Set(g.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, MAX_TAGS)
      : [],
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

// --- Locking ---------------------------------------------------------------

let localQueue = Promise.resolve();
function withLock(fn) {
  if (globalThis.navigator?.locks) return navigator.locks.request('game-hub-store', fn);
  const run = localQueue.then(fn, fn);
  localQueue = run.catch(() => {});
  return run;
}

// Splits stored entries into usable games and damaged ones, and repairs duplicate ids.
function parseStored(list) {
  const ids = new Set();
  const games = [];
  const damaged = [];
  for (const entry of list) {
    if (!validateGame(entry)) {
      damaged.push(entry);
      continue;
    }
    const g = sanitizeGame(entry);
    if (ids.has(g.id)) g.id = crypto.randomUUID();
    ids.add(g.id);
    games.push(g);
  }
  return { games, damaged };
}

async function readStore() {
  const data = await chrome.storage.local.get([STORAGE_KEY, VERSION_KEY, SEEN_KEY, QUARANTINE_KEY]);
  const raw = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : null;
  const version = typeof data[VERSION_KEY] === 'number' ? data[VERSION_KEY] : 1;
  const { games, damaged } = parseStored(raw ? migrate(raw, version) : []);
  if (!raw && data[STORAGE_KEY] !== undefined) damaged.push(data[STORAGE_KEY]); // keep a corrupted value
  return {
    raw, version, games, damaged,
    seen: Array.isArray(data[SEEN_KEY]) ? data[SEEN_KEY] : null,
    quarantine: Array.isArray(data[QUARANTINE_KEY]) ? data[QUARANTINE_KEY] : []
  };
}

async function commit(store, games, extra = {}) {
  const quarantine = store.damaged.length
    ? { [QUARANTINE_KEY]: [...store.quarantine, ...store.damaged] }
    : {};
  if (store.damaged.length) console.warn(`Game Hub: set aside ${store.damaged.length} damaged entries.`);
  await chrome.storage.local.set({
    [STORAGE_KEY]: games,
    [VERSION_KEY]: SCHEMA_VERSION,
    ...quarantine,
    ...extra
  });
}

// Brings a stored library up to date: first-run seeding, migration, and starter games added by
// an update (offered once; ones you deleted stay deleted). Returns the games and what to write.
async function prepare(store) {
  const starter = await loadStarterGames();
  const key = g => normalizeUrl(g.url);
  const allStarter = starter.map(key);

  if (!store.raw) return { games: starter, extra: { [SEEN_KEY]: allStarter }, dirty: true };

  // Libraries from before this feature: treat the original starter list as already offered, so a
  // game deleted long ago doesn't come back, and only the games added since are offered.
  const seen = new Set(store.seen ?? starter.filter(g => starterMeta.get(key(g)).since <= 1).map(key));
  const have = new Set(store.games.map(key));
  const fresh = starter.filter(g => !seen.has(key(g)) && !have.has(key(g)));
  const dirty = fresh.length > 0 || store.version < SCHEMA_VERSION || !store.seen || store.damaged.length > 0;
  return { games: [...store.games, ...fresh], extra: dirty ? { [SEEN_KEY]: allStarter } : {}, dirty };
}

export function getGames() {
  return withLock(async () => {
    try {
      const store = await readStore();
      const { games, extra, dirty } = await prepare(store);
      if (dirty) await commit(store, games, extra);
      return games;
    } catch (e) {
      console.warn('Game Hub: could not read storage, falling back to starter list.', e);
      return loadStarterGames();
    }
  });
}

// The only write path. `fn` gets the freshest games and returns the new list, or { games, value }.
export function mutate(fn) {
  return withLock(async () => {
    const store = await readStore();
    const { games: current, extra, dirty } = await prepare(store);
    const result = await fn(current);
    const next = Array.isArray(result) ? result : result?.games ?? current;
    await commit(store, next, dirty ? extra : {});
    return { games: next, value: result?.value };
  });
}

export async function saveGames(games) {
  await replaceGames(games);
}

export async function addGame(game) {
  const { games } = await mutate(list => {
    const g = sanitizeGame(game);
    if (list.some(x => x.id === g.id)) g.id = crypto.randomUUID();
    return [...list, g];
  });
  return games;
}

// `updates` is an object, or a function of the current game so toggles use fresh data.
export async function updateGame(id, updates) {
  const { games } = await mutate(list => list.map(g => {
    if (g.id !== id) return g;
    const patch = typeof updates === 'function' ? updates(g) : updates;
    return sanitizeGame({ ...g, ...patch, id });
  }));
  return games;
}

// The deleted game's cached artwork goes with it, but an uploaded game's HTML is kept until the
// next orphan sweep, so Undo (restoreGame) can bring it back whole.
export async function deleteGame(id) {
  let removed = null;
  const { games } = await mutate(list => {
    removed = list.find(g => g.id === id) || null;
    return list.filter(g => g.id !== id);
  });
  await chrome.storage.local.remove([THUMB_PREFIX + id]);
  return Object.assign(games, { removed });
}

export async function restoreGame(game) {
  const { games } = await mutate(list => {
    if (list.some(g => g.id === game.id || normalizeUrl(g.url) === normalizeUrl(game.url))) return list;
    return [...list, sanitizeGame(game)];
  });
  return games;
}

export async function recordPlay(id) {
  return updateGame(id, g => ({
    lastPlayedAt: new Date().toISOString(),
    playCount: (g.playCount || 0) + 1
  }));
}

// Replaces the whole library, keeping the old one so it can be stepped back to.
export function replaceGames(next) {
  return withLock(async () => {
    const store = await readStore();
    const { games } = parseStored(next);
    const starter = await loadStarterGames();
    await commit({ ...store, damaged: [] }, games, {
      [SNAPSHOT_KEY]: { at: new Date().toISOString(), games: store.games },
      [SEEN_KEY]: starter.map(g => normalizeUrl(g.url))
    });
    return games;
  });
}

export async function resetToStarter() {
  starterGamesCache = null;
  return replaceGames(await loadStarterGames());
}

export function restoreSnapshot() {
  return withLock(async () => {
    const snapshot = (await chrome.storage.local.get(SNAPSHOT_KEY))[SNAPSHOT_KEY];
    if (!snapshot) return 0;
    const store = await readStore();
    await commit({ ...store, damaged: [] }, snapshot.games, {
      [SNAPSHOT_KEY]: { at: new Date().toISOString(), games: store.games }
    });
    return snapshot.games.length;
  });
}

export async function getSnapshotInfo() {
  const snapshot = (await chrome.storage.local.get(SNAPSHOT_KEY))[SNAPSHOT_KEY];
  return snapshot ? { at: snapshot.at, count: snapshot.games.length } : null;
}

export async function getQuarantine() {
  return (await chrome.storage.local.get(QUARANTINE_KEY))[QUARANTINE_KEY] || [];
}

// Calls back whenever another page changes the library or anything else this one displays.
export function subscribe(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') callback(changes);
  });
}

// --- Uploaded (local) games ---------------------------------------------

export async function saveLocalGameBody(id, html) {
  await chrome.storage.local.set({ [LOCAL_PREFIX + id]: html });
}

export async function getLocalGameBody(id) {
  const data = await chrome.storage.local.get(LOCAL_PREFIX + id);
  return data[LOCAL_PREFIX + id] || null;
}

// Drops uploaded-game bodies that neither the library nor the undo snapshot refers to.
export async function pruneLocalBodies(validIds) {
  const snapshot = (await chrome.storage.local.get(SNAPSHOT_KEY))[SNAPSHOT_KEY];
  const valid = new Set([...validIds, ...(snapshot?.games || []).map(g => g.id)]);
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter(
    k => k.startsWith(LOCAL_PREFIX) && !valid.has(k.slice(LOCAL_PREFIX.length))
  );
  if (stale.length) await chrome.storage.local.remove(stale);
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
export function recordDailyPlay() {
  return withLock(async () => {
    const next = advanceStreak(await getStats());
    await chrome.storage.local.set({ [STATS_KEY]: next });
    return next;
  });
}

// Profile carries the display name plus a stable random id used as the
// global leaderboard's primary key (so you update your own row, not a new one).
export function getProfile() {
  return withLock(async () => {
    const d = await chrome.storage.local.get(PROFILE_KEY);
    const p = d[PROFILE_KEY] || {};
    let changed = false;
    if (typeof p.name !== 'string') { p.name = ''; changed = true; }
    if (!p.id) { p.id = crypto.randomUUID(); changed = true; }
    if (changed) await chrome.storage.local.set({ [PROFILE_KEY]: p });
    return p;
  });
}

export function setProfileName(name) {
  return withLock(async () => {
    const d = await chrome.storage.local.get(PROFILE_KEY);
    const p = d[PROFILE_KEY] || { id: crypto.randomUUID() };
    p.name = String(name).slice(0, 40);
    await chrome.storage.local.set({ [PROFILE_KEY]: p });
  });
}

export async function getFriends() {
  const d = await chrome.storage.local.get(FRIENDS_KEY);
  return Array.isArray(d[FRIENDS_KEY]) ? d[FRIENDS_KEY] : [];
}

// Add or update a friend (keyed by name, case-insensitive).
export function upsertFriend(friend) {
  return withLock(async () => {
    const friends = await getFriends();
    const idx = friends.findIndex(f => f.name.toLowerCase() === friend.name.toLowerCase());
    if (idx === -1) friends.push(friend);
    else friends[idx] = friend;
    await chrome.storage.local.set({ [FRIENDS_KEY]: friends });
    return friends;
  });
}

export function removeFriend(name) {
  return withLock(async () => {
    const friends = (await getFriends()).filter(f => f.name.toLowerCase() !== name.toLowerCase());
    await chrome.storage.local.set({ [FRIENDS_KEY]: friends });
    return friends;
  });
}

// --- Import / export -----------------------------------------------------

// Merges into the library. Entries without an id get one; duplicates (same URL) are skipped.
// With { replace: true } the library is replaced instead, and the old one is kept for Undo.
export async function importGames(jsonArray, { replace = false } = {}) {
  const valid = [];
  const skipped = [];
  jsonArray.forEach((entry, i) => {
    const candidate = { launchMode: 'tab', tags: [], ...entry, id: entry?.id || crypto.randomUUID() };
    if (validateGame(candidate)) valid.push(sanitizeGame(candidate));
    else skipped.push(i);
  });
  if (replace) {
    if (valid.length > 0) await replaceGames(valid);
    return { imported: valid.length, skipped, duplicates: 0 };
  }
  let imported = 0;
  await mutate(list => {
    const urls = new Set(list.map(g => normalizeUrl(g.url)));
    const ids = new Set(list.map(g => g.id));
    const next = [...list];
    for (const g of valid) {
      if (urls.has(normalizeUrl(g.url))) continue;
      if (ids.has(g.id)) g.id = crypto.randomUUID();
      urls.add(normalizeUrl(g.url));
      ids.add(g.id);
      next.push(g);
      imported++;
    }
    return next;
  });
  return { imported, skipped, duplicates: valid.length - imported };
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

// Protocol, www, hash, trailing slash and tracking params don't make a different game.
export function normalizeUrl(url) {
  try {
    const u = new URL(String(url).trim());
    for (const p of [...u.searchParams.keys()]) {
      if (p === 'ref' || p.startsWith('utm_')) u.searchParams.delete(p);
    }
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.host.toLowerCase().replace(/^www\./, '')}${path}${u.search}`.toLowerCase();
  } catch {
    return String(url).trim().toLowerCase();
  }
}
