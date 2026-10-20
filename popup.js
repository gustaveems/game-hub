import {
  getGames, addGame, recordPlay, normalizeUrl, pickFavorites, saveLocalGameBody
} from './lib/storage.js';
import { faviconUrl, hashColor, initials } from './lib/logo.js';

const $ = (s) => document.querySelector(s);
let games = [];

async function init() {
  games = await getGames();
  $('#count').textContent = `${games.length} game${games.length === 1 ? '' : 's'}`;
  renderFavorites();
}

function renderFavorites() {
  const grid = $('#fav-grid');
  const favs = pickFavorites(games, 5);

  if (favs.length === 0) {
    grid.innerHTML = '<div class="fav-empty">No games yet — add one below.</div>';
    return;
  }

  grid.innerHTML = favs.map(g => {
    const fav = g.source === 'local' ? null : faviconUrl(g.url, 64);
    const logo = fav
      ? `<img class="fav-logo" src="${esc(fav)}" alt="" onerror="this.outerHTML='<div class=\\'fav-logo-fallback\\' style=\\'background:${hashColor(g.title)}\\'>${esc(initials(g.title))}</div>'">`
      : `<div class="fav-logo-fallback" style="background:${hashColor(g.title)}">${esc(initials(g.title))}</div>`;
    return `<div class="fav-tile" data-id="${g.id}" title="${esc(g.title)}">
      ${logo}
      <span class="fav-name">${esc(g.title)}</span>
    </div>`;
  }).join('');

  grid.querySelectorAll('.fav-tile').forEach(tile => {
    tile.addEventListener('click', () => launchFavorite(tile.dataset.id));
  });
}

async function launchFavorite(id) {
  const g = games.find(x => x.id === id);
  if (!g) return;
  // Local/embed games are launched inside the full library overlay; URL games open directly.
  if (g.source === 'local' || g.launchMode === 'embed') {
    chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
  } else {
    chrome.tabs.create({ url: g.url });
  }
  await recordPlay(id);
  window.close();
}

function showMsg(text, ok) {
  const el = $('#msg');
  el.textContent = text;
  el.className = `msg ${ok ? 'ok' : 'err'}`;
}

async function addByUrl(url, title) {
  url = url.trim();
  if (!url) { showMsg('Enter a URL first.', false); return false; }
  if (!/^https?:\/\//i.test(url)) {
    // tolerate "example.com" by prefixing https://
    if (/^[\w.-]+\.[a-z]{2,}/i.test(url)) url = 'https://' + url;
    else { showMsg('Not a valid URL.', false); return false; }
  }
  const norm = normalizeUrl(url);
  if (games.some(g => normalizeUrl(g.url) === norm)) {
    showMsg('Already in your library.', false);
    return false;
  }
  let name = title;
  if (!name) {
    try { name = new URL(url).hostname.replace(/^www\./, ''); } catch { name = url; }
  }
  games = await addGame({
    id: crypto.randomUUID(),
    url, title: name, description: '', thumbnail: null,
    tags: [], launchMode: 'tab', source: 'url',
    favorite: false, addedAt: new Date().toISOString(),
    lastPlayedAt: null, playCount: 0
  });
  $('#count').textContent = `${games.length} games`;
  renderFavorites();
  return true;
}

$('#btn-add-url').addEventListener('click', async () => {
  if (await addByUrl($('#add-url').value)) {
    $('#add-url').value = '';
    showMsg('Added! Edit details in the full library.', true);
  }
});

$('#add-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-add-url').click();
});

$('#btn-add-current').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) { showMsg('No active tab URL.', false); return; }
  if (await addByUrl(tab.url, tab.title)) {
    showMsg('Current tab added!', true);
  }
});

$('#btn-upload').addEventListener('click', () => $('#file-upload').click());

$('#file-upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!/\.html?$/i.test(file.name)) { showMsg('Please choose an .html file.', false); return; }
  const html = await file.text();
  const id = crypto.randomUUID();
  await saveLocalGameBody(id, html);
  const title = file.name.replace(/\.html?$/i, '');
  games = await addGame({
    id, url: `local://${id}`, title, description: '', thumbnail: null,
    tags: ['uploaded'], launchMode: 'embed', source: 'local',
    favorite: false, addedAt: new Date().toISOString(),
    lastPlayedAt: null, playCount: 0
  });
  $('#count').textContent = `${games.length} games`;
  renderFavorites();
  showMsg(`Uploaded "${title}".`, true);
  e.target.value = '';
});

$('#btn-open-library').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
  window.close();
});

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

init();
