import {
  getGames, addGame, updateGame, deleteGame, recordPlay,
  resetToStarter, normalizeUrl, saveLocalGameBody, getLocalGameBody,
  getThumbCache, setThumbCache, pruneThumbCache
} from './lib/storage.js';
import { fetchMetadata } from './lib/metadata.js';
import { checkEmbeddable } from './lib/embed.js';
import { faviconUrl, hashColor, initials } from './lib/logo.js';

let games = [];
let thumbCache = {}; // { [gameId]: { src, data } } — artwork cached as data URLs
let activeFilter = 'all';
let activeSort = 'title';
let searchQuery = '';
let editingId = null;
let openMenuId = null;
let pendingUpload = null; // { html, name } for an in-progress game upload

const $ = (sel) => document.querySelector(sel);

async function loadAndRender() {
  games = await getGames();
  thumbCache = await getThumbCache(games.map(g => g.id));
  render();
  pruneThumbCache(games.map(g => g.id));
  ensureThumbsCached();
}

// Serve a game's artwork from cache when it matches, else the remote URL.
function thumbSrc(g) {
  const c = thumbCache[g.id];
  return (c && c.src === g.thumbnail) ? c.data : g.thumbnail;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Fetch any uncached artwork once and store it as a data URL for next time.
async function ensureThumbsCached() {
  const pending = games.filter(g =>
    g.thumbnail && !(thumbCache[g.id] && thumbCache[g.id].src === g.thumbnail)
  );
  if (pending.length === 0) return;

  let i = 0;
  const worker = async () => {
    while (i < pending.length) {
      const g = pending[i++];
      try {
        const res = await fetch(g.thumbnail);
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob.type.startsWith('image/') || blob.size > 1_500_000) continue;
        const dataUrl = await blobToDataUrl(blob);
        thumbCache[g.id] = { src: g.thumbnail, data: dataUrl };
        await setThumbCache(g.id, g.thumbnail, dataUrl);
      } catch { /* leave uncached; remote URL / favicon still render */ }
    }
  };
  // Small concurrency cap so we don't fire dozens of fetches at once.
  await Promise.all(Array.from({ length: 4 }, worker));
}

function getFilteredGames() {
  let list = [...games];

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(g =>
      g.title.toLowerCase().includes(q) ||
      g.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  if (activeFilter === 'favorites') {
    list = list.filter(g => g.favorite);
  } else if (activeFilter === 'recent') {
    list = list
      .filter(g => g.lastPlayedAt)
      .sort((a, b) => new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt))
      .slice(0, 10);
  } else if (activeFilter !== 'all') {
    list = list.filter(g => g.tags.includes(activeFilter));
  }

  if (activeFilter !== 'recent') {
    if (activeSort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (activeSort === 'added') list.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    else if (activeSort === 'played') list.sort((a, b) => b.playCount - a.playCount);
  }

  return list;
}

function getAllTags() {
  const set = new Set();
  games.forEach(g => g.tags.forEach(t => set.add(t)));
  return [...set].sort();
}

// Games are grouped into the first category whose rule they match.
const CATEGORIES = [
  ['Your Uploads',      g => g.source === 'local'],
  ['Trivia & Guessing', g => g.tags.includes('trivia')],
  ['Word & Number',     g => g.tags.some(t => ['word', 'math', 'spelling'].includes(t))],
  ['Puzzle & Logic',    g => g.tags.some(t => ['puzzle', 'logic'].includes(t))],
  ['Multiplayer & .io', g => g.tags.some(t => ['multiplayer', 'io'].includes(t))],
  ['Arcade & Classic',  g => g.tags.some(t => ['arcade', 'classic', 'shooter', 'racing', 'skill'].includes(t))],
  ['Idle & Sandbox',    g => g.tags.some(t => ['idle', 'clicker', 'sandbox', 'rpg', 'adventure', 'text', 'creative'].includes(t))],
];
const FALLBACK_CATEGORY = 'More Games';

function categoryOf(g) {
  for (const [name, rule] of CATEGORIES) if (rule(g)) return name;
  return FALLBACK_CATEGORY;
}

function isPlayedToday(g) {
  return g.lastPlayedAt && new Date(g.lastPlayedAt).toDateString() === new Date().toDateString();
}

function sortGames(list) {
  const l = [...list];
  if (activeSort === 'title') l.sort((a, b) => a.title.localeCompare(b.title));
  else if (activeSort === 'added') l.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  else if (activeSort === 'played') l.sort((a, b) => b.playCount - a.playCount);
  return l;
}

function render() {
  renderFilterBar();
  const defaultView = activeFilter === 'all' && !searchQuery;
  renderDailies(defaultView);

  const list = $('#game-list');
  const empty = $('#empty-state');

  if (games.length === 0) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.classList.remove('hidden');

  if (defaultView) {
    // Grouped-by-category view.
    const order = [...CATEGORIES.map(c => c[0]), FALLBACK_CATEGORY];
    const buckets = {};
    games.forEach(g => { (buckets[categoryOf(g)] ||= []).push(g); });
    list.innerHTML = order
      .filter(name => buckets[name]?.length)
      .map(name => {
        const rows = sortGames(buckets[name]).map(rowHTML).join('');
        return `<div class="section-head"><span class="section-name">${escHtml(name)}</span><span class="section-count">${buckets[name].length}</span></div>${rows}`;
      })
      .join('');
  } else {
    const filtered = getFilteredGames();
    if (filtered.length === 0) {
      list.innerHTML = '<p class="no-match">No games match your search or filter.</p>';
      return;
    }
    list.innerHTML = filtered.map(rowHTML).join('');
  }

  wireRows(list);
}

function wireRows(container) {
  container.querySelectorAll('.game-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-menu-btn') || e.target.closest('.card-dropdown')) return;
      launchGame(row.dataset.id);
    });
  });
  container.querySelectorAll('.row-menu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu(btn.dataset.id);
    });
  });
  // If a game's artwork fails to load, swap in the favicon/initials tile.
  container.querySelectorAll('img.cover[data-id]').forEach(img => {
    img.addEventListener('error', () => {
      const g = games.find(x => x.id === img.dataset.id);
      const thumb = img.closest('.row-thumb');
      if (g && thumb) thumb.innerHTML = logoTileHTML(g);
    });
  });
}

