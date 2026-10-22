// Global leaderboard client: talks to the Neon Data API (PostgREST) using a
// short-lived anonymous JWT from Neon Auth. The endpoints are public by design;
// the board is login-free, so entries are self-reported (spoofable) on purpose.

const DATA_API = 'https://ep-curly-dawn-zaig5r51.apirest.c-2.eu-west-2.aws.neon.tech/neondb/rest/v1';
const AUTH = 'https://ep-curly-dawn-zaig5r51.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth';

let tokenCache = null; // { token, exp } exp in epoch seconds

async function getToken() {
  const now = Date.now() / 1000;
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;
  const res = await fetch(`${AUTH}/token/anonymous`);
  if (!res.ok) throw new Error(`auth ${res.status}`);
  const j = await res.json();
  tokenCache = { token: j.token, exp: j.expires_at || now + 600 };
  return tokenCache.token;
}

// Upsert your row (keyed by player_id). Values are clamped to the table's
// CHECK ranges so a bad local value can't get rejected.
export async function submitScore(entry) {
  if (!entry.name) throw new Error('name required');
  const token = await getToken();
  const body = {
    player_id: entry.playerId,
    name: entry.name.slice(0, 40),
    streak: clamp(entry.streak, 0, 100000),
    longest: clamp(entry.longest, 0, 100000),
    dailies_today: clamp(entry.dailiesToday, 0, 1000),
    plays: clamp(entry.plays, 0, 100000000)
  };
  const res = await fetch(`${DATA_API}/leaderboard`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`submit ${res.status}`);
}

export async function fetchTop(limit = 100) {
  const token = await getToken();
  const url = `${DATA_API}/leaderboard?select=player_id,name,streak,longest,updated_at` +
    `&order=streak.desc,longest.desc,updated_at.asc&limit=${limit}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return res.json();
}

function clamp(n, lo, hi) {
  n = Number(n) || 0;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
