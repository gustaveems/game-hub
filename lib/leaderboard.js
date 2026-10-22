// Pure helpers for streaks and share codes — no storage or DOM access,
// so they're easy to test in isolation.

const SHARE_PREFIX = 'GH1-';

export function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Previous calendar day for a YYYY-MM-DD string, computed at local noon to
// avoid DST/timezone edge cases.
function prevDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  dt.setDate(dt.getDate() - 1);
  return localDate(dt);
}

// A stored streak only still "counts" if the last daily play was today or
// yesterday; otherwise it's broken and shows as 0 until the next play.
export function effectiveStreak(stats) {
  if (!stats) return 0;
  const today = localDate();
  const d = stats.lastDailyDate;
  if (d === today || d === prevDay(today)) return stats.currentStreak || 0;
  return 0;
}

// Advance a streak given its previous state and the day a daily was played.
export function advanceStreak(stats, today = localDate()) {
  const s = {
    currentStreak: stats?.currentStreak || 0,
    longestStreak: stats?.longestStreak || 0,
    lastDailyDate: stats?.lastDailyDate || null
  };
  const yesterday = prevDay(today);
  if (s.lastDailyDate === today) {
    // already counted today
  } else if (s.lastDailyDate === yesterday) {
    s.currentStreak += 1;
    s.lastDailyDate = today;
  } else {
    s.currentStreak = 1;
    s.lastDailyDate = today;
  }
  s.longestStreak = Math.max(s.longestStreak, s.currentStreak);
  return s;
}

export function encodeShare(payload) {
  return SHARE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

export function decodeShare(code) {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  if (!trimmed.startsWith(SHARE_PREFIX)) return null;
  try {
    const json = decodeURIComponent(escape(atob(trimmed.slice(SHARE_PREFIX.length))));
    const o = JSON.parse(json);
    if (!o || typeof o.name !== 'string') return null;
    return {
      name: String(o.name).slice(0, 40),
      streak: Number(o.streak) || 0,
      longest: Number(o.longest) || 0,
      dailiesToday: Number(o.dailiesToday) || 0,
      plays: Number(o.plays) || 0,
      ts: o.ts || Date.now()
    };
  } catch {
    return null;
  }
}

// Build the ranked board from your entry plus friends, sorted by streak.
export function rankBoard(you, friends) {
  const rows = [{ ...you, isYou: true }, ...friends.map(f => ({ ...f, isYou: false }))];
  rows.sort((a, b) =>
    (b.streak - a.streak) ||
    (b.longest - a.longest) ||
    a.name.localeCompare(b.name)
  );
  return rows;
}