// Horizontal strip of daily games with a played-today indicator.
function renderDailies(show) {
  const wrap = $('#dailies');
  const strip = $('#dailies-strip');
  const dailies = games.filter(g => g.tags.includes('daily'));

  if (!show || dailies.length === 0) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');

  const playedCount = dailies.filter(isPlayedToday).length;
  $('#dailies-count').textContent = `${playedCount} of ${dailies.length} played today`;

  // Unplayed first, each group alphabetical.
  const ordered = [...dailies].sort((a, b) => {
    const pa = isPlayedToday(a), pb = isPlayedToday(b);
    if (pa !== pb) return pa ? 1 : -1;
    return a.title.localeCompare(b.title);
  });

  strip.innerHTML = ordered.map(g => {
    const played = isPlayedToday(g);
    const inner = g.thumbnail
      ? `<img class="cover" data-id="${g.id}" src="${escHtml(thumbSrc(g))}" alt="">`
      : logoTileHTML(g);
    return `<div class="daily-tile${played ? ' played' : ''}" data-id="${g.id}" title="${escHtml(g.title)}">
      <div class="daily-thumb">${inner}</div>
      <div class="daily-name">${escHtml(g.title)}</div>
      ${played ? '<span class="daily-check">✓</span>' : ''}
    </div>`;
  }).join('');

  strip.querySelectorAll('.daily-tile').forEach(tile => {
    tile.addEventListener('click', () => launchGame(tile.dataset.id));
  });
  strip.querySelectorAll('img.cover[data-id]').forEach(img => {
    img.addEventListener('error', () => {
      const g = games.find(x => x.id === img.dataset.id);
      const box = img.closest('.daily-thumb');
      if (g && box) box.innerHTML = logoTileHTML(g);
    });
  });
}

// Favicon tile with initials fallback, used when a game has no artwork thumbnail.
function logoTileHTML(g) {
  const color = hashColor(g.title);
  const fav = g.source === 'local' ? null : faviconUrl(g.url, 128);
  const ini = escHtml(initials(g.title));
  const inner = fav
    ? `<img class="logo-img" src="${escHtml(fav)}" alt="" loading="lazy" onerror="this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden')"><span class="logo-initials hidden">${ini}</span>`
    : `<span class="logo-initials">${ini}</span>`;
  return `<div class="logo-tile" style="--tile:${color}">${inner}</div>`;
}

