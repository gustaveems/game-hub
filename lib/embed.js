// Check whether a URL allows being embedded in an iframe.
// Returns { embeddable: boolean, reason?: string }.
// This is best-effort: some servers omit headers on HEAD but set them on GET,
// and CSP frame-ancestors can't always be read from an extension fetch.
export async function checkEmbeddable(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);

    const xfo = resp.headers.get('x-frame-options');
    if (xfo) {
      const v = xfo.toLowerCase();
      if (v === 'deny' || v === 'sameorigin') {
        return { embeddable: false, reason: `X-Frame-Options: ${xfo}` };
      }
    }

    const csp = resp.headers.get('content-security-policy');
    if (csp) {
      const fa = csp.split(';').find(d => d.trim().startsWith('frame-ancestors'));
      if (fa && !fa.includes('*')) {
        return { embeddable: false, reason: 'CSP frame-ancestors blocks framing' };
      }
    }

    return { embeddable: true };
  } catch {
    // Network error or timeout — assume embeddable and let the iframe fallback handle it
    return { embeddable: true };
  }
}
