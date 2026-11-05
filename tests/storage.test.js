import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshChrome } from './helpers.js';
import {
  getGames, addGame, updateGame, deleteGame, restoreGame, recordPlay, importGames, resetToStarter,
  restoreSnapshot, getQuarantine, getSnapshotInfo, normalizeUrl, recordDailyPlay, getProfile, upsertFriend,
} from '../lib/storage.js';

beforeEach(() => { freshChrome(); });

const game = (n, extra = {}) => ({
  id: `id-${n}`, title: `Game ${n}`, url: `https://example.com/${n}`, tags: ['trivia'], launchMode: 'tab', ...extra,
});

test('first run seeds the starter list', async () => {
  const games = await getGames();
  assert.ok(games.length > 200);
  assert.equal(new Set(games.map((g) => g.id)).size, games.length);
});

test('pages opening at the same moment seed only once', async () => {
  const [a, b, c] = await Promise.all([getGames(), getGames(), getGames()]);
  assert.deepEqual(a.map((g) => g.id), b.map((g) => g.id));
  assert.deepEqual(b.map((g) => g.id), c.map((g) => g.id));
});

test('concurrent writes never overwrite each other', async () => {
  const before = (await getGames()).length;
  const [first] = await getGames();
  await Promise.all([
    addGame(game(1)),
    updateGame(first.id, { favorite: true }),
    addGame(game(2)),
    recordPlay(first.id),
    recordPlay(first.id),
  ]);
  const after = await getGames();
  assert.equal(after.length, before + 2);
  const g = after.find((x) => x.id === first.id);
  assert.equal(g.favorite, true);
  assert.equal(g.playCount, 2);
});

test('a toggle computed from fresh data wins over a stale copy', async () => {
  const [first] = await getGames();
  await updateGame(first.id, { favorite: true });
  await updateGame(first.id, (g) => ({ favorite: !g.favorite }));
  assert.equal((await getGames()).find((g) => g.id === first.id).favorite, false);
});

test('a clashing id gets a new one', async () => {
  const [first] = await getGames();
  await addGame(game(1, { id: first.id }));
  const games = await getGames();
  assert.equal(new Set(games.map((g) => g.id)).size, games.length);
});

test('duplicate ids already in storage are repaired on read', async () => {
  await chrome.storage.local.set({ games: [game(1, { id: 'x' }), game(2, { id: 'x' })], schemaVersion: 3, starterSeen: [] });
  const games = (await getGames()).filter((g) => g.url.startsWith('https://example.com/'));
  assert.notEqual(games[0].id, games[1].id);
});

test('damaged entries are set aside, not dropped', async () => {
  await chrome.storage.local.set({ games: [game(1), { title: 'no url' }], schemaVersion: 3, starterSeen: [] });
  await getGames();
  assert.deepEqual(await getQuarantine(), [{ title: 'no url' }]);
});

test('a corrupted library value is kept and the starter list restored', async () => {
  await chrome.storage.local.set({ games: 'garbage' });
  assert.ok((await getGames()).length > 200);
  assert.deepEqual(await getQuarantine(), ['garbage']);
});

test('games added by an update arrive once; deleted ones stay deleted', async () => {
  const games = await getGames();
  const gone = games.find((g) => g.title === 'Wordle');
  await deleteGame(gone.id);
  const { starterSeen } = await chrome.storage.local.get('starterSeen');
  const newcomer = games.find((g) => g.title === 'Hisorty');
  await chrome.storage.local.set({ starterSeen: starterSeen.filter((u) => u !== normalizeUrl(newcomer.url)) });
  await deleteGame(newcomer.id);
  const after = await getGames();
  assert.ok(after.some((g) => g.title === 'Hisorty'), 'offered again once');
  assert.ok(!after.some((g) => g.id === gone.id), 'deleted game stays deleted');
  await deleteGame(after.find((g) => g.title === 'Hisorty').id);
  assert.ok(!(await getGames()).some((g) => g.title === 'Hisorty'), 'not offered a second time');
});