function thumbHTML(g) {
  // Artwork thumbnail if present (fallback wired in render()); else favicon tile.
  if (g.thumbnail) {
    return `<img class="cover" data-id="${g.id}" src="${escHtml(thumbSrc(g))}" alt="" loading="lazy">`;
  }
  return logoTileHTML(g);
}

function rowHTML(g) {
  const favStar = g.favorite ? '<span class="fav-star">★</span>' : '';
  const tagsHtml = g.tags.slice(0, 4).map(t => `<span class="row-tag">${escHtml(t)}</span>`).join('');
  const badge = g.source === 'local' ? 'local' : g.launchMode;
  const menuOpen = openMenuId === g.id;

  return `
    <div class="game-row" data-id="${g.id}">
      <div class="row-thumb">${thumbHTML(g)}</div>
      <div class="row-body">
        <div class="row-title">${favStar}<span class="row-title-text">${escHtml(g.title)}</span></div>
        <div class="row-desc">${escHtml(g.description || '')}</div>
        <div class="row-tags">${tagsHtml}</div>
      </div>
      <div class="row-right">
        <span class="launch-badge">${badge}</span>
        <button class="row-menu-btn" data-id="${g.id}" title="Menu" aria-label="Game menu">⋮</button>
      </div>
      ${menuOpen ? dropdownHTML(g) : ''}
    </div>`;
}

function dropdownHTML(g) {
  const modeBtn = g.source === 'local'
    ? ''
    : `<button data-action="mode" data-id="${g.id}">Switch to ${g.launchMode === 'tab' ? 'embed' : 'tab'}</button>`;
  return `
    <div class="card-dropdown">
      <button data-action="edit" data-id="${g.id}">Edit</button>
      <button data-action="fav" data-id="${g.id}">${g.favorite ? 'Unfavorite' : 'Favorite'}</button>
      ${modeBtn}
      <button data-action="delete" data-id="${g.id}" class="danger">Delete</button>
    </div>`;
}

function renderFilterBar() {
  const bar = $('#filter-bar');
  const tags = getAllTags();
  const sortSelect = bar.querySelector('.sort-select');
  bar.querySelectorAll('.chip').forEach(c => c.remove());

  const builtIn = [
    { key: 'all', label: 'All' },
    { key: 'favorites', label: '★ Favorites' },
    { key: 'recent', label: 'Recently Played' },
  ];
  const allChips = [...builtIn, ...tags.map(t => ({ key: t, label: t }))];

  allChips.reverse().forEach(({ key, label }) => {
    const chip = document.createElement('button');
    chip.className = `chip${activeFilter === key ? ' active' : ''}`;
    chip.textContent = label;
    chip.addEventListener('click', () => { activeFilter = key; render(); });
    bar.insertBefore(chip, sortSelect);
  });
}

// --- Launch ---
async function launchGame(id) {
  const g = games.find(x => x.id === id);
  if (!g) return;

  if (g.source === 'local' || g.launchMode === 'embed') {
    await openEmbed(g);
  } else {
    chrome.tabs.create({ url: g.url });
  }
  games = await recordPlay(id);
  render();
}

async function openEmbed(game) {
  const overlay = $('#embed-overlay');
  const frame = $('#embed-frame');
  const fallback = $('#embed-fallback');
  const title = $('#embed-title');

  title.textContent = game.title;
  overlay.classList.remove('hidden');
  frame.classList.add('hidden');
  fallback.classList.add('hidden');
  overlay.dataset.url = game.url;

  // Local uploaded games play from stored HTML via a blob URL.
  if (game.source === 'local') {
    const html = await getLocalGameBody(game.id);
    if (!html) {
      fallback.classList.remove('hidden');
      $('#embed-fallback-text').textContent = 'The uploaded game file could not be found.';
      $('#embed-open-tab').classList.add('hidden');
      $('#embed-fallback-open').classList.add('hidden');
      return;
    }
    const blob = new Blob([html], { type: 'text/html' });
    frame.src = URL.createObjectURL(blob);
    frame.classList.remove('hidden');
    return;
  }

  $('#embed-open-tab').classList.remove('hidden');
  $('#embed-fallback-open').classList.remove('hidden');

  const { embeddable } = await checkEmbeddable(game.url);
  if (!embeddable) {
    $('#embed-fallback-text').textContent = 'This site blocks embedding in iframes.';
    fallback.classList.remove('hidden');
    return;
  }

  frame.src = game.url;
  frame.classList.remove('hidden');

  const timer = setTimeout(() => {
    try {
      if (!frame.contentDocument?.body?.childElementCount) {
        frame.classList.add('hidden');
        $('#embed-fallback-text').textContent = 'This site blocks embedding in iframes.';
        fallback.classList.remove('hidden');
      }
    } catch { /* cross-origin frame loaded fine */ }
  }, 8000);

  frame.onload = () => clearTimeout(timer);
  frame.onerror = () => {
    clearTimeout(timer);
    frame.classList.add('hidden');
    $('#embed-fallback-text').textContent = 'This site blocks embedding in iframes.';
    fallback.classList.remove('hidden');
  };
}

