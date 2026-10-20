import {
  getGames, addGame, updateGame, deleteGame, recordPlay,
  resetToStarter, normalizeUrl
} from './lib/storage.js';
import { fetchMetadata } from './lib/metadata.js';
import { checkEmbeddable } from './lib/embed.js';

let games = [];
let activeFilter = 'all';
let activeSort = 'title';
let searchQuery = '';
let editingId = null;
let openMenuId = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- Placeholder color from string ---
function hashColor(str) {
  let h = 0;
  for (const c of str) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 55%, 40%)`;
}

function initials(title) {
  return title.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
}

// --- Render ---
async function loadAndRender() {
  games = await getGames();
  render();
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
    list = list.filter(g => g.lastPlayedAt).sort((a, b) =>
      new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt)
    ).slice(0, 10);
  } else if (activeFilter !== 'all') {
    list = list.filter(g => g.tags.includes(activeFilter));
  }

  if (activeFilter !== 'recent') {
    if (activeSort === 'title') {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else if (activeSort === 'added') {
      list.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    } else if (activeSort === 'played') {
      list.sort((a, b) => b.playCount - a.playCount);
    }
  }

  return list;
}

function getAllTags() {
  const set = new Set();
  games.forEach(g => g.tags.forEach(t => set.add(t)));
  return [...set].sort();
}

function render() {
  renderFilterBar();
  const filtered = getFilteredGames();
  const grid = $('#game-grid');
  const empty = $('#empty-state');

  if (games.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.classList.remove('hidden');

  if (filtered.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted);padding:24px;grid-column:1/-1;text-align:center;">No games match your search or filter.</p>';
    return;
  }

  grid.innerHTML = filtered.map(g => cardHTML(g)).join('');

  grid.querySelectorAll('.game-card').forEach(card => {
    const id = card.dataset.id;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-menu-btn') || e.target.closest('.card-dropdown')) return;
      launchGame(id);
    });
  });

  grid.querySelectorAll('.card-menu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu(btn.dataset.id);
    });
  });
}

function cardHTML(g) {
  const thumbHtml = g.thumbnail
    ? `<img src="${escHtml(g.thumbnail)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'card-thumb-placeholder\\' style=\\'background:${hashColor(g.title)}\\'>${escHtml(initials(g.title))}</div>'">`
    : `<div class="card-thumb-placeholder" style="background:${hashColor(g.title)}">${escHtml(initials(g.title))}</div>`;

  const favStar = g.favorite ? '<span class="fav-star">★</span>' : '';
  const tagsHtml = g.tags.map(t => `<span class="card-tag">${escHtml(t)}</span>`).join('');
  const menuOpen = openMenuId === g.id;

  return `
    <div class="game-card" data-id="${g.id}">
      <div class="card-thumb">${thumbHtml}</div>
      <div class="card-body">
        <div class="card-title">${favStar}${escHtml(g.title)}<span class="launch-badge">${g.launchMode}</span></div>
        <div class="card-tags">${tagsHtml}</div>
      </div>
      <button class="card-menu-btn" data-id="${g.id}" title="Menu">⋮</button>
      ${menuOpen ? dropdownHTML(g) : ''}
    </div>`;
}

function dropdownHTML(g) {
  return `
    <div class="card-dropdown">
      <button data-action="edit" data-id="${g.id}">Edit</button>
      <button data-action="fav" data-id="${g.id}">${g.favorite ? 'Unfavorite' : 'Favorite'}</button>
      <button data-action="mode" data-id="${g.id}">Switch to ${g.launchMode === 'tab' ? 'embed' : 'tab'}</button>
      <button data-action="delete" data-id="${g.id}" class="danger">Delete</button>
    </div>`;
}

function renderFilterBar() {
  const bar = $('#filter-bar');
  const tags = getAllTags();

  const existingSort = bar.querySelector('.sort-select');
  const chips = bar.querySelectorAll('.chip');
  chips.forEach(c => c.remove());

  const builtIn = [
    { key: 'all', label: 'All' },
    { key: 'favorites', label: 'Favorites' },
    { key: 'recent', label: 'Recently Played' },
  ];

  const allChips = [...builtIn, ...tags.map(t => ({ key: t, label: t }))];

  allChips.reverse().forEach(({ key, label }) => {
    const chip = document.createElement('button');
    chip.className = `chip${activeFilter === key ? ' active' : ''}`;
    chip.textContent = label;
    chip.addEventListener('click', () => {
      activeFilter = key;
      render();
    });
    bar.insertBefore(chip, existingSort);
  });
}

// --- Launch ---
async function launchGame(id) {
  const g = games.find(x => x.id === id);
  if (!g) return;

  if (g.launchMode === 'embed') {
    openEmbed(g);
  } else {
    chrome.tabs.create({ url: g.url });
  }
  games = await recordPlay(id);
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

  const { embeddable } = await checkEmbeddable(game.url);
  if (!embeddable) {
    fallback.classList.remove('hidden');
    return;
  }

  frame.src = game.url;
  frame.classList.remove('hidden');

  // Fallback: if iframe fails to load within 8 seconds, show message
  const timer = setTimeout(() => {
    if (!frame.contentDocument?.body?.childElementCount) {
      frame.classList.add('hidden');
      fallback.classList.remove('hidden');
    }
  }, 8000);

  frame.onload = () => clearTimeout(timer);
  frame.onerror = () => {
    clearTimeout(timer);
    frame.classList.add('hidden');
    fallback.classList.remove('hidden');
  };
}

function closeEmbed() {
  const overlay = $('#embed-overlay');
  const frame = $('#embed-frame');
  overlay.classList.add('hidden');
  frame.src = '';
}

// --- Menu actions ---
function toggleMenu(id) {
  openMenuId = openMenuId === id ? null : id;
  render();

  if (openMenuId) {
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
            if (confirm(`Delete "${games.find(x => x.id === gid)?.title}"?`)) {
              games = await deleteGame(gid);
              render();
            } else {
              render();
            }
          }
        });
      });
    }, 0);
  }
}

// --- Add / Edit modal ---
function openAddModal() {
  editingId = null;
  $('#modal-add-title').textContent = 'Add Game';
  $('#field-url').value = '';
  $('#field-title').value = '';
  $('#field-desc').value = '';
  $('#field-thumb').value = '';
  $('#field-tags').value = '';
  $('#field-launch').value = 'tab';
  hideErrors();
  $('#modal-add').classList.remove('hidden');
  $('#field-url').focus();
}

function openEditModal(id) {
  const g = games.find(x => x.id === id);
  if (!g) return;
  editingId = id;
  $('#modal-add-title').textContent = 'Edit Game';
  $('#field-url').value = g.url;
  $('#field-title').value = g.title;
  $('#field-desc').value = g.description;
  $('#field-thumb').value = g.thumbnail || '';
  $('#field-tags').value = g.tags.join(', ');
  $('#field-launch').value = g.launchMode;
  hideErrors();
  $('#modal-add').classList.remove('hidden');
  $('#field-title').focus();
}

function closeAddModal() {
  $('#modal-add').classList.add('hidden');
  editingId = null;
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
    showError('url-error', 'URL must start with http:// or https://');
    return;
  }

  // Duplicate check
  const norm = normalizeUrl(url);
  const dup = games.find(g => g.id !== editingId && normalizeUrl(g.url) === norm);
  if (dup) {
    showWarning('url-warning', `Duplicate: "${dup.title}" has the same URL.`);
  }

  // Fetch metadata if title is empty
  if (!$('#field-title').value.trim()) {
    $('#fetch-status').classList.remove('hidden');
    const meta = await fetchMetadata(url);
    $('#fetch-status').classList.add('hidden');

    if (meta.title) $('#field-title').value = meta.title;
    if (meta.description && !$('#field-desc').value.trim()) $('#field-desc').value = meta.description;
    if (meta.thumbnail && !$('#field-thumb').value.trim()) $('#field-thumb').value = meta.thumbnail;
  }
}

function showError(id, msg) {
  const el = $(`#${id}`);
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showWarning(id, msg) {
  const el = $(`#${id}`);
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function handleSave() {
  const url = $('#field-url').value.trim();
  const title = $('#field-title').value.trim();

  hideErrors();

  if (!url || !/^https?:\/\//i.test(url)) {
    showError('url-error', 'Valid http(s) URL is required.');
    return;
  }
  if (!title) {
    showError('url-error', 'Title is required.');
    return;
  }

  const tags = $('#field-tags').value
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);

  if (editingId) {
    games = await updateGame(editingId, {
      url,
      title,
      description: $('#field-desc').value.trim(),
      thumbnail: $('#field-thumb').value.trim() || null,
      tags,
      launchMode: $('#field-launch').value
    });
  } else {
    const game = {
      id: crypto.randomUUID(),
      url,
      title,
      description: $('#field-desc').value.trim(),
      thumbnail: $('#field-thumb').value.trim() || null,
      tags,
      launchMode: $('#field-launch').value,
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

// --- Close menus on outside click ---
document.addEventListener('click', (e) => {
  if (openMenuId && !e.target.closest('.card-dropdown') && !e.target.closest('.card-menu-btn')) {
    openMenuId = null;
    render();
  }
});

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  // Esc
  if (e.key === 'Escape') {
    if (!$('#embed-overlay').classList.contains('hidden')) {
      closeEmbed();
      return;
    }
    if (!$('#modal-add').classList.contains('hidden')) {
      closeAddModal();
      return;
    }
  }

  // Don't handle shortcuts when typing in inputs
  if (e.target.matches('input, textarea, select')) return;

  if (e.key === '/') {
    e.preventDefault();
    $('#search').focus();
  } else if (e.key === 'n') {
    e.preventDefault();
    openAddModal();
  }
});

// --- Events ---
$('#search').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  render();
});

$('#sort-select').addEventListener('change', (e) => {
  activeSort = e.target.value;
  render();
});

$('#btn-add').addEventListener('click', openAddModal);
$('#btn-add-empty').addEventListener('click', openAddModal);
$('#btn-restore-empty').addEventListener('click', async () => {
  games = await resetToStarter();
  render();
});

$('#btn-cancel-add').addEventListener('click', closeAddModal);
$('#btn-save-add').addEventListener('click', handleSave);
$('#field-url').addEventListener('blur', handleUrlBlur);
$('#field-url').addEventListener('paste', () => setTimeout(handleUrlBlur, 100));

$('#modal-add').addEventListener('click', (e) => {
  if (e.target === $('#modal-add')) closeAddModal();
});

$('#embed-close').addEventListener('click', closeEmbed);
$('#embed-open-tab').addEventListener('click', () => {
  const url = $('#embed-overlay').dataset.url;
  if (url) chrome.tabs.create({ url });
  closeEmbed();
});
$('#embed-fallback-open').addEventListener('click', () => {
  const url = $('#embed-overlay').dataset.url;
  if (url) chrome.tabs.create({ url });
  closeEmbed();
});

// --- Helpers ---
function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// --- Init ---
loadAndRender();
