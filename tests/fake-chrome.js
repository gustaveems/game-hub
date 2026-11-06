// A stand-in for the chrome.* APIs, for unit tests and for `npm run preview`.
// In a browser it persists to localStorage and tells other tabs, so stale-tab bugs reproduce.
function makeArea(name, listeners) {
  const key = `fake-chrome-${name}`;
  const hasLS = typeof window !== 'undefined';
  let mem = {};
  const load = () => (hasLS ? JSON.parse(localStorage.getItem(key) || '{}') : mem);
  const save = (v) => { if (hasLS) localStorage.setItem(key, JSON.stringify(v)); else mem = v; };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  return {
    async get(keys) {
      const all = load();
      if (keys == null) return clone(all);
      const out = {};
      for (const k of [].concat(keys)) if (k in all) out[k] = clone(all[k]);
      return out;
    },
    async set(items) {
      const next = { ...load(), ...clone(items) };
      save(next);
      const changes = Object.fromEntries(Object.keys(items).map((k) => [k, { newValue: items[k] }]));
      for (const fn of listeners) fn(changes, name);
    },
    async remove(keys) {
      const all = load();
      for (const k of [].concat(keys)) delete all[k];
      save(all);
    },
    async clear() { save({}); },
    async getBytesInUse() { return JSON.stringify(load()).length; },
  };
}

function makeFakeChrome() {
  const listeners = new Set();
  const calls = { tabsCreated: [], tabsUpdated: [], searches: [], permissionRequests: [] };
  return {
    calls,
    runtime: { getURL: (p) => `/${p}` },
    storage: {
      local: makeArea('local', listeners),
      sync: makeArea('sync', listeners),
      onChanged: { addListener: (fn) => listeners.add(fn) },
      __emit: (changes, area) => { for (const fn of listeners) fn(changes, area); },
    },
    tabs: {
      create: async (o) => { calls.tabsCreated.push(o.url); },
      update: async (o) => { calls.tabsUpdated.push(o.url); },
      query: async () => [{ id: 1, title: 'Page', url: 'https://example.com/' }],
    },
    search: { query: (o) => { calls.searches.push(o.text); } },
    permissions: {
      request: async (o) => { calls.permissionRequests.push(o.origins); return true; },
      contains: async () => false,
    },
  };
}

globalThis.makeFakeChrome = makeFakeChrome;

if (typeof window !== 'undefined') {
  window.chrome = makeFakeChrome();
  const channel = new BroadcastChannel('fake-chrome');
  const { set } = window.chrome.storage.local;
  window.chrome.storage.local.set = async (items) => {
    await set(items);
    channel.postMessage(Object.keys(items));
  };
  channel.onmessage = (e) => {
    window.chrome.storage.__emit(Object.fromEntries(e.data.map((k) => [k, {}])), 'local');
  };
}