function closeEmbed() {
  const overlay = $('#embed-overlay');
  const frame = $('#embed-frame');
  if (frame.src.startsWith('blob:')) URL.revokeObjectURL(frame.src);
  overlay.classList.add('hidden');
  frame.src = '';
}

// --- Menu actions ---
function toggleMenu(id) {
  openMenuId = openMenuId === id ? null : id;
  render();
  if (!openMenuId) return;

  setTimeout(() => {
    const dropdown = document.querySelector('.card-dropdown');
    if (!dropdown) return;
    dropdown.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const gid = btn.dataset.id;
        openMenuId = null;

        if (action === 'edit') {
          openEditModal(gid);
        } else if (action === 'fav') {
          const g = games.find(x => x.id === gid);
          games = await updateGame(gid, { favorite: !g.favorite });
          render();
        } else if (action === 'mode') {
          const g = games.find(x => x.id === gid);
          games = await updateGame(gid, { launchMode: g.launchMode === 'tab' ? 'embed' : 'tab' });
          render();
        } else if (action === 'delete') {
          const g = games.find(x => x.id === gid);
          if (confirm(`Delete "${g?.title}"?`)) {
            games = await deleteGame(gid);
          }
          render();
        }
      });
    });
  }, 0);
}

// --- Add / Edit modal ---
function openAddModal() {
  editingId = null;
  pendingUpload = null;
  $('#modal-add-title').textContent = 'Add Game';
  ['#field-url', '#field-title', '#field-desc', '#field-thumb', '#field-tags'].forEach(s => $(s).value = '');
  $('#field-launch').value = 'tab';
  $('#upload-status').textContent = '';
  $('#field-url').closest('.form-group').classList.remove('hidden');
  hideErrors();
  $('#modal-add').classList.remove('hidden');
  $('#field-url').focus();
}

function openEditModal(id) {
  const g = games.find(x => x.id === id);
  if (!g) return;
  editingId = id;
  pendingUpload = null;
  $('#modal-add-title').textContent = 'Edit Game';
  $('#field-url').value = g.source === 'local' ? '' : g.url;
  $('#field-title').value = g.title;
  $('#field-desc').value = g.description;
  $('#field-thumb').value = g.thumbnail || '';
  $('#field-tags').value = g.tags.join(', ');
  $('#field-launch').value = g.launchMode;
  $('#upload-status').textContent = g.source === 'local' ? 'This is an uploaded local game.' : '';
  $('#field-url').closest('.form-group').classList.toggle('hidden', g.source === 'local');
  hideErrors();
  $('#modal-add').classList.remove('hidden');
  $('#field-title').focus();
}

function closeAddModal() {
  $('#modal-add').classList.add('hidden');
  editingId = null;
  pendingUpload = null;
}

function hideErrors() {
  $('#url-error').classList.add('hidden');
  $('#url-warning').classList.add('hidden');
}

async function handleUrlBlur() {
  const url = $('#field-url').value.trim();
  if (!url) return;
  hideErrors();

  if (!/^https?:\/\//i.test(url)) {
    showMsg('url-error', 'URL must start with http:// or https://');
    return;
  }

  const norm = normalizeUrl(url);
  const dup = games.find(g => g.id !== editingId && normalizeUrl(g.url) === norm);
  if (dup) showMsg('url-warning', `Heads up: "${dup.title}" already uses this URL.`);

  if (!$('#field-title').value.trim()) {
    $('#fetch-status').classList.remove('hidden');
    const meta = await fetchMetadata(url);
    $('#fetch-status').classList.add('hidden');
    if (meta.title) $('#field-title').value = meta.title;
    if (meta.description && !$('#field-desc').value.trim()) $('#field-desc').value = meta.description;
    if (meta.thumbnail && !$('#field-thumb').value.trim()) $('#field-thumb').value = meta.thumbnail;
  }
}

