import {
  exportGames, importGames, resetToStarter, getStorageUsage, clearThumbCache,
  restoreSnapshot, getSnapshotInfo, getQuarantine
} from './lib/storage.js';

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

    const replace = $('#chk-replace')?.checked;
    if (replace && !confirm(`Replace your whole library with this file? You can step back afterwards.`)) {
      e.target.value = '';
      return;
    }
    const result = await importGames(data, { replace });
    const dup = result.duplicates ? ` ${result.duplicates} already in your library.` : '';
    if (result.skipped.length > 0) {
      msg.textContent = `Added ${result.imported} games.${dup} Skipped entries at indices: ${result.skipped.join(', ')}.`;
      msg.className = 'msg err';
    } else {
      msg.textContent = `Added ${result.imported} games.${dup}`;
      msg.className = 'msg ok';
    }
    showUsage();
    showUndo();
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
  if (!confirm('Reset your library to the starter games? You can step back afterwards.')) return;
  await resetToStarter();
  $('#reset-msg').textContent = 'Library reset to starter games.';
  $('#reset-msg').className = 'msg ok';
  showUsage();
  showUndo();
});

// Offered after an import-replace or a reset, until the next one.
async function showUndo() {
  const info = await getSnapshotInfo();
  const btn = $('#btn-undo');
  btn.classList.toggle('hidden', !info);
  if (info) btn.textContent = `Step back to previous library (${info.count} games)`;
  const damaged = await getQuarantine();
  const dl = $('#btn-damaged');
  dl.classList.toggle('hidden', !damaged.length);
  dl.textContent = `Download ${damaged.length} damaged entries that were set aside`;
}

$('#btn-undo').addEventListener('click', async () => {
  const n = await restoreSnapshot();
  $('#reset-msg').textContent = `Stepped back to ${n} games.`;
  $('#reset-msg').className = 'msg ok';
  showUsage();
  showUndo();
});

$('#btn-damaged').addEventListener('click', async () => {
  const blob = new Blob([JSON.stringify(await getQuarantine(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'game-hub-damaged-entries.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

showUsage();
showUndo();
