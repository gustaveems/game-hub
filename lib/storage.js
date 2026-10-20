const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'games';
const VERSION_KEY = 'schemaVersion';

let starterGamesCache = null;

async function loadStarterGames() {
  if (starterGamesCache) return starterGamesCache;
  const resp = await fetch(chrome.runtime.getURL('data/starter-games.json'));
  const raw = await resp.json();
  starterGamesCache = raw.map(g => ({
    id: crypto.randomUUID(),
    title: g.title,
    url: g.url,
    description: g.description || '',
    thumbnail: g.thumbnail || null,
    tags: g.tags || [],
    launchMode: g.launchMode || 'tab',
    favorite: false,
    addedAt: new Date().toISOString(),
    lastPlayedAt: null,
    playCount: 0
  }));
  return starterGamesCache;
}

function validateGame(g) {
  return (
    typeof g === 'object' && g !== null &&
    typeof g.id === 'string' &&
    typeof g.title === 'string' &&
    typeof g.url === 'string' &&
    /^https?:\/\//i.test(g.url) &&
    Array.isArray(g.tags) &&
    (g.launchMode === 'tab' || g.launchMode === 'embed')
  );
}

function sanitizeGame(g) {
  return {
    id: g.id,
    title: String(g.title),
    url: String(g.url),
    description: String(g.description || ''),
    thumbnail: g.thumbnail || null,
    tags: Array.isArray(g.tags) ? g.tags.map(String) : [],
    launchMode: g.launchMode === 'embed' ? 'embed' : 'tab',
    favorite: Boolean(g.favorite),
    addedAt: g.addedAt || new Date().toISOString(),
    lastPlayedAt: g.lastPlayedAt || null,
    playCount: Number(g.playCount) || 0
  };
}

export async function getGames() {
  try {
    const data = await chrome.storage.local.get([STORAGE_KEY, VERSION_KEY]);
    if (data[VERSION_KEY] === SCHEMA_VERSION && Array.isArray(data[STORAGE_KEY])) {
      return data[STORAGE_KEY].filter(validateGame).map(sanitizeGame);
    }
  } catch (e) {
    console.warn('Game Hub: corrupted storage, resetting to starter list.', e);
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
  return games;
}

export async function recordPlay(id) {
  return updateGame(id, {
    lastPlayedAt: new Date().toISOString(),
    playCount: ((await getGames()).find(g => g.id === id)?.playCount || 0) + 1
  });
}

export async function resetToStarter() {
  starterGamesCache = null;
  const starter = await loadStarterGames();
  await saveGames(starter);
  return starter;
}

export async function importGames(jsonArray) {
  const valid = [];
  const skipped = [];
  for (let i = 0; i < jsonArray.length; i++) {
    const g = jsonArray[i];
    if (validateGame(g)) {
      valid.push(sanitizeGame(g));
    } else {
      skipped.push(i);
    }
  }
  if (valid.length > 0) await saveGames(valid);
  return { imported: valid.length, skipped };
}

export async function exportGames() {
  return getGames();
}

export async function getStorageUsage() {
  const bytes = await chrome.storage.local.getBytesInUse(null);
  return bytes;
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    // strip trailing slash for comparison
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