function showMsg(id, msg) {
  const el = $(`#${id}`);
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function handleUploadFile(file) {
  if (!file) return;
  if (!/\.html?$/i.test(file.name)) {
    $('#upload-status').textContent = 'Please choose an .html file.';
    return;
  }
  const html = await file.text();
  pendingUpload = { html, name: file.name };
  $('#upload-status').textContent = `Loaded "${file.name}" (${(html.length / 1024).toFixed(0)} KB). It will play in an overlay.`;
  if (!$('#field-title').value.trim()) {
    $('#field-title').value = file.name.replace(/\.html?$/i, '');
  }
  $('#field-url').closest('.form-group').classList.add('hidden');
}

async function handleSave() {
  const title = $('#field-title').value.trim();
  const url = $('#field-url').value.trim();
  hideErrors();

  if (!title) { showMsg('url-error', 'Title is required.'); return; }

  const tags = $('#field-tags').value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const isLocal = !!pendingUpload || (editingId && games.find(g => g.id === editingId)?.source === 'local');

  if (!isLocal && (!url || !/^https?:\/\//i.test(url))) {
    showMsg('url-error', 'Enter a valid http(s) URL, or upload a game file.');
    return;
  }

  if (editingId) {
    games = await updateGame(editingId, {
      url: isLocal ? undefined : url,
      title,
      description: $('#field-desc').value.trim(),
      thumbnail: $('#field-thumb').value.trim() || null,
      tags,
      launchMode: isLocal ? 'embed' : $('#field-launch').value
    });
  } else {
    const id = crypto.randomUUID();
    if (pendingUpload) await saveLocalGameBody(id, pendingUpload.html);
    const game = {
      id,
      url: pendingUpload ? `local://${id}` : url,
      title,
      description: $('#field-desc').value.trim(),
      thumbnail: $('#field-thumb').value.trim() || null,
      tags,
      launchMode: pendingUpload ? 'embed' : $('#field-launch').value,
      source: pendingUpload ? 'local' : 'url',
      favorite: false,
      addedAt: new Date().toISOString(),
      lastPlayedAt: null,
      playCount: 0
    };
    games = await addGame(game);
  }

  closeAddModal();
  render();
}

// --- Global listeners ---
document.addEventListener('click', (e) => {
  if (openMenuId && !e.target.closest('.card-dropdown') && !e.target.closest('.card-menu-btn')) {
    openMenuId = null;
    render();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#embed-overlay').classList.contains('hidden')) return closeEmbed();
    if (!$('#modal-add').classList.contains('hidden')) return closeAddModal();
  }
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  else if (e.key === 'n') { e.preventDefault(); openAddModal(); }
});

$('#search').addEventListener('input', (e) => { searchQuery = e.target.value.trim(); render(); });
$('#sort-select').addEventListener('change', (e) => { activeSort = e.target.value; render(); });
$('#btn-add').addEventListener('click', openAddModal);
$('#btn-add-empty').addEventListener('click', openAddModal);
$('#btn-restore-empty').addEventListener('click', async () => { games = await resetToStarter(); render(); });
$('#btn-cancel-add').addEventListener('click', closeAddModal);
$('#btn-save-add').addEventListener('click', handleSave);
$('#field-url').addEventListener('blur', handleUrlBlur);
$('#field-url').addEventListener('paste', () => setTimeout(handleUrlBlur, 100));
$('#btn-upload').addEventListener('click', () => $('#field-upload').click());
$('#field-upload').addEventListener('change', (e) => handleUploadFile(e.target.files[0]));
$('#modal-add').addEventListener('click', (e) => { if (e.target === $('#modal-add')) closeAddModal(); });
$('#embed-close').addEventListener('click', closeEmbed);
$('#embed-open-tab').addEventListener('click', () => {
  const url = $('#embed-overlay').dataset.url;
  if (url && !url.startsWith('local://')) chrome.tabs.create({ url });
  closeEmbed();
});
$('#embed-fallback-open').addEventListener('click', () => {
  const url = $('#embed-overlay').dataset.url;
  if (url && !url.startsWith('local://')) chrome.tabs.create({ url });
  closeEmbed();
});

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

loadAndRender();