test('a library from before the seen-list only gains games added since', async () => {
  const raw = JSON.parse(readFileSync(new URL('../data/starter-games.json', import.meta.url), 'utf8'));
  const original = raw.filter((g) => !g.since).slice(0, 5).map((g, i) => ({ ...g, id: `old-${i}` }));
  await chrome.storage.local.set({ games: original, schemaVersion: 2 });
  const games = await getGames();
  assert.equal(games.length, 5 + raw.filter((g) => g.since).length);
  assert.ok(games.some((g) => g.title === 'Hisorty'));
  assert.ok(!games.some((g) => g.title === 'Minesweeper'), 'an original game missing from the library is not re-added');
});

test('undo puts a deleted game back with its history', async () => {
  const [first] = await getGames();
  await recordPlay(first.id);
  const removed = (await deleteGame(first.id)).removed;
  assert.equal(removed.id, first.id);
  await restoreGame(removed);
  assert.equal((await getGames()).find((g) => g.id === first.id).playCount, 1);
});

test('import merges and skips duplicates, bad rows and bad urls', async () => {
  const before = (await getGames()).length;
  const result = await importGames([
    { title: 'Fresh', url: 'https://fresh.example/', tags: [] },
    { title: 'Dup', url: 'http://www.example.com/dup/?utm_source=x' },
    { title: 'Dup again', url: 'https://example.com/dup' },
    { title: 'Bad', url: 'javascript:alert(1)' },
    { url: 'https://notitle.example/' },
  ]);
  assert.equal(result.imported, 2);
  assert.deepEqual(result.skipped, [3, 4]);
  assert.equal((await getGames()).length, before + 2);
});

test('replace-import and reset can be stepped back', async () => {
  const count = (await getGames()).length;
  await importGames([{ title: 'Only', url: 'https://only.example/' }], { replace: true });
  assert.equal((await getGames()).length, 1);
  assert.equal((await getSnapshotInfo()).count, count);
  assert.equal(await restoreSnapshot(), count);
  await resetToStarter();
  assert.ok((await getGames()).length > 200);
});

test('title, description and thumbnail are capped and cleaned', async () => {
  await addGame(game(9, { title: 'x'.repeat(500), description: 'y'.repeat(5000), thumbnail: 'javascript:alert(1)' }));
  const g = (await getGames()).find((x) => x.id === 'id-9');
  assert.equal(g.title.length, 120);
  assert.equal(g.description.length, 300);
  assert.equal(g.thumbnail, null);
});

test('duplicate detection ignores protocol, www, slash and tracking', () => {
  assert.equal(normalizeUrl('http://www.Example.com/game/?ref=dles.gg&utm_source=x#top'), normalizeUrl('https://example.com/game'));
  assert.notEqual(normalizeUrl('https://a.com/?game=1'), normalizeUrl('https://a.com/?game=2'));
});

test('streak, profile and friends survive concurrent writers', async () => {
  const [profileA, profileB] = await Promise.all([getProfile(), getProfile()]);
  assert.equal(profileA.id, profileB.id);
  await Promise.all([upsertFriend({ name: 'Ann', streak: 1 }), upsertFriend({ name: 'Bo', streak: 2 })]);
  const { friends } = await chrome.storage.local.get('friends');
  assert.deepEqual(friends.map((f) => f.name).sort(), ['Ann', 'Bo']);
  const [a, b] = await Promise.all([recordDailyPlay(), recordDailyPlay()]);
  assert.equal(a.currentStreak, 1);
  assert.equal(b.currentStreak, 1);
});

test('the starter list is well formed with no duplicates', async () => {
  const games = await getGames();
  assert.equal(new Set(games.map((g) => normalizeUrl(g.url))).size, games.length);
  for (const g of games) {
    assert.ok(/^https:\/\//.test(g.url), g.title);
    assert.ok(g.description, g.title);
    assert.ok(g.tags.length, g.title);
  }
});
