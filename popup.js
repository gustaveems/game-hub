import { getGames, addGame, normalizeUrl } from './lib/storage.js';

const $ = (s) => document.querySelector(s);

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    $('#p-url').value = tab.url || '';
    $('#p-title').value = tab.title || '';
  }
}

$('#p-add').addEventListener('click', async () => {
  const url = $('#p-url').value.trim();
  const title = $('#p-title').value.trim();
  const msg = $('#p-msg');

  if (!url || !/^https?:\/\//i.test(url)) {
    msg.textContent = 'Not a valid http(s) URL.';
    msg.className = 'msg err';
    return;
  }

  if (!title) {
    msg.textContent = 'Title is required.';
    msg.className = 'msg err';
    return;
  }

  const games = await getGames();
  const norm = normalizeUrl(url);
  if (games.some(g => normalizeUrl(g.url) === norm)) {
    msg.textContent = 'This URL is already in your library.';
    msg.className = 'msg err';
    return;
  }

  await addGame({
    id: crypto.randomUUID(),
    url,
    title,
    description: '',
    thumbnail: null,
    tags: [],
    launchMode: 'tab',
    favorite: false,
    addedAt: new Date().toISOString(),
    lastPlayedAt: null,
    playCount: 0
  });

  msg.textContent = 'Added to Game Hub!';
  msg.className = 'msg ok';
  $('#p-add').disabled = true;
});

init();
