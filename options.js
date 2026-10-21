import { exportGames, importGames, resetToStarter, getStorageUsage, clearThumbCache } from './lib/storage.js';

const $ = (s) => document.querySelector(s);

async function showUsage() {
  const bytes = await getStorageUsage();
  const kb = (bytes / 1024).toFixed(1);
  $('#usage').textContent = `${kb} KB used in chrome.storage.local`;
}

$('#btn-export').addEventListener('click', async () => {
  const games = await exportGames();
  const blob = new Blob([JSON.stringify(games, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'game-hub-library.json';
  a.click();
  URL.revokeObjectURL(url);
});

$('#btn-import').addEventListener('click', () => {
  $('#file-import').click();
});

$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const msg = $('#import-msg');
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      msg.textContent = 'Invalid file: expected a JSON array.';
      msg.className = 'msg err';
      return;
    }

    const result = await importGames(data);
    if (result.skipped.length > 0) {
      msg.textContent = `Imported ${result.imported} games. Skipped entries at indices: ${result.skipped.join(', ')}.`;
      msg.className = 'msg err';
    } else {
      msg.textContent = `Imported ${result.imported} games successfully.`;
      msg.className = 'msg ok';
    }
    showUsage();
  } catch (err) {
    msg.textContent = 'Failed to parse file: ' + err.message;
    msg.className = 'msg err';
  }

  e.target.value = '';
});

$('#btn-clear-cache').addEventListener('click', async () => {
  const n = await clearThumbCache();
  $('#cache-msg').textContent = n > 0
    ? `Cleared ${n} cached image${n === 1 ? '' : 's'}. They'll re-download next time you open a new tab.`
    : 'Image cache is already empty.';
  $('#cache-msg').className = 'msg ok';
  showUsage();
});

$('#btn-reset').addEventListener('click', async () => {
  if (!confirm('Reset your library to the starter games? All current games will be lost.')) return;
  await resetToStarter();
  $('#reset-msg').textContent = 'Library reset to starter games.';
  $('#reset-msg').className = 'msg ok';
  showUsage();
});

showUsage();
