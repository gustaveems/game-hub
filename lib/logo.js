// Returns a favicon/logo image URL for a page via Google's favicon service.
// This is an image endpoint, not a script — no remote code is executed.
export function faviconUrl(pageUrl, size = 128) {
  try {
    const origin = new URL(pageUrl).origin;
    return `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(origin)}&size=${size}`;
  } catch {
    return null;
  }
}

// Deterministic HSL background color derived from a string.
export function hashColor(str) {
  let h = 0;
  for (const c of str) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 48%, 38%)`;
}

export function initials(title) {
  return title
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('');
}
